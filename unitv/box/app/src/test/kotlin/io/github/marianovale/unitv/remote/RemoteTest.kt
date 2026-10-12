package io.github.marianovale.unitv.remote

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import kotlin.concurrent.thread
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InputTest {
    @Test
    fun quotesTypedTextForTheShell() {
        assertEquals("input text 'acao%sit'\\''s'", toInputTextCommand("ação it's"))
        assertFailsWith<IllegalArgumentException> { toInputTextCommand("   ") }
        assertFailsWith<IllegalArgumentException> { toInputTextCommand(null) }
    }

    @Test
    fun splitsMonkeyTypingIntoWords() {
        assertEquals(
            listOf("type ola", "press KEYCODE_SPACE", "type mundo"),
            toMonkeyTypeCommands("olá mundo"),
        )
        assertNull(toMonkeyTypeCommands("it's"))
    }

    @Test
    fun validatesPackages() {
        assertTrue(isValidPackage("com.netflix.ninja"))
        assertEquals(false, isValidPackage("com.x; reboot"))
        assertEquals(false, isValidPackage("single"))
    }

    @Test
    fun parsesActivityAndPackageListings() {
        val output = """
            com.netflix.ninja/.MainActivity
            packageName=org.videolan.vlc
            junk; rm -rf /
        """.trimIndent()
        assertEquals(listOf("com.netflix.ninja", "org.videolan.vlc"), parseActivityPackages(output))
        assertEquals(listOf("a.b", "c.d"), parsePackageList("package:c.d\npackage:a.b\nbad\n"))
    }
}

private class FakeShell : Shell {
    val commands = mutableListOf<String>()
    val started = mutableListOf<String>()
    var stopped = 0
    var failRun: String? = null

    override fun run(command: String): String {
        commands += command
        failRun?.let { if (command.contains(it)) throw IOException("cmd: not found") }
        return when {
            command.startsWith("getprop") -> "UniTV\nV10\n10\n"
            command.contains("LEANBACK") -> "com.netflix.ninja/.Main\n"
            command.contains("-c android.intent.category.LAUNCHER") -> "org.videolan.vlc/.Start\n"
            command.startsWith("pm list") -> "package:com.only.fallback\n"
            else -> ""
        }
    }

    override fun start(command: String): AutoCloseable {
        started += command
        return AutoCloseable { stopped += 1 }
    }

    override fun reconnect() = "reconnected"
}

private class FakeMonkey(private val failOn: String? = null) : MonkeyLink {
    val sent = mutableListOf<String>()
    var closed = false

    override fun send(command: String) {
        if (failOn != null && command.startsWith(failOn)) throw IOException("monkey: ERROR")
        sent += command
    }

    override fun close() {
        closed = true
    }
}

class ShellDeviceTest {
    @Test
    fun reusesARunningMonkeyAndSendsKeysThroughIt() {
        val shell = FakeShell()
        val monkey = FakeMonkey()
        val device = ShellDevice(shell, connectMonkey = { _, _ -> monkey })

        assertTrue(device.ensureMonkey())
        device.key("up")
        device.key("ok")

        assertTrue(shell.started.isEmpty())
        assertEquals(
            listOf("getvar build.version.release", "press KEYCODE_DPAD_UP", "press KEYCODE_DPAD_CENTER"),
            monkey.sent,
        )
        assertTrue(shell.commands.isEmpty())
        assertTrue(device.fastKeysReady)
        assertTrue(device.lastKey.endsWith("(monkey)"))
    }

    @Test
    fun startsMonkeyWhenNoneIsListening() {
        val shell = FakeShell()
        val monkey = FakeMonkey()
        var connects = 0
        val device = ShellDevice(
            shell,
            pause = {},
            connectMonkey = { _, _ -> if (++connects <= 2) throw IOException("refused") else monkey },
        )

        assertTrue(device.ensureMonkey())
        assertEquals(listOf("pkill -f com.android.commands.monke[y]"), shell.commands)
        assertEquals(listOf("monkey --port 1080"), shell.started)
    }

