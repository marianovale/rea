package io.github.marianovale.unitv.box

import dadb.AdbKeyPair
import dadb.AdbShellPacket
import dadb.Dadb
import io.github.marianovale.unitv.remote.Shell
import java.io.File
import java.io.IOException
import java.net.ConnectException
import kotlin.concurrent.thread

// The box's own adbd, reached over its loopback address. An app cannot inject
// keys into other apps, but adb's `shell` user can, so the app connects to
// network adb on the same box exactly like the computer used to. The first
// connection shows "Allow USB debugging?" on the TV.
class LocalAdb(private val keyDir: File, private val port: Int = 5555) : Shell {
    enum class State { CONNECTING, WAITING_FOR_APPROVAL, NO_NETWORK_ADB, READY, FAILED }

    @Volatile var state = State.CONNECTING
        private set

    @Volatile var detail = ""
        private set

    private val lock = Any()
    @Volatile private var dadb: Dadb? = null
    private var connector: Thread? = null

    // Connects in the background and keeps retrying, because the handshake
    // blocks until someone answers the prompt on the TV.
    fun connect() {
        synchronized(lock) {
            if (connector?.isAlive == true || dadb != null) return
            connector = thread(name = "adb-connect", isDaemon = true) { connectLoop() }
        }
    }

    fun close() {
        synchronized(lock) {
            connector?.interrupt()
            connector = null
            runCatching { dadb?.close() }
            dadb = null
        }
    }

    override fun reconnect(): String {
        close()
        state = State.CONNECTING
        connect()
        return "reconnecting to adb on the box"
    }

    override fun run(command: String): String {
        val response = try {
            ready().shell(command)
        } catch (error: IOException) {
            lost(error)
            throw error
        }
        if (response.exitCode != 0) {
            val message = response.errorOutput.ifBlank { response.output }.trim()
            throw IOException(message.ifEmpty { "exit code ${response.exitCode}" })
        }
        return response.output
    }

    override fun start(command: String): AutoCloseable {
        val stream = try {
            ready().openShell(command)
        } catch (error: IOException) {
            lost(error)
            throw error
        }
        // Read and discard output so the command never blocks on a full pipe.
        thread(name = "adb-shell", isDaemon = true) {
            runCatching {
                while (stream.read() !is AdbShellPacket.Exit) Unit
            }
        }
        return AutoCloseable { runCatching { stream.close() } }
    }

    private fun ready(): Dadb {
        dadb?.let { return it }
        throw IOException(
            when (state) {
                State.WAITING_FOR_APPROVAL -> "unauthorized: allow USB debugging in the prompt on the TV"
                State.NO_NETWORK_ADB -> "network adb is off on the box (port $port refused)"
                else -> "adb on the box is not connected yet${if (detail.isNotEmpty()) ": $detail" else ""}"
            },
        )
    }

    // A failed call may mean the session dropped (adbd restarted, debugging
    // turned off), so it is reopened in the background; the call still fails
    // so the phone shows why.
    private fun lost(error: IOException) {
        synchronized(lock) {
            val current = dadb ?: return
            runCatching { current.close() }
            dadb = null
            state = State.CONNECTING
            detail = error.message ?: ""
        }
        connect()
    }

    private fun connectLoop() {
        var delayMs = 2_000L
        while (!Thread.currentThread().isInterrupted) {
            state = State.CONNECTING
            val approval = thread(isDaemon = true) {
                // A handshake still open after a few seconds is waiting for
                // someone to answer the prompt on the TV.
                try {
                    Thread.sleep(3_000)
                    if (state == State.CONNECTING) state = State.WAITING_FOR_APPROVAL
                } catch (_: InterruptedException) {
                }
            }
            try {
                val connection = Dadb.create("127.0.0.1", port, keyPair(), connectTimeout = 3_000)
                connection.supportsFeature("shell_v2") // forces the handshake
                approval.interrupt()
                synchronized(lock) {
                    if (Thread.currentThread().isInterrupted) {
                        connection.close()
                        return
                    }
                    dadb = connection
                    connector = null
                    state = State.READY
                    detail = ""
                }
                return
            } catch (error: Exception) {
                approval.interrupt()
                val refused = generateSequence<Throwable>(error) { it.cause }.any { it is ConnectException }
                state = if (refused) State.NO_NETWORK_ADB else State.FAILED
                detail = error.message ?: error.javaClass.simpleName
            }
            try {
                Thread.sleep(delayMs)
            } catch (_: InterruptedException) {
                return
            }
            // A rejected prompt should not pop up again every two seconds.
            delayMs = minOf(delayMs * 2, 30_000L)
        }
    }

    // The key pair is this app's identity to adbd; keeping it means the
    // "always allow" answer on the TV survives restarts.
    private fun keyPair(): AdbKeyPair {
        val privateKey = File(keyDir, "adbkey")
        val publicKey = File(keyDir, "adbkey.pub")
        if (!privateKey.exists() || !publicKey.exists()) AdbKeyPair.generate(privateKey, publicKey)
        return AdbKeyPair.read(privateKey, publicKey)
    }
}
