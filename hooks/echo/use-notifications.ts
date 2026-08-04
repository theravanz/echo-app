"use client";

import { useEffect, useRef, useCallback } from "react";
import type { UserProfile, Chat } from "./types";
import type { NotificationSettings } from "./use-notification-settings";

// === Проверка: запущены ли мы в Tauri ===
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// === Ленивый Notifier (singleton) ===
type SendNotificationFn = (title: string, body: string, opts?: { icon?: string; chatId?: string; channelId?: string }) => void;

let notifier: SendNotificationFn | null = null;
let notifierInitPromise: Promise<void> | null = null;

/**
 * Инициализация Tauri notifier через Rust-бэкенд.
 * Использует команду show_local_notification для показа уведомлений через Rust.
 */
const initTauriNotifier = async (): Promise<SendNotificationFn | null> => {
  try {
    // Запрашиваем разрешение через Tauri plugin
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification",
    );

    let permitted = await isPermissionGranted();
    if (!permitted) {
      const permission = await requestPermission();
      permitted = permission === "granted";
    }

    if (permitted) {
      // Используем Rust-команду для показа уведомлений
      return async (title: string, body: string, opts?: { icon?: string; chatId?: string; channelId?: string }) => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("show_local_notification", {
            title,
            body,
            chatId: opts?.chatId || null,
          });
        } catch {
          // Fallback: прямой вызов Tauri plugin notification
          const { sendNotification } = await import("@tauri-apps/plugin-notification");
          sendNotification({
            title,
            body,
            icon: opts?.icon,
            channelId: opts?.channelId || "echo_messages",
            data: { chatId: opts?.chatId },
          } as any);
        }
      };
    }
  } catch (e) {
    console.warn("[Notifications] Tauri Rust notifier failed:", e);

    // Fallback: используем Tauri plugin напрямую
    try {
      const { isPermissionGranted, requestPermission, sendNotification } = await import(
        "@tauri-apps/plugin-notification",
      );

      let permitted = await isPermissionGranted();
      if (!permitted) {
        const permission = await requestPermission();
        permitted = permission === "granted";
      }

      if (permitted) {
        return (title: string, body: string, opts?: { icon?: string; chatId?: string; channelId?: string }) => {
          sendNotification({
            title,
            body,
            icon: opts?.icon,
            channelId: opts?.channelId || "echo_messages",
            data: { chatId: opts?.chatId },
          } as any);
        };
      }
    } catch (e2) {
      console.warn("[Notifications] Tauri plugin fallback also failed:", e2);
    }
  }
  return null;
};
// === Web Notifier (fallback for web version) ===

const initWebNotifier = async (): Promise<SendNotificationFn | null> => {
  if (typeof window === "undefined" || !("Notification" in window)) return null;

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : Notification.permission === "denied"
        ? "denied"
        : await Notification.requestPermission();

  if (permission !== "granted") return null;

  return (title: string, body: string, opts?: { icon?: string; chatId?: string }) => {
    try {
      const n = new Notification(title, {
        body,
        icon: opts?.icon || "/icon.png",
        tag: opts?.chatId ? `echo-${opts.chatId}` : "echo-message",
        silent: false,
        data: { chatId: opts?.chatId },
      });

      // Handle click on web notification
      n.onclick = () => {
        window.focus();
        if (opts?.chatId) {
          window.dispatchEvent(
            new CustomEvent("echo-notification-click", { detail: { chatId: opts.chatId } }),
          );
        }
        n.close();
      };
    } catch (e) {
      console.warn("[Notifications] Web notification failed:", e);
    }
  };
};

// === Lazy Notifier Singleton ===

const ensureNotifier = async (): Promise<SendNotificationFn | null> => {
  if (notifier) return notifier;
  if (notifierInitPromise) await notifierInitPromise;

  notifierInitPromise = (async () => {
    notifier = isTauri ? await initTauriNotifier() : await initWebNotifier();
  })();

  await notifierInitPromise;
  return notifier;
};

// === Хук ===

interface UseNotificationsProps {
  user: UserProfile | null;
  chats: Chat[];
  settings: NotificationSettings;
  onNotificationClick?: (chatId: string) => void;
}

