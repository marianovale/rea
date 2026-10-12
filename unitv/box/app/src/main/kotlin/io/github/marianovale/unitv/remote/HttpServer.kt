package io.github.marianovale.unitv.remote

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URI
import java.util.concurrent.ExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

// A small HTTP/1.1 server for the phone page: keep-alive, small bodies, no
// TLS. It only has to serve one household on the LAN, and
// it avoids a server library on a box with 1 GB of RAM.
class HttpServer(
    private val api: Api,
    private val port: Int,
    private val log: (String) -> Unit = {},
) : AutoCloseable {
    private val server = ServerSocket()
    // One thread per open connection. Phone browsers open spare connections
    // and leave them idle, so a small fixed pool would make key presses
    // queue behind connections that never send anything.
    private val workers: ExecutorService = ThreadPoolExecutor(
        0,
        MAX_CONNECTIONS,
        30,
        TimeUnit.SECONDS,
        SynchronousQueue(),
    ) { task -> Thread(task, "http").apply { isDaemon = true } }

    val localPort: Int get() = server.localPort

    fun start(): HttpServer {
        server.reuseAddress = true
        server.bind(InetSocketAddress(port))
        thread(name = "http-accept", isDaemon = true) {
            while (!server.isClosed) {
                val socket = try {
                    server.accept()
                } catch (_: SocketException) {
                    break
                }
                try {
                    workers.execute { serve(socket) }
                } catch (_: RejectedExecutionException) {
                    socket.close()
                }
            }
        }
        return this
    }

    override fun close() {
        server.close()
        workers.shutdownNow()
    }

    private fun serve(socket: Socket) {
        socket.use { respond(it) }
    }

    // Serves requests on one connection until the client closes it or it sits
    // idle, like Node's server, which the phone remote worked well with:
    // Safari keeps the connection for the next press and opens spare ones in
    // advance, and closing those early makes it retry.
    private fun respond(socket: Socket) {
        socket.soTimeout = IDLE_TIMEOUT_MS
        val input = BufferedInputStream(socket.getInputStream())
        val output = socket.getOutputStream()
        var waitingSince = System.nanoTime()
        while (true) {
            var request = ""
            var handled = 0L
            var keepAlive = true
            val response = try {
                read(input) { method, path, headers ->
                    request = "$method $path"
                    handled = System.nanoTime()
                    keepAlive = headers["connection"]?.equals("close", ignoreCase = true) != true
                }
            } catch (error: BadRequest) {
                keepAlive = false
                Api.Response(400, "application/json", "{\"error\":\"${error.message}\"}".toByteArray())
            } catch (_: IOException) {
                return
            }
            val head = buildString {
                append("HTTP/1.1 ${response.status} ${reason(response.status)}\r\n")
                append("Content-Type: ${response.contentType}\r\n")
                append("Content-Length: ${response.body.size}\r\n")
                append("Cache-Control: no-store\r\n")
                if (keepAlive) {
                    append("Connection: keep-alive\r\n")
                    append("Keep-Alive: timeout=${IDLE_TIMEOUT_MS / 1000 - 5}\r\n\r\n")
                } else {
                    append("Connection: close\r\n\r\n")
                }
            }
            try {
                output.write(head.toByteArray(Charsets.ISO_8859_1))
                output.write(response.body)
                output.flush()
            } catch (_: IOException) {
                return
            }
            // How long the request took to arrive after the connection opened
            // or the previous answer, and how long the box took to act on it.
            val done = System.nanoTime()
            if (request.isNotEmpty() && request != "GET /") {
                log("$request -> ${response.status}: waited ${(handled - waitingSince) / 1_000_000} ms, handled in ${(done - handled) / 1_000_000} ms")
            }
            if (!keepAlive) return
            waitingSince = done
        }
    }

    private fun read(
        input: InputStream,
        onRequest: (method: String, path: String, headers: Map<String, String>) -> Unit,
    ): Api.Response {
        val requestLine = readLine(input) ?: throw IOException("connection closed")
        val parts = requestLine.split(" ")
        if (parts.size != 3) throw BadRequest("bad request line")
        val (method, target) = parts
        val path = try {
            URI(target).rawPath ?: throw BadRequest("bad path")
        } catch (_: java.net.URISyntaxException) {
            throw BadRequest("bad path")
        }

        val headers = mutableMapOf<String, String>()
        var headerBytes = 0
        while (true) {
            val line = readLine(input) ?: throw IOException("connection closed")
            if (line.isEmpty()) break
            headerBytes += line.length
            if (headerBytes > MAX_HEADERS) throw BadRequest("headers too large")
            val colon = line.indexOf(':')
            if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
        }

        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length < 0 || length > MAX_BODY) {
            // Drain what the client already sent, so it reads the 400
            // instead of a reset connection.
            var left = minOf(length.toLong(), 65_536L)
            while (left > 0) {
                val skipped = input.skip(left)
                if (skipped <= 0) break
                left -= skipped
            }
            throw BadRequest("body too large")
        }
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) throw IOException("connection closed")
            read += n
        }
        onRequest(method, path, headers)
        return api.handle(method, path, headers, body)
    }

    // Reads one CRLF-terminated line as ISO-8859-1, as HTTP headers are.
    private fun readLine(input: InputStream): String? {
        val line = ByteArrayOutputStream()
        while (true) {
            val byte = input.read()
            if (byte < 0) return if (line.size() == 0) null else line.toString("ISO-8859-1")
            if (byte == '\n'.code) return line.toString("ISO-8859-1").trimEnd('\r')
            if (line.size() >= MAX_LINE) throw BadRequest("line too long")
            line.write(byte)
        }
    }

    private class BadRequest(message: String) : Exception(message)

    private companion object {
        const val MAX_CONNECTIONS = 64
        const val IDLE_TIMEOUT_MS = 60_000
        const val MAX_BODY = 4096
        const val MAX_LINE = 8192
        const val MAX_HEADERS = 16384

        fun reason(status: Int) = when (status) {
            200 -> "OK"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            404 -> "Not Found"
            else -> "Bad Gateway"
        }
    }
}
