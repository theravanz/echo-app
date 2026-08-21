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
        private const val CHANNEL_ID_CALL = "echo_calls"
        private const val NOTIFICATION_ID_BASE = 1000
        private const val CALL_NOTIFICATION_ID = 2001
    }

    /**
     * Вызывается при получении нового FCM токена (при первом запуске или обновлении).
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM token: $token")

        // Храним напрямую — JS-мост (window.EchoNative.getFcmToken())
        // читает отсюда, чтобы передать токен в Rust-бэкенд / Supabase.
        FcmTokenHolder.token = token

        // Персистим на случай перезапуска процесса (onNewToken повторно
        // может не вызваться — Firebase кэширует токен на устройстве).
        try {
            getSharedPreferences("echo_fcm", MODE_PRIVATE)
                .edit().putString("fcm_token", token).apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to persist FCM token", e)
        }

        // Отправляем токен в Rust-бэкенд через IPC (broadcast для FcmTokenReceiver)
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
     * format: { type:"new_message", chat_id, sender_id, sender_name, sender_avatar, ts }
     */
    private fun handleDataMessage(data: Map<String, String>) {
        when (data["type"]) {
            "new_message" -> {
                // В фореграунде WebView уже показал сообщение в реальном времени —
                // не дублируем системной шторкой.
                if (!AppForeground.isForeground) {
                    val chatId = data["chat_id"] ?: data["chatId"]
                    val senderName = data["sender_name"]?.takeIf { it.isNotBlank() }
                        ?: "Новое сообщение"
                    showLocalNotification(senderName, "Новое сообщение", chatId)
                }
            }
            "incoming_call" -> handleIncomingCall(data)
            else -> {
                // Legacy-формат (chatId/senderId/title/body) — фолбэк
                val chatId = data["chatId"]
                val senderId = data["senderId"]
                val title = data["title"] ?: "Echo"
                val body = data["body"] ?: "New message"
                showLocalNotification(title, body, chatId ?: senderId)
            }
        }
    }

    /**
     * Входящий звонок: будим приложение полноэкранным уведомлением звонка
     * (fullScreenIntent → MainActivity c данными звонка). MainActivity разберёт
     * Intent и поднимет экран звонка в WebView.
     * format: { type:"incoming_call", room_id, caller_id, caller_name, caller_avatar }
     */
    private fun handleIncomingCall(data: Map<String, String>) {
        val roomId = data["room_id"] ?: return
        val callerId = data["caller_id"] ?: return
        val callerName = data["caller_name"]?.takeIf { it.isNotBlank() } ?: "Входящий звонок"
        val callerAvatar = data["caller_avatar"] ?: ""

        Log.d(TAG, "Incoming call from $callerName (room $roomId)")

        // Explicit-Intent в MainActivity: singleTop + newTask — если Activity жива,
        // сработает onNewIntent; если нет — onCreate. Данные звонка в extras.
        val intent = Intent(this, MainActivity::class.java).apply {
            action = "com.theravanz.echo_tauri.INCOMING_CALL"
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("echo_incoming", true)
            putExtra("echo_room_id", roomId)
            putExtra("echo_caller_id", callerId)
            putExtra("echo_caller_name", callerName)
            putExtra("echo_caller_avatar", callerAvatar)
        }

        val requestCode = callerId.hashCode()
        val pendingIntent = PendingIntent.getActivity(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID_CALL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(callerName)
            .setContentText("Входящий звонок…")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(false)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true)
            .setVibrate(longArrayOf(0, 500, 200, 500))
            .build()

        try {
            NotificationManagerCompat.from(this).notify(CALL_NOTIFICATION_ID, notification)
            Log.d(TAG, "Incoming call notification shown: $callerName")
        } catch (e: SecurityException) {
            Log.w(TAG, "No notification permission", e)
        }
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
