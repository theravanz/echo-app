package com.theravanz.echo_tauri

import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Firebase Cloud Messaging Service для получения push-уведомлений.
 * Регистрирует FCM токен и обрабатывает входящие сообщения.
 */
class EchoFirebaseService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "EchoFCM"
        private const val CHANNEL_ID = "echo_messages"
        private const val NOTIFICATION_ID_BASE = 1000
    }

    /**
     * Вызывается при получении нового FCM токена (при первом запуске или обновлении).
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM token: $token")
        
        // Отправляем токен в Rust-бэкенд через IPC
        sendTokenToRustBackend(token)
    }

    /**
     * Вызывается при получении push-сообщения от FCM.
     */
    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        Log.d(TAG, "Message received: ${message.messageId}")

        // Проверяем наличие данных
        val messageData = message.data
        if (messageData.isNotEmpty()) {
            handleDataMessage(messageData)
        }

        // Проверяем наличие уведомления
        message.notification?.let { notification ->
            handleNotificationMessage(notification, messageData)
        }
    }

    /**
     * Обработка data-сообщений (тихие push).
     */
    private fun handleDataMessage(data: Map<String, String>) {
        val chatId = data["chatId"]
        val senderId = data["senderId"]
        val title = data["title"] ?: "Echo"
        val body = data["body"] ?: "New message"

        showLocalNotification(title, body, chatId)
    }

    /**
     * Обработка notification-сообщений (с видимым уведомлением).
     */
    private fun handleNotificationMessage(
        notification: RemoteMessage.Notification,
        data: Map<String, String>
    ) {
        val title = notification.title ?: "Echo"
        val body = notification.body ?: "New message"
        val chatId = data["chatId"] ?: notification.tag

        showLocalNotification(title, body, chatId)
    }

    /**
     * Показ локального уведомления.
     */
    private fun showLocalNotification(title: String, body: String, chatId: String?) {
        // Intent для открытия приложения при клике
        val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            chatId?.let { putExtra("chatId", it) }
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            System.currentTimeMillis().toInt(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build()

        try {
            val notificationId = chatId?.hashCode() ?: NOTIFICATION_ID_BASE
            NotificationManagerCompat.from(this).notify(notificationId, notification)
            Log.d(TAG, "Notification shown: $title")
        } catch (e: SecurityException) {
            Log.w(TAG, "No notification permission", e)
        }
    }

    /**
     * Отправка FCM токена в Rust-бэкенд через Tauri IPC.
     */
    private fun sendTokenToRustBackend(token: String) {
        try {
            // Используем Tauri plugin API для отправки токена в Rust
            // Это будет вызвано через WebView JS bridge
            val intent = Intent("com.theravanz.echo_tauri.FCM_TOKEN")
            intent.putExtra("token", token)
            sendBroadcast(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send token to backend", e)
        }
    }
}
