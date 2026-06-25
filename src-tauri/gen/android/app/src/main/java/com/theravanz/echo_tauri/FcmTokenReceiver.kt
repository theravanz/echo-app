package com.theravanz.echo_tauri

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Получает FCM токен от EchoFirebaseService и передаёт его
 * в WebView через JavaScript bridge для отправки в Rust-бэкенд.
 */
class FcmTokenReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "FcmTokenReceiver"
        private const val ACTION_FCM_TOKEN = "com.theravanz.echo_tauri.FCM_TOKEN"
        const val EXTRA_TOKEN = "token"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (ACTION_FCM_TOKEN == intent.action) {
            val token = intent.getStringExtra(EXTRA_TOKEN)
            if (token != null) {
                Log.d(TAG, "Received FCM token: ${token.take(20)}...")
                // Сохраняем токен для последующей отправки в WebView
                FcmTokenHolder.token = token
            }
        }
    }
}

/**
 * Хранилище FCM токена для доступа из WebView.
 */
object FcmTokenHolder {
    var token: String? = null
}
