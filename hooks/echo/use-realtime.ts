"use client";

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useE2EE } from "./use-e2ee";
import { parseCallLogJson } from "./call-log";
import { parseVoiceMeta } from "@/lib/voice";
import type { UserProfile, Chat, Message } from "./types";

interface UseRealtimeProps {
  user: UserProfile | null;
  chats: Chat[];
  selectedChatRef: React.MutableRefObject<Chat | null>;
  onNewMessage: (msg: Message) => void;
  onUpdateMessage: (msg: Message) => void;
  onFetchChats: () => void;
  onNotifyMessage: (senderId: string, content: string, currentChatId?: string) => void;
}

interface UseRealtimeReturn {
  isSubscribed: boolean;
}

export function useRealtime({
  user,
  chats,
  selectedChatRef,
  onNewMessage,
  onUpdateMessage,
  onFetchChats,
  onNotifyMessage,
}: UseRealtimeProps): UseRealtimeReturn {
  const isMountedRef = useRef(true);
  const { decryptMessage } = useE2EE(chats);
  const decryptRef = useRef(decryptMessage);
  decryptRef.current = decryptMessage;
  // Актуальный список чатов внутри колбэков подписки (замыкания effect'а
  // иначе видят старые chats; нужен для распознавания групповых receiver).
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  // id уже показанных сообщений: защита от дублей при эхе своих INSERT.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const markSeen = useCallback((id: string) => {
    seenIdsRef.current.add(id);
    if (seenIdsRef.current.size > 500) {
      const arr = Array.from(seenIdsRef.current).slice(-400);
      seenIdsRef.current = new Set(arr);
    }
  }, []);

  const lastKnownMessageIdRef = useRef<string | null>(null);
  const fetchChatsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const forceReconnectRef = useRef<(() => void) | null>(null);

  const debouncedFetchChats = useCallback(() => {
    if (fetchChatsTimeoutRef.current) {
      clearTimeout(fetchChatsTimeoutRef.current);
    }
    fetchChatsTimeoutRef.current = setTimeout(() => {
      onFetchChats();
    }, 1000);
  }, [onFetchChats]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!user?.id) return;

    let msgChannel: any = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_DELAY = 30000;

    // --- ОБНОВЛЕНИЕ LAST_SEEN ---
    const updateLastSeen = async () => {
      if (!user?.id) return;
      try {
        await supabase
          .from("profiles")
          .update({ last_seen: new Date().toISOString() })
          .eq("id", user.id);
        console.log("[Realtime] Last seen updated on disconnect/hidden");
      } catch (err) {
        console.error("[Realtime] Failed to update last_seen:", err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        updateLastSeen();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    // ----------------------------

    const subscribeMsgChannel = () => {
      if (!isMountedRef.current) return;

      if (msgChannel) {
        supabase.removeChannel(msgChannel);
      }

      msgChannel = supabase.channel("global-msgs");

      msgChannel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload: any) => {
          if (!isMountedRef.current) return;
          const nm = payload.new as any;
          if (nm.sender_id === user.id) return;

          // ГРУППА: receiver_id = groupId, отправитель — любой участник.
          // useE2EE ищет группу по 4-му аргументу (groupId → msg_key_0).
          const groupChat = chatsRef.current.find(
            (c) => c.type === 'group' && c.id === nm.receiver_id,
          );
          const isGroupMsg = !!groupChat;

          if (isGroupMsg || nm.receiver_id === user.id) {
            debouncedFetchChats();

            // Голосовые: content — plaintext JSON-метаданные (аудио зашифровано
            // отдельно в bucket `voice`). Дешифратор текста не вызываем.
            // Групповые голосовые/файлы шифруются msg_key_0 — см. lib/group-media.
            if (nm.type === "voice") {
              if (isGroupMsg) {
                const openId = selectedChatRef.current?.id;
                if (openId && openId === nm.receiver_id) {
                  markSeen(nm.id);
                  onNewMessage({
                    ...nm,
                    voice: parseVoiceMeta(nm.content),
                  } as Message);
                }
              } else {
                onNewMessage({
                  ...nm,
                  voice: parseVoiceMeta(nm.content),
                } as Message);
              }
              return;
            }

            // Логи звонков не шифруются — байпас E2EE, парсим JSON.
            if (nm.type === "call_log") {
              const meta = parseCallLogJson(nm.content || "");
              const logMsg = {
                ...nm,
                call_status: meta.status,
                call_duration: meta.duration,
              };
              const visible = isGroupMsg
                ? selectedChatRef.current?.id === nm.receiver_id
                : selectedChatRef.current && nm.sender_id === selectedChatRef.current.id;
              if (visible) {
                markSeen(nm.id);
                onNewMessage(logMsg as Message);
              }
              // Для уведомления отдаём пустую строку — лог не показываем в шторке
              onNotifyMessage(nm.sender_id, "", selectedChatRef.current?.id);
              return;
            }

            let decryptedContent = nm.content;
            try {
              decryptedContent = await decryptRef.current(
                nm.content,
                nm.nonce || "",
                nm.sender_id,
                isGroupMsg ? nm.receiver_id : undefined,
              );
            } catch (err) {
              console.error("[Realtime] E2EE Decryption failed for msg:", nm.id, err);
              decryptedContent = "🔒 Ошибка расшифровки";
            }

            const visible = isGroupMsg
              ? selectedChatRef.current?.id === nm.receiver_id
              : selectedChatRef.current && nm.sender_id === selectedChatRef.current.id;
            if (visible) {
              markSeen(nm.id);
              onNewMessage({ ...nm, content: decryptedContent } as Message);
            }

            onNotifyMessage(nm.sender_id, decryptedContent, selectedChatRef.current?.id);
          }
        },
      );

      msgChannel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        async (payload: any) => {
          if (!isMountedRef.current) return;
          const nm = payload.new as any;
          const updGroup = chatsRef.current.find(
            (c) => c.type === 'group' && c.id === nm.receiver_id,
          );
          const isUpdGroup = !!updGroup;
          if (nm.receiver_id === user.id || nm.sender_id === user.id || isUpdGroup) {
            debouncedFetchChats();
            if (
              selectedChatRef.current &&
              (nm.sender_id === selectedChatRef.current.id ||
                nm.receiver_id === selectedChatRef.current.id)
            ) {
              if (nm.type === "call_log") {
                const meta = parseCallLogJson(nm.content || "");
                onUpdateMessage({
                  ...nm,
                  call_status: meta.status,
                  call_duration: meta.duration,
                } as Message);
              } else {
                try {
                  const otherId = nm.sender_id === user.id ? nm.receiver_id : nm.sender_id;
                  const dec = await decryptRef.current(
                    nm.content, nm.nonce || "", otherId,
                    isUpdGroup ? nm.receiver_id : undefined,
                  );
                  onUpdateMessage({ ...nm, content: dec } as Message);
                } catch (err) {
                  console.error("[Realtime] E2EE Update decryption failed:", err);
                }
              }
            }
          }
        },
      );

      msgChannel.subscribe((status: string, err?: Error) => {
        if (!isMountedRef.current) return;
        if (status === "SUBSCRIBED") {
          reconnectAttempts = 0;
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
          reconnectAttempts++;
          setTimeout(subscribeMsgChannel, delay);
        }
      });
    };

    subscribeMsgChannel();

    const startPolling = () => {
      pollInterval = setInterval(async () => {
        if (!isMountedRef.current || !user?.id) return;

        try {
          const { data } = await supabase
            .from("messages")
            .select("id, created_at")
            .or(`receiver_id.eq.${user.id},sender_id.eq.${user.id}`)
            .order("created_at", { ascending: false })
            .limit(1);
          if (data && data.length > 0) {
            const latestMessageId = data[0].id;

            if (latestMessageId !== lastKnownMessageIdRef.current) {
              if (lastKnownMessageIdRef.current === null) {
                lastKnownMessageIdRef.current = latestMessageId;
                return;
              }
              lastKnownMessageIdRef.current = latestMessageId;
              console.log("[Realtime] New message detected via polling, refetching chats");
              debouncedFetchChats();
            }
          }
        } catch { /* silent */ }
      }, 5000);
    };

    startPolling();

    forceReconnectRef.current = () => {
      if (!isMountedRef.current || !user?.id) return;
      console.log("[Realtime] Force reconnect triggered");
      if (msgChannel) {
        supabase.removeChannel(msgChannel);
        msgChannel = null;
      }
      reconnectAttempts = 0;
      subscribeMsgChannel();
      (async () => {
        try {
          const { data } = await supabase
            .from("messages")
            .select("id, created_at")
            .or(`receiver_id.eq.${user.id},sender_id.eq.${user.id}`)
            .order("created_at", { ascending: false })
            .limit(1);
          if (data && data.length > 0) {
            const latestMessageId = data[0].id;
            if (latestMessageId !== lastKnownMessageIdRef.current) {
              lastKnownMessageIdRef.current = latestMessageId;
              debouncedFetchChats();
            }
          }
        } catch { /* ignore */ }
      })();
    };

    let bgUnlisten: (() => void) | undefined;
    if (isTauri) {
      import("@tauri-apps/api/event")
        .then(({ listen }) => {
          return listen<{ messages: any[] }>("background-messages", (event) => {
            if (!isMountedRef.current) return;
            const { messages } = event.payload;
            if (messages && messages.length > 0) {
              console.log(`[Realtime] ${messages.length} messages from background polling`);
              debouncedFetchChats();
            }
          });
        })
        .then((fn) => {
          bgUnlisten = fn;
        })
        .catch(() => {});
    }

    // --- ЕДИНЫЙ RETURN ДЛЯ ОЧИСТКИ ---
    return () => {
      isMountedRef.current = false;
      forceReconnectRef.current = null;

      // Записываем время выхода
      updateLastSeen();

      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (msgChannel) supabase.removeChannel(msgChannel);
      if (pollInterval) clearInterval(pollInterval);
      if (fetchChatsTimeoutRef.current) clearTimeout(fetchChatsTimeoutRef.current);
      bgUnlisten?.();
    };
  }, [user?.id]);

  // Force reconnect when app becomes visible or network comes back online
  useEffect(() => {
    let lastForceReconnect = 0;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastForceReconnect > 3000) {
          lastForceReconnect = now;
          forceReconnectRef.current?.();
        }
      }
    };
    const handleOnline = () => {
      const now = Date.now();
      if (now - lastForceReconnect > 3000) {
        lastForceReconnect = now;
        forceReconnectRef.current?.();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
    };
  }, [user?.id]);

  return { isSubscribed: true };
}