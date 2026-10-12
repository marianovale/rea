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

// A small HTTP/1.1 server for the phone page: one request per connection,
// small bodies, no TLS. It only has to serve one household on the LAN, and
// it avoids a server library on a box with 1 GB of RAM.
class HttpServer(private val api: Api, private val port: Int) : AutoCloseable {
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

    private fun respond(socket: Socket) {
        socket.soTimeout = 5_000
        val input = BufferedInputStream(socket.getInputStream())
        val response = try {
            read(input)
        } catch (error: BadRequest) {
            Api.Response(400, "application/json", "{\"error\":\"${error.message}\"}".toByteArray())
        } catch (_: IOException) {
            return
        }
        val head = buildString {
            append("HTTP/1.1 ${response.status} ${reason(response.status)}\r\n")
            append("Content-Type: ${response.contentType}\r\n")
            append("Content-Length: ${response.body.size}\r\n")
            append("Cache-Control: no-store\r\n")
            append("Connection: close\r\n\r\n")
        }
        runCatching {
            val output = socket.getOutputStream()
            output.write(head.toByteArray(Charsets.ISO_8859_1))
            output.write(response.body)
            output.flush()
        }
    }

    private fun read(input: InputStream): Api.Response {
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
