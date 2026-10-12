package io.github.marianovale.unitv.box

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import io.github.marianovale.unitv.R

// The screen on the TV: whether the remote is ready and a QR code with the
// link for the phone. Opening it once also enables the start-on-boot.
class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, 1000)
        }
    }
    private var shownLink: String? = null

    private lateinit var status: TextView
    private lateinit var link: TextView
    private lateinit var qr: ImageView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        link = findViewById(R.id.link)
        qr = findViewById(R.id.qr)
        findViewById<Button>(R.id.new_link).setOnClickListener {
            BoxRemote.newToken(this)
            render()
        }
        findViewById<Button>(R.id.reconnect).setOnClickListener {
            BoxRemote.reconnect()
            render()
        }
        RemoteService.start(this)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    private fun render() {
        status.text = statusText()
        val links = BoxRemote.links(this)
        val first = links.firstOrNull()
        link.text = if (links.isEmpty()) getString(R.string.no_network) else links.joinToString("\n")
        if (first != shownLink) {
            shownLink = first
            qr.setImageBitmap(first?.let(::qrCode))
        }
    }

    private fun statusText(): String {
        RemoteService.lastError.takeIf { it.isNotEmpty() }?.let {
            return getString(R.string.status_server_failed, it)
        }
        return when (BoxRemote.adbState) {
            null, LocalAdb.State.CONNECTING -> getString(R.string.status_connecting)
            LocalAdb.State.WAITING_FOR_APPROVAL -> getString(R.string.status_waiting)
            LocalAdb.State.NO_NETWORK_ADB -> getString(R.string.status_no_adb)
            LocalAdb.State.FAILED -> getString(R.string.status_failed, BoxRemote.adbDetail)
            LocalAdb.State.READY -> when (BoxRemote.fastKeysActive) {
                null -> getString(R.string.status_ready)
                true -> getString(R.string.status_ready) + "\n" + getString(R.string.keys_fast)
                false -> getString(R.string.status_ready) + "\n" +
                    getString(R.string.keys_slow, BoxRemote.fastKeysError)
            }
        }
    }

    private fun qrCode(text: String): Bitmap {
        val size = 480
        val matrix = QRCodeWriter().encode(
            text,
            BarcodeFormat.QR_CODE,
            size,
            size,
            mapOf(EncodeHintType.MARGIN to 1),
        )
        val pixels = IntArray(size * size) { i ->
            if (matrix[i % size, i / size]) Color.BLACK else Color.WHITE
        }
        return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.RGB_565)
    }
}
