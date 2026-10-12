package io.github.marianovale.unitv.box

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import io.github.marianovale.unitv.R

// Keeps the remote running while the box is on. A foreground service is
// what stops Android from killing it to free memory on a 1 GB box.
class RemoteService : Service() {
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.app_name), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_remote)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_text, BoxRemote.PORT))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        startForeground(NOTIFICATION_ID, notification)
        try {
            BoxRemote.start(this)
        } catch (error: Exception) {
            // Most likely the port is taken; MainActivity shows the state.
            lastError = error.message ?: error.javaClass.simpleName
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onDestroy() {
        BoxRemote.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "remote"
        private const val NOTIFICATION_ID = 1

        @Volatile var lastError = ""
            private set

        fun start(context: Context) {
            lastError = ""
            context.startForegroundService(Intent(context, RemoteService::class.java))
        }
    }
}
