package io.github.marianovale.unitv.remote

import java.io.IOException
import kotlin.concurrent.thread

// What the HTTP API needs from the box.
interface Device {
    fun status(): Map<String, Any?>
    fun apps(): List<String>
    fun key(name: String?)
    fun text(value: String?)
    fun launch(pkg: String?)
    fun reconnect(): String
}

// A shell on the box with the `shell` user's rights, which is what lets
// `input` and `monkey` inject keys into other apps.
interface Shell {
    // Runs a command and returns its stdout; throws IOException on failure.
    fun run(command: String): String

    // Starts a long-running command; closing the handle stops it.
    fun start(command: String): AutoCloseable

    fun reconnect(): String
}

// One line-based command connection to `monkey --port`.
interface MonkeyLink : AutoCloseable {
    fun send(command: String)

    fun setReadTimeout(ms: Int) {}
}

private val LAUNCHER_CATEGORIES = listOf(
    "android.intent.category.LEANBACK_LAUNCHER",
    "android.intent.category.LAUNCHER",
)

const val MONKEY_PORT = 1080

// Drives the box through a shell. Keys go through `monkey --port`, the input
// injector that ships with Android: it stays running, so a press costs one
// socket round trip instead of starting `input` (a fresh JVM, about a second
// on the UniTV) each time. Monkey is started in the background by
// startFastKeys(); until it answers, and whenever it fails, keys use
// `input keyevent`, so a press never waits for monkey to start.
class ShellDevice(
    private val shell: Shell,
    private val fastKeys: Boolean = true,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pause: (Long) -> Unit = Thread::sleep,
    private val connectMonkey: (port: Int, readTimeoutMs: Int) -> MonkeyLink = MonkeyChannel::connect,
    private val log: (String) -> Unit = {},
) : Device {
    // Input runs one command at a time so presses reach the box in order.
    private val inputLock = Any()
    @Volatile private var monkey: MonkeyLink? = null
    private var monkeyProcess: AutoCloseable? = null
    private var keeper: Thread? = null

    // For the status screen: whether the fast path is up, why it is not,
    // and how the last press went.
    val fastKeysReady: Boolean get() = monkey != null

    @Volatile var fastKeysError = ""
        private set

    @Volatile var lastKey = ""
        private set

    override fun status(): Map<String, Any?> {
        val lines = shell.run(
            "getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release",
        ).lines().map { it.trim() }
        return mapOf(
            "manufacturer" to lines.getOrElse(0) { "" },
            "model" to lines.getOrElse(1) { "" },
            "android" to lines.getOrElse(2) { "" },
            "onBox" to true,
        )
    }

    override fun apps(): List<String> {
        val found = sortedSetOf<String>()
        for (category in LAUNCHER_CATEGORIES) {
            try {
                found += parseActivityPackages(
                    shell.run(
                        "cmd package query-activities --brief -a android.intent.action.MAIN -c $category",
                    ),
                )
            } catch (_: IOException) {
                // Older Android lacks `cmd package`; fall back to pm below.
            }
        }
        if (found.isEmpty()) found += parsePackageList(shell.run("pm list packages -3"))
        return found.toList()
    }

    override fun key(name: String?) {
        val code = KEYS[name] ?: throw IllegalArgumentException("unknown key: $name")
        input("key $name", listOf("press $code"), "input keyevent $code")
    }

    override fun text(value: String?) {
        val typed = toMonkeyTypeCommands(value)
        input("text", typed, toInputTextCommand(value))
    }

    override fun launch(pkg: String?) {
        require(isValidPackage(pkg)) { "invalid package" }
        val categories = LAUNCHER_CATEGORIES.joinToString(" ") { "-c $it" }
        val output = synchronized(inputLock) {
            shell.run("monkey -p $pkg $categories 1 2>&1")
        }
        if (Regex("monkey aborted|No activities found", RegexOption.IGNORE_CASE).containsMatchIn(output)) {
            throw IOException("$pkg has no launchable activity")
        }
    }

    override fun reconnect(): String {
        synchronized(inputLock) { closeMonkey() }
        return shell.reconnect()
    }

    // Keeps monkey running in the background for as long as the app runs.
    fun startFastKeys() {
        if (!fastKeys) return
        synchronized(this) {
            if (keeper?.isAlive == true) return
            keeper = thread(name = "monkey-keeper", isDaemon = true) {
                while (!Thread.currentThread().isInterrupted) {
                    val delay = if (ensureMonkey()) 2_000L else 15_000L
                    try {
                        pause(delay)
                    } catch (_: InterruptedException) {
                        return@thread
                    }
                }
            }
        }
    }

    fun close() {
        synchronized(this) {
            keeper?.interrupt()
            keeper = null
        }
        synchronized(inputLock) { closeMonkey() }
    }

    // Opens the monkey channel if it is not open. Returns whether it is.
    fun ensureMonkey(): Boolean {
        if (monkey != null) return true
        val started = clock()
        return try {
            val (link, process) = openMonkey()
            synchronized(inputLock) {
                monkey = link
                monkeyProcess = process
            }
            fastKeysError = ""
            log("monkey ready in ${clock() - started} ms")
            true
        } catch (error: IOException) {
            fastKeysError = error.message ?: error.javaClass.simpleName
            log("monkey unavailable after ${clock() - started} ms: $fastKeysError")
            false
        }
    }

    private fun input(label: String, fast: List<String>?, slow: String) {
        synchronized(inputLock) {
            val started = clock()
            val path = if (fast != null && sendFast(fast)) "monkey" else {
                shell.run(slow)
                "input"
            }
            lastKey = "${clock() - started} ms ($path)"
            log("$label: $lastKey")
        }
    }

    // Sends the commands in order. Returns false when nothing reached the
    // box, so the caller can fall back; throws when only part was sent,
    // because repeating it another way would duplicate input.
    private fun sendFast(commands: List<String>): Boolean {
        val link = monkey ?: return false
        var sent = 0
        try {
            for (command in commands) {
                link.send(command)
                sent += 1
            }
            return true
        } catch (error: IOException) {
            // The keeper starts a new session.
            closeMonkey()
            fastKeysError = error.message ?: error.javaClass.simpleName
            log("monkey failed: $fastKeysError")
            if (sent > 0) throw IOException("input interrupted after $sent steps: ${error.message}", error)
            return false
        }
    }

    // Reuses a monkey that is already listening (left from an earlier run);
    // otherwise stops any stray one, which would hold the port, and starts a
    // new one. Monkey can take many seconds to start on a slow box: it starts
    // a JVM and, on the first connection, hooks into accessibility.
    private fun openMonkey(): Pair<MonkeyLink, AutoCloseable?> {
        probeMonkey(STARTUP_TIMEOUT_MS)?.let { return it to null }
        // The brackets keep the pattern from matching this shell's own
        // command line.
        runCatching { shell.run("pkill -f com.android.commands.monke[y]") }
        val process = shell.start("monkey --port $MONKEY_PORT")
        val deadline = clock() + STARTUP_TIMEOUT_MS
        var lastError: IOException? = null
        while (clock() < deadline) {
            try {
                val link = probeMonkey(STARTUP_TIMEOUT_MS, quiet = false)
                if (link != null) return link to process
            } catch (error: IOException) {
                lastError = error
            }
            pause(500)
        }
        process.close()
        throw lastError ?: IOException("monkey did not start")
    }

    // Connects and checks that monkey answers. Returns null when nothing
    // listens; with quiet = false, an answer that never comes throws.
    private fun probeMonkey(timeoutMs: Int, quiet: Boolean = true): MonkeyLink? {
        val link = try {
            connectMonkey(MONKEY_PORT, timeoutMs)
        } catch (_: IOException) {
            return null
        }
        try {
            link.send("getvar build.version.release")
            link.setReadTimeout(KEY_TIMEOUT_MS)
            return link
        } catch (error: IOException) {
            runCatching { link.close() }
            if (quiet) return null
            throw error
        }
    }

    private fun closeMonkey() {
        runCatching { monkey?.close() }
        monkey = null
        runCatching { monkeyProcess?.close() }
        monkeyProcess = null
    }

    private companion object {
        const val STARTUP_TIMEOUT_MS = 30_000
        const val KEY_TIMEOUT_MS = 5_000
    }
}
