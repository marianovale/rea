package io.github.marianovale.unitv.remote

import java.io.IOException

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
}

private val LAUNCHER_CATEGORIES = listOf(
    "android.intent.category.LEANBACK_LAUNCHER",
    "android.intent.category.LAUNCHER",
)

const val MONKEY_PORT = 1080

// Drives the box through a shell. Keys go through `monkey --port`, the input
// injector that ships with Android: it stays running, so a press costs one
// socket round trip instead of starting `input` (a fresh JVM) each time. If
// monkey cannot start, keys fall back to `input keyevent` and monkey is
// retried a minute later.
class ShellDevice(
    private val shell: Shell,
    private val fastKeys: Boolean = true,
    private val timeoutMs: Int = 6000,
    private val connectMonkey: (port: Int, timeoutMs: Int) -> MonkeyLink = MonkeyChannel::connect,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pause: (Long) -> Unit = Thread::sleep,
) : Device {
    // Input runs one command at a time so presses reach the box in order.
    private val inputLock = Any()
    private var monkey: MonkeyLink? = null
    private var monkeyProcess: AutoCloseable? = null
    private var retryAt = 0L

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
        synchronized(inputLock) {
            if (sendFast(listOf("press $code"))) return
            shell.run("input keyevent $code")
        }
    }

    override fun text(value: String?) {
        val typed = toMonkeyTypeCommands(value)
        val fallback = toInputTextCommand(value)
        synchronized(inputLock) {
            if (typed != null && sendFast(typed)) return
            shell.run(fallback)
        }
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

    override fun reconnect(): String = synchronized(inputLock) {
        closeMonkey()
        retryAt = 0
        shell.reconnect()
    }

    fun close() = synchronized(inputLock) { closeMonkey() }

    // Sends the commands in order. Returns false when nothing reached the
    // box, so the caller can fall back; throws when only part was sent,
    // because repeating it another way would duplicate input.
    private fun sendFast(commands: List<String>): Boolean {
        if (!fastKeys || clock() < retryAt) return false
        var sent = 0
        try {
            val link = monkey ?: openMonkey().also { monkey = it }
            for (command in commands) {
                link.send(command)
                sent += 1
            }
            return true
        } catch (error: IOException) {
            closeMonkey()
            retryAt = clock() + 60_000
            if (sent > 0) throw IOException("input interrupted after $sent steps: ${error.message}", error)
            return false
        }
    }

    private fun openMonkey(): MonkeyLink {
        val process = shell.start("monkey --port $MONKEY_PORT")
        // The port accepts connections only once monkey listens, and monkey
        // counts as up only once it answers a command.
        val deadline = clock() + timeoutMs
        while (true) {
            try {
                val link = connectMonkey(MONKEY_PORT, timeoutMs)
                try {
                    link.send("getvar build.version.release")
                } catch (error: IOException) {
                    link.close()
                    throw error
                }
                monkeyProcess = process
                return link
            } catch (error: IOException) {
                if (clock() > deadline) {
                    process.close()
                    throw error
                }
                pause(300)
            }
        }
    }

    private fun closeMonkey() {
        runCatching { monkey?.close() }
        monkey = null
        runCatching { monkeyProcess?.close() }
        monkeyProcess = null
    }
}