interface UseNotificationsReturn {
  notifyNewMessage: (
    senderId: string,
    messageContent: string,
    currentChatId?: string | null,
  ) => Promise<void>;
}

export const useNotifications = ({
  user,
  chats,
  settings,
  onNotificationClick,
}: UseNotificationsProps): UseNotificationsReturn => {
  const isFocusedRef = useRef(true);
  const userNameMapRef = useRef<Record<string, string>>({});
  const userAvatarMapRef = useRef<Record<string, string | undefined>>({});

  // Build name/avatar lookup maps from chats list
  useEffect(() => {
    const nameMap: Record<string, string> = {};
    const avatarMap: Record<string, string | undefined> = {};
    for (const chat of chats) {
      nameMap[chat.id] = chat.display_name || chat.username || chat.id.slice(0, 8);
      avatarMap[chat.id] = chat.avatar_url;
    }
    userNameMapRef.current = nameMap;
    userAvatarMapRef.current = avatarMap;
  }, [chats]);

  // Track window focus/visibility
  useEffect(() => {
    const handleFocus = () => { isFocusedRef.current = true; };
    const handleBlur = () => { isFocusedRef.current = false; };
    const handleVisibility = () => {
      isFocusedRef.current = document.visibilityState === "visible" && document.hasFocus();
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Listen for notification clicks (Tauri + Web)
  useEffect(() => {
    if (!onNotificationClick) return;

    const handleClick = (e: CustomEvent) => {
      onNotificationClick(e.detail.chatId);
    };

    window.addEventListener("echo-notification-click", handleClick as EventListener);

    // Tauri-specific: listen for IPC events from Rust
    if (isTauri) {
      import("@tauri-apps/api/event")
        .then(({ listen }) => {
          listen<string>("notification-clicked", (event) => {
            onNotificationClick(event.payload);
          });
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener("echo-notification-click", handleClick as EventListener);
    };
  }, [onNotificationClick]);

  // Initialize notifier on mount
  useEffect(() => {
    ensureNotifier();

    // Start background polling in Rust backend (WebSocket-independent)
    if (isTauri && settings.backgroundPolling && user?.id) {
      const startBgPolling = async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("start_background_polling", { userId: user.id });
          console.log("[Notifications] Background polling started for user:", user.id);
        } catch (err) {
          console.warn("[Notifications] Failed to start background polling:", err);
        }
      };
      startBgPolling();
    }
  }, [settings.backgroundPolling, user?.id]);

  // Listen for background messages from Rust polling
  // Note: actual message processing (refetch) is handled in use-realtime.ts.
  // This listener is kept for logging and future notification logic.
  useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ messages: any[] }>("background-messages", (event) => {
          const { messages } = event.payload;
          if (messages && messages.length > 0) {
            console.log(`[Notifications] ${messages.length} messages from background polling`);
          }
        });
      } catch (err) {
        console.warn("[Notifications] Failed to listen for background messages:", err);
      }
    };

    setupListener();

    return () => {
      unlisten?.();
    };
  }, []);

  const notifyNewMessage = useCallback(
    async (senderId: string, messageContent: string, currentChatId?: string | null) => {
      // Global toggle
      if (!settings.enabled) return;

      // Don't notify if window is focused AND chat with sender is open
      if (isFocusedRef.current && currentChatId === senderId) return;

      // No user (not logged in)
      if (!user) return;

      // Message from self
      if (senderId === user.id) return;

      // Direct messages only filter
      if (settings.directMessagesOnly) {
        // All chats are currently DMs, so this is a placeholder for future group chat support
      }

      const senderName = userNameMapRef.current[senderId] || senderId.slice(0, 8);
      const avatarUrl = userAvatarMapRef.current[senderId];

      // Build notification body based on preview setting
      const body = settings.messagePreview
        ? (messageContent.length > 120
            ? messageContent.slice(0, 120) + "…"
            : messageContent)
        : "New message";

      const fn = await ensureNotifier();
      if (fn) {
        fn(senderName, body, { icon: avatarUrl, chatId: senderId });
      }
    },
    [user, settings],
  );

  return { notifyNewMessage };
};
