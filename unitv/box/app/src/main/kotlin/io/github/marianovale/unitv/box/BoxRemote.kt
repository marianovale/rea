package io.github.marianovale.unitv.box

import android.content.Context
import io.github.marianovale.unitv.remote.Api
import io.github.marianovale.unitv.remote.HttpServer
import io.github.marianovale.unitv.remote.ShellDevice
import java.net.Inet4Address
import java.net.NetworkInterface
import java.security.SecureRandom

// Everything the remote needs, owned once per app process: the adb session
// to the box itself, the device driver, and the HTTP server for the phone.
// RemoteService starts it; MainActivity only reads it.
object BoxRemote {
    const val PORT = 8787

    private var running: Running? = null

    private class Running(val adb: LocalAdb, val device: ShellDevice, val server: HttpServer)

    val adbState: LocalAdb.State? get() = running?.adb?.state
    val adbDetail: String get() = running?.adb?.detail.orEmpty()
    val fastKeysActive: Boolean? get() = running?.device?.fastKeysActive
    val fastKeysError: String get() = running?.device?.fastKeysError.orEmpty()

    @Synchronized
    fun start(context: Context) {
        if (running != null) return
        val app = context.applicationContext
        val adb = LocalAdb(app.filesDir)
        val device = ShellDevice(adb)
        val html = app.assets.open("index.html").use { it.readBytes() }
        val api = Api(device, token = { token(app) }, html = { html })
        val server = HttpServer(api, PORT).start()
        adb.connect()
        running = Running(adb, device, server)
    }

    @Synchronized
    fun stop() {
        val current = running ?: return
        running = null
        current.server.close()
        current.device.close()
        current.adb.close()
    }

    fun reconnect() {
        running?.device?.reconnect()
    }

    // The token survives restarts so the bookmark on the phone keeps working.
    @Synchronized
    fun token(context: Context): String {
        val prefs = prefs(context)
        prefs.getString("token", null)?.let { return it }
        return newToken(context)
    }

    // Invalidates every phone that had the old link.
    @Synchronized
    fun newToken(context: Context): String {
        val bytes = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val token = bytes.joinToString("") { "%02x".format(it) }
        prefs(context).edit().putString("token", token).apply()
        return token
    }

    fun links(context: Context): List<String> =
        lanAddresses().map { "http://$it:$PORT/#t=${token(context)}" }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences("remote", Context.MODE_PRIVATE)

    private fun lanAddresses(): List<String> =
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .map { it.hostAddress.orEmpty() }
            .filter { it.isNotEmpty() }
}
