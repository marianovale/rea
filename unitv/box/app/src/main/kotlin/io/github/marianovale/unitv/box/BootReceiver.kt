package io.github.marianovale.unitv.box

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Starts the remote when the box boots, so it works without opening the app.
// Android only delivers this after the app has been opened once.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action in BOOT_ACTIONS) RemoteService.start(context)
    }

    private companion object {
        val BOOT_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            // Some boxes send this on a fast boot instead.
            "android.intent.action.QUICKBOOT_POWERON",
        )
    }
}