    @Test
    fun keysDoNotWaitForMonkeyToStart() {
        val shell = FakeShell()
        val device = ShellDevice(shell, connectMonkey = { _, _ -> error("not called") })
        device.key("back")
        assertEquals(listOf("input keyevent KEYCODE_BACK"), shell.commands)
        assertTrue(device.lastKey.endsWith("(input)"))
    }

    @Test
    fun givesUpOnAMonkeyThatNeverStarts() {
        var now = 0L
        val shell = FakeShell()
        val device = ShellDevice(
            shell,
            clock = { now },
            pause = { now += it },
            connectMonkey = { _, _ -> throw IOException("refused") },
        )
        assertEquals(false, device.ensureMonkey())
        assertEquals(1, shell.stopped)
        assertEquals("monkey did not start", device.fastKeysError)
    }

    @Test
    fun fallsBackToInputWhenMonkeyFails() {
        val shell = FakeShell()
        val device = ShellDevice(shell, connectMonkey = { _, _ -> FakeMonkey(failOn = "press") })
        assertTrue(device.ensureMonkey())
        device.key("home")
        assertEquals(listOf("input keyevent KEYCODE_HOME"), shell.commands)
        assertEquals(false, device.fastKeysReady)
        assertEquals("monkey: ERROR", device.fastKeysError)
    }

    @Test
    fun doesNotRepeatTextThatWasPartlyTyped() {
        val shell = FakeShell()
        val device = ShellDevice(shell, connectMonkey = { _, _ -> FakeMonkey(failOn = "type b") })
        assertTrue(device.ensureMonkey())
        val error = assertFailsWith<IOException> { device.text("a b") }
        assertTrue(error.message!!.contains("interrupted after 2 steps"))
        assertTrue(shell.commands.isEmpty())
    }

    @Test
    fun typesQuotedTextWithInput() {
        val shell = FakeShell()
        val device = ShellDevice(shell, connectMonkey = { _, _ -> FakeMonkey() })
        assertTrue(device.ensureMonkey())
        device.text("it's")
        assertEquals(listOf("input text 'it'\\''s'"), shell.commands)
    }

    @Test
    fun rejectsUnknownKeysAndPackages() {
        val device = ShellDevice(FakeShell(), connectMonkey = { _, _ -> FakeMonkey() })
        assertFailsWith<IllegalArgumentException> { device.key("reboot") }
        assertFailsWith<IllegalArgumentException> { device.launch("x; reboot") }
    }

    @Test
    fun listsLauncherAppsAndFallsBackToPm() {
        assertEquals(
            listOf("com.netflix.ninja", "org.videolan.vlc"),
            ShellDevice(FakeShell()).apps(),
        )
        val old = FakeShell().apply { failRun = "cmd package" }
        assertEquals(listOf("com.only.fallback"), ShellDevice(old).apps())
    }

    @Test
    fun reportsStatus() {
        val status = ShellDevice(FakeShell()).status()
        assertEquals("V10", status["model"])
        assertEquals(true, status["onBox"])
    }
}

class HttpServerTest {
    private val shell = FakeShell()
    private val server = HttpServer(
        Api(
            ShellDevice(shell),
            token = { "secret" },
            html = { "<html>remote</html>".toByteArray() },
        ),
        port = 0,
    ).start()

    @AfterTest
    fun stop() = server.close()

