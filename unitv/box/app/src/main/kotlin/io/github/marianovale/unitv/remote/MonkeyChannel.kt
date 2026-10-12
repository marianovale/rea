package io.github.marianovale.unitv.remote

import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket

// Talks to `monkey --port`, which listens on the box's loopback address.
// Each command is one line and monkey answers each with "OK" or "ERROR".
class MonkeyChannel private constructor(private val socket: Socket) : MonkeyLink {
    private val reader = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
    private val writer = socket.getOutputStream().bufferedWriter(Charsets.US_ASCII)

    override fun send(command: String) {
        writer.write(command)
        writer.write("\n")
        writer.flush()
        val line = reader.readLine()?.trim() ?: throw IOException("monkey connection closed")
        if (!line.startsWith("OK")) throw IOException("monkey: $line")
    }

    override fun setReadTimeout(ms: Int) {
        socket.soTimeout = ms
    }

    // "quit" stops monkey itself, so it does not linger on the box.
    override fun close() {
        runCatching {
            writer.write("quit\n")
            writer.flush()
        }
        socket.close()
    }

    companion object {
        fun connect(port: Int, readTimeoutMs: Int): MonkeyLink {
            val socket = Socket()
            try {
                socket.tcpNoDelay = true
                socket.connect(InetSocketAddress("127.0.0.1", port), 2_000)
                socket.soTimeout = readTimeoutMs
                return MonkeyChannel(socket)
            } catch (error: IOException) {
                socket.close()
                throw error
            }
        }
    }
}
