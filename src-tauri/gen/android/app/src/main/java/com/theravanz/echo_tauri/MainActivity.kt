package com.theravanz.echo_tauri

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

class MainActivity : TauriActivity() {
    private var webView: WebView? = null
    private var pendingCallPayload: Map<String, String>? = null

    companion object {
        private const val TAG = "EchoNative"
        private const val PREFS_FCM = "echo_fcm"
        private const val KEY_FCM_TOKEN = "fcm_token"
    }

    private fun fcmPrefs(): SharedPreferences =
        getSharedPreferences(PREFS_FCM, Context.MODE_PRIVATE)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        createNotificationChannel()

        // Восстанавливаем ранее сохранённый FCM-токен (переживает перезапуски,
        // когда onNewToken повторно не вызывается Firebase).
        val saved = fcmPrefs().getString(KEY_FCM_TOKEN, null)
        if (!saved.isNullOrEmpty()) {
            FcmTokenHolder.token = saved
        }
        // Явно запрашиваем актуальный токен из Firebase — покрывает первый
        // запуск и ротацию токена, не полагаясь только на onNewToken.
        refreshFcmTokenFromFirebase()
    }

    /**
     * Запрашивает текущий FCM-токен устройства из Firebase SDK и сохраняет его
     * в память + SharedPreferences, чтобы JS-мост (window.EchoNative.getFcmToken())
     * всегда мог его отдать, даже если onNewToken() уже не сработает повторно.
     */
    private fun refreshFcmTokenFromFirebase() {
        try {
            FirebaseMessaging.getInstance().getToken()
                .addOnSuccessListener { token ->
                    if (!token.isNullOrEmpty()) {
                        FcmTokenHolder.token = token
                        fcmPrefs().edit().putString(KEY_FCM_TOKEN, token).apply()
                        Log.d(TAG, "FCM token refreshed: ${token.take(16)}...")
                    }
                }
                .addOnFailureListener { e ->
                    Log.w(TAG, "FCM getToken failed", e)
                }
        } catch (e: Exception) {
            Log.w(TAG, "FCM getToken threw", e)
        }
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

    private inner class EchoBridge {
        @JavascriptInterface
        fun getFcmToken(): String? {
            // Быстрый путь — токен уже в памяти (onNewToken / onCreate).
            val mem = FcmTokenHolder.token
            if (!mem.isNullOrEmpty()) return mem

            // Fallback: токен, сохранённый в SharedPreferences при прошлом запуске.
            // Нужен, если onCreate успел восстановить токен, а фоновый запрос
            // Firebase ещё не вернул свежий.
            val saved = fcmPrefs().getString(KEY_FCM_TOKEN, null)
            if (!saved.isNullOrEmpty()) {
                FcmTokenHolder.token = saved
            }
            return saved
        }
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

    /**
     * Системное открытие файла из приватного кэша (ACTION_VIEW + FileProvider).
     * Вызывается из Rust (file_open.rs) через JNI: весь intent-код живёт здесь,
     * потому что JNI-резолюция методов androidx-классов из Rust ненадёжна
     * (NoSuchMethodError из-за кастомного app-classloader wry).
     * Коды возврата (маппятся в Rust на контракт ошибок):
     *   0 — ок; 1 — файла нет; 2 — нет приложения для mime; 3 — прочий сбой
     *   (detail в Log.e("EchoNative") — реальная причина).
     */
    fun echoOpenFileExternally(path: String, mime: String): Int {
        val file = java.io.File(path)
        if (!file.exists()) return 1
        return try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                file
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_ACTIVITY_NEW_TASK
                )
            }
            if (intent.resolveActivity(packageManager) == null) return 2
            startActivity(Intent.createChooser(intent, null))
            0
        } catch (e: android.content.ActivityNotFoundException) {
            2
        } catch (e: Exception) {
            Log.e("EchoNative", "echoOpenFileExternally failed", e)
            3
        }
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
