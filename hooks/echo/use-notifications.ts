"use client";

import { useEffect, useRef, useCallback } from 'react';

/**
 * Хук для отправки нативных уведомлений о новых сообщениях
 * 
 * Платформы:
 * - Tauri Desktop (Linux, Windows, macOS) → tauri-plugin-notification
 * - Tauri Mobile (Android, iOS) → tauri-plugin-notification
 * - Browser / Web → Web Notification API как fallback
 */

type SendNotificationFn = (title: string, body: string, iconUrl?: string) => void;

// === Проверка: запущены ли мы в Tauri ===
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// === Ленивый импорт Tauri-плагина ===
let tauriNotify: ((title: string, body: string, iconUrl?: string) => Promise<void>) | null = null;

const getTauriNotifier = async () => {
  if (tauriNotify) return tauriNotify;

  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');

    let permitted = await isPermissionGranted();
    if (!permitted) {
      const permission = await requestPermission();
      permitted = permission === 'granted';
    }

    if (permitted) {
      tauriNotify = async (title: string, body: string, _iconUrl?: string) => {
        sendNotification({ title, body });
      };
    }
  } catch (e) {
    console.warn('[Notifications] Tauri plugin failed to load:', e);
  }

  return tauriNotify;
};

// === Web Notification API fallback ===
let webPermitted: boolean | null = null;

const getWebNotifier = async (): Promise<SendNotificationFn | null> => {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;

  if (webPermitted === null) {
    if (Notification.permission === 'granted') {
      webPermitted = true;
    } else if (Notification.permission === 'denied') {
      webPermitted = false;
    } else {
      const result = await Notification.requestPermission();
      webPermitted = result === 'granted';
    }
  }

  if (!webPermitted) return null;

  return (title: string, body: string, iconUrl?: string) => {
    try {
      new Notification(title, {
        body,
        icon: iconUrl || '/icon.png',
        tag: 'echo-message',
        silent: false,
      });
    } catch (e) {
      console.warn('[Notifications] Web notification failed:', e);
    }
  };
};

// === Единый интерфейс ===
let notifier: SendNotificationFn | null = null;
let initPromise: Promise<void> | null = null;

const ensureNotifier = async (): Promise<SendNotificationFn | null> => {
  if (notifier) return notifier;
  if (initPromise) await initPromise;

  initPromise = (async () => {
    if (isTauri) {
      const fn = await getTauriNotifier();
      if (fn) notifier = fn;
    } else {
      const fn = await getWebNotifier();
      if (fn) notifier = fn;
    }
  })();

  await initPromise;
  return notifier;
};

export const useNotifications = (user: any, chats: any[]) => {
  const isFocusedRef = useRef(true);
  const chatsMapRef = useRef<Record<string, any>>({});

  // Сохраняем мапу чатов для быстрого поиска имени отправителя
  useEffect(() => {
    const map: Record<string, any> = {};
    for (const chat of chats) {
      map[chat.id] = chat;
    }
    chatsMapRef.current = map;
  }, [chats]);

  // Следим за фокусом окна
  useEffect(() => {
    const handleFocus = () => { isFocusedRef.current = true; };
    const handleBlur = () => { isFocusedRef.current = false; };
    const handleVisibility = () => {
      isFocusedRef.current = document.visibilityState === 'visible' && document.hasFocus();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Инициализируем notifier при монтировании
  useEffect(() => {
    ensureNotifier();
  }, []);

  const notifyNewMessage = useCallback(async (
    senderId: string,
    messageContent: string,
    currentChatId?: string | null,
  ) => {
    // Не показываем уведомление если:
    // 1. Окно в фокусе И открыт чат с этим отправителем
    if (isFocusedRef.current && currentChatId === senderId) return;

    // 2. Нет пользователя (не залогинен)
    if (!user) return;

    // 3. Сообщение от самого себя
    if (senderId === user.id) return;

    // Ищем имя отправителя
    const senderChat = chatsMapRef.current[senderId];
    const senderName = senderChat?.display_name || senderChat?.username || senderId.slice(0, 8);

    // Обрезаем длинные сообщения
    const preview = messageContent.length > 120
      ? messageContent.slice(0, 120) + '…'
      : messageContent;

    const fn = await ensureNotifier();
    if (fn) {
      fn(senderName, preview, senderChat?.avatar_url);
    }
  }, [user]);

  return { notifyNewMessage };
};
