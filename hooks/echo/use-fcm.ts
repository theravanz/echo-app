"use client";

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Хук для работы с Firebase Cloud Messaging (FCM).
 * Управляет регистрацией FCM токена на устройстве и
 * синхронизацией с Rust-бэкендом и Supabase.
 */
interface UseFcmReturn {
  fcmToken: string | null;
  registerFcmToken: (token: string) => Promise<void>;
  unregisterFcmToken: () => Promise<void>;
  isRegistered: boolean;
}

// Проверка Tauri окружения
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useFcm(userId: string | null): UseFcmReturn {
  const fcmTokenRef = useRef<string | null>(null);
  const isRegisteredRef = useRef(false);

  /**
   * Регистрация FCM токена на сервере (Supabase + Rust backend).
   */
  const registerFcmToken = useCallback(async (token: string) => {
    if (!userId || !token) return;

    try {
      fcmTokenRef.current = token;

      // 1. Отправляем токен в Rust-бэкенд (Tauri)
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_fcm_token", { token });
        console.log("[FCM] Token sent to Rust backend");
      }

      // 2. Сохраняем токен в Supabase
      const { error } = await supabase.from("device_tokens").upsert(
        {
          user_id: userId,
          token: token,
          platform: "android",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      if (error) throw error;
      isRegisteredRef.current = true;
      console.log("[FCM] Token registered successfully");
    } catch (err) {
      console.error("[FCM] Token registration failed:", err);
      // Сохраняем локально как fallback
      try {
        localStorage.setItem("echo_fcm_token", token);
      } catch { /* ignore */ }
    }
  }, [userId]);

  /**
   * Отмена регистрации FCM токена.
   */
  const unregisterFcmToken = useCallback(async () => {
    if (!userId) return;

    try {
      // Удаляем токен из Supabase
      await supabase
        .from("device_tokens")
        .delete()
        .eq("user_id", userId);

      fcmTokenRef.current = null;
      isRegisteredRef.current = false;

      // Очищаем локальное хранилище
      try {
        localStorage.removeItem("echo_fcm_token");
      } catch { /* ignore */ }

      console.log("[FCM] Token unregistered");
    } catch (err) {
      console.error("[FCM] Token unregistration failed:", err);
    }
  }, [userId]);

  /**
   * При монтировании проверяем существующий токен.
   */
  useEffect(() => {
    if (!userId) return;

    const restoreToken = async () => {
      // Проверяем в Supabase
      try {
        const { data } = await supabase
          .from("device_tokens")
          .select("token")
          .eq("user_id", userId)
          .single();

        if (data?.token) {
          fcmTokenRef.current = data.token;
          isRegisteredRef.current = true;

          // Синхронизируем с Rust-бэкендом
          if (isTauri) {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("set_fcm_token", { token: data.token });
          }
        }
      } catch {
        // Проверяем локальное хранилище
        try {
          const localToken = localStorage.getItem("echo_fcm_token");
          if (localToken) {
            fcmTokenRef.current = localToken;
          }
        } catch { /* ignore */ }
      }
    };

    restoreToken();
  }, [userId]);

  return {
    fcmToken: fcmTokenRef.current,
    registerFcmToken,
    unregisterFcmToken,
    isRegistered: isRegisteredRef.current,
  };
}
