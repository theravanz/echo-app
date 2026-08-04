"use client";

/**
 * Получение FCM-токена устройства.
 *
 * Пути получения токена (по приоритету):
 *  1. Нативный Android-мост `window.EchoNative.getFcmToken()` — читает
 *     `FcmTokenHolder.token`, который заполняет EchoFirebaseService.onNewToken().
 *     Это основной путь для Tauri-сборки на Android (реальный push).
 *  2. Firebase JS SDK `getMessaging().getToken()` — фолбэк, когда настроен
 *     Firebase web-конфиг (веб / десктоп с сервис-воркером).
 *
 * На десктопе (Linux/macOS/Windows) FCM-токена нет — функция быстро вернёт null.
 */
export async function getFcmToken(timeoutMs = 15000): Promise<string | null> {
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const start = Date.now();

  // ── 1. Нативный Android-мост (Tauri). Основной путь для прода. ──
  if (isTauri) {
    try {
      const native = (window as any).EchoNative;
      if (native && typeof native.getFcmToken === "function") {
        // Токен появляется асинхронно (onNewToken) — поллим до timeoutMs.
        while (Date.now() - start < timeoutMs) {
          try {
            const t = native.getFcmToken();
            if (t) return t;
          } catch {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch {
      /* ignore */
    }
  }

  // ── 2. Firebase JS SDK (web / dev фолбэк). ──
  // ВНИМАНИЕ: FCM (messaging) НЕ использует Firebase Storage — bucket не нужен.
  // Здесь только firebase/app + firebase/messaging.
  try {
    const { initializeApp, getApps } = await import("firebase/app");
    const { getMessaging, getToken } = await import("firebase/messaging");

    const config = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
      messagingSenderId:
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
    };

    // Firebase messaging не сконфигурирован — нечего пробовать.
    if (!config.apiKey || !config.messagingSenderId || !config.appId) {
      return null;
    }

    const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
    const token = await getToken(getMessaging(app), {
      vapidKey: config.messagingSenderId,
    });
    return token || null;
  } catch {
    return null;
  }
}