    private fun call(method: String, path: String, body: String? = null, token: String? = "secret"): Pair<Int, String> {
        val connection = URL("http://127.0.0.1:${server.localPort}$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        token?.let { connection.setRequestProperty("x-token", it) }
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray()) }
        }
        val status = connection.responseCode
        val stream = if (status < 400) connection.inputStream else connection.errorStream
        return status to stream.bufferedReader().readText()
    }

    @Test
    fun servesThePageWithoutAToken() {
        assertEquals(200 to "<html>remote</html>", call("GET", "/", token = null))
    }

    @Test
    fun requiresTheToken() {
        assertEquals(401, call("GET", "/api/status", token = null).first)
        assertEquals(401, call("GET", "/api/status", token = "wrong").first)
    }

    @Test
    fun pressesKeysAndReportsErrors() {
        assertEquals(200 to "{\"ok\":true}", call("POST", "/api/key", "{\"key\":\"home\"}"))
        assertEquals(listOf("input keyevent KEYCODE_HOME"), shell.commands)

        assertEquals(400, call("POST", "/api/key", "{\"key\":\"nope\"}").first)
        assertEquals(400, call("POST", "/api/key", "not json").first)
        assertEquals(400, call("POST", "/api/text", "x".repeat(5000)).first)
        assertEquals(404, call("GET", "/api/nothing").first)

        shell.failRun = "input"
        val (status, body) = call("POST", "/api/key", "{\"key\":\"home\"}")
        assertEquals(502, status)
        assertEquals("cmd: not found", JSONObject(body).getString("error"))
    }

    // Phone browsers open spare connections and leave them idle; those must
    // not hold up the next key press.
    @Test
    fun idleConnectionsDoNotDelayRequests() {
        val idle = List(8) { java.net.Socket("127.0.0.1", server.localPort) }
        try {
            val started = System.nanoTime()
            val connection = URL("http://127.0.0.1:${server.localPort}/").openConnection() as HttpURLConnection
            connection.readTimeout = 2000
            assertEquals(200, connection.responseCode)
            assertTrue((System.nanoTime() - started) / 1_000_000 < 1000)
        } finally {
            idle.forEach { it.close() }
        }
    }

    @Test
    fun keepsTheConnectionForTheNextPress() {
        java.net.Socket("127.0.0.1", server.localPort).use { socket ->
            socket.soTimeout = 2000
            val output = socket.getOutputStream()
            val input = socket.getInputStream().bufferedReader(Charsets.ISO_8859_1)
            val body = "{\"key\":\"up\"}"
            repeat(2) {
                output.write(
                    ("POST /api/key HTTP/1.1\r\nHost: box\r\nx-token: secret\r\n" +
                        "Content-Length: ${body.length}\r\n\r\n$body").toByteArray(),
                )
                output.flush()
                assertEquals("HTTP/1.1 200 OK", input.readLine())
                val headers = generateSequence { input.readLine() }.takeWhile { it.isNotEmpty() }.toList()
                assertTrue("Connection: keep-alive" in headers)
                val length = headers.first { it.startsWith("Content-Length") }.substringAfter(": ").toInt()
                assertEquals("{\"ok\":true}", CharArray(length).also { input.read(it) }.concatToString())
            }
        }
        assertEquals(listOf("input keyevent KEYCODE_DPAD_UP", "input keyevent KEYCODE_DPAD_UP"), shell.commands)
    }

    @Test
    fun returnsStatusAndApps() {
        val (_, status) = call("GET", "/api/status")
        assertEquals("UniTV", JSONObject(status).getString("manufacturer"))
        val (_, apps) = call("GET", "/api/apps")
        assertEquals(2, JSONObject(apps).getJSONArray("apps").length())
    }
}

class MonkeyChannelTest {
    @Test
    fun speaksMonkeysLineProtocol() {
        ServerSocket(0).use { listener ->
            val received = mutableListOf<String>()
            val peer = thread {
                listener.accept().use { socket ->
                    val reader = socket.getInputStream().bufferedReader()
                    val writer = socket.getOutputStream().bufferedWriter()
                    while (true) {
                        val line = reader.readLine() ?: break
                        received += line
                        if (line == "quit") break
                        writer.write(if (line.startsWith("bad")) "ERROR\n" else "OK\n")
                        writer.flush()
                    }
                }
            }
            val link = MonkeyChannel.connect(listener.localPort, 2000)
            link.send("press KEYCODE_HOME")
            assertFailsWith<IOException> { link.send("bad command") }
            link.close()
            peer.join(2000)
            assertEquals(listOf("press KEYCODE_HOME", "bad command", "quit"), received)
        }
    }
}
