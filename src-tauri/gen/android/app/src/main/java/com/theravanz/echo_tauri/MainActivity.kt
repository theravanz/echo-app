package com.theravanz.echo_tauri

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import org.json.JSONObject

class MainActivity : TauriActivity() {
    private var webView: WebView? = null
    private var pendingCallPayload: Map<String, String>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        createNotificationChannel()
    }

    /**
     * JS-мост для фронтенда: window.EchoNative.getFcmToken().
     * Возвращает FCM-токен, который заполняет EchoFirebaseService.onNewToken()
     * в FcmTokenHolder. Фронтенд передаёт его в Rust-бэкенд и Supabase
     * (device_tokens) через useFcm.registerFcmToken().
     */
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        this.webView = webView
        webView.addJavascriptInterface(EchoBridge(), "EchoNative")

        // Если входящий звонок пришёл до готовности WebView (cold start) —
        // отложенный payload срабатывает сразу после загрузки webview.
        pendingCallPayload?.let {
            pendingCallPayload = null
            dispatchIncomingCall(it)
        }
    }

    private class EchoBridge {
        @JavascriptInterface
        fun getFcmToken(): String? = FcmTokenHolder.token
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleCallIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        AppForeground.isForeground = true
        // Cold start: intent может нести данные входящего звонка.
        handleCallIntent(intent)
    }

    override fun onStop() {
        super.onStop()
        AppForeground.isForeground = false
    }

    private fun handleCallIntent(intent: Intent?) {
        if (intent?.getBooleanExtra("echo_incoming", false) != true) return

        val payload = buildMap {
            put("room_id", intent.getStringExtra("echo_room_id") ?: "")
            put("caller_id", intent.getStringExtra("echo_caller_id") ?: "")
            put("caller_name", intent.getStringExtra("echo_caller_name") ?: "")
            put("caller_avatar", intent.getStringExtra("echo_caller_avatar") ?: "")
        }

        if (webView == null) {
            pendingCallPayload = payload
        } else {
            dispatchIncomingCall(payload)
        }
    }

    /**
     * Инъекция JS в WebView: window.dispatchEvent(new CustomEvent(
     * 'echo-native-incoming-call', { detail: {...} })). CallOverlay слушает
     * это событие и показывает экран входящего звонка.
     */
    private fun dispatchIncomingCall(payload: Map<String, String>) {
        val wv = webView ?: return
        val json = JSONObject(payload).toString()
        val script =
            "(() => { try { " +
            "window.dispatchEvent(new CustomEvent('echo-native-incoming-call', { detail: $json })); " +
            "} catch(e) {} })();"
        wv.post {
            wv.evaluateJavascript(script, null)
        }
        Log.d("EchoNative", "Dispatched echo-native-incoming-call")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)

        val messages = NotificationChannel(
            "echo_messages",
            "Echo Messages",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Уведомления о новых сообщениях"
            enableVibration(true)
            setShowBadge(true)
        }
        manager.createNotificationChannel(messages)

        // Канал входящих звонков — high importance для fullScreenIntent
        val calls = NotificationChannel(
            "echo_calls",
            "Echo Calls",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Входящие звонки"
            enableVibration(true)
            setShowBadge(false)
        }
        manager.createNotificationChannel(calls)
    }
}
