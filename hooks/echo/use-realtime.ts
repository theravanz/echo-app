"use client";

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useE2EE } from "./use-e2ee";
import { parseCallLogJson } from "./call-log";
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

          if (nm.receiver_id === user.id) {
            debouncedFetchChats();

            // Логи звонков не шифруются — байпас E2EE, парсим JSON.
            if (nm.type === "call_log") {
              const meta = parseCallLogJson(nm.content || "");
              const logMsg = {
                ...nm,
                call_status: meta.status,
                call_duration: meta.duration,
              };
              if (
                selectedChatRef.current &&
                nm.sender_id === selectedChatRef.current.id
              ) {
                onNewMessage(logMsg as Message);
              }
              // Для уведомления отдаём пустую строку — лог не показываем в шторке
              onNotifyMessage(nm.sender_id, "", selectedChatRef.current?.id);
              return;
            }

            let decryptedContent = nm.content;
            try {
              decryptedContent = await decryptRef.current(nm.content, nm.nonce, nm.sender_id);
            } catch { /* ignore */ }

            if (selectedChatRef.current && nm.sender_id === selectedChatRef.current.id) {
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
          if (nm.receiver_id === user.id || nm.sender_id === user.id) {
            debouncedFetchChats();
            if (
              selectedChatRef.current &&
              (nm.sender_id === selectedChatRef.current.id ||
                nm.receiver_id === selectedChatRef.current.id)
            ) {
              // Логи звонков не шифруются — байпас E2EE, парсим JSON.
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
                  const dec = await decryptRef.current(nm.content, nm.nonce, otherId);
                  onUpdateMessage({ ...nm, content: dec } as Message);
                } catch { /* ignore */ }
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

        // Always poll — even when "connected", as a zombie-connection
        // safety net. If the WebSocket appears connected but isn't
        // actually delivering events, this polling catches new messages.
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
              // First poll: initialize baseline without triggering refetch
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

    // Allow visibility/online handlers to force reconnect
    forceReconnectRef.current = () => {
      if (!isMountedRef.current || !user?.id) return;
      console.log("[Realtime] Force reconnect triggered");
      if (msgChannel) {
        supabase.removeChannel(msgChannel);
        msgChannel = null;
      }
      reconnectAttempts = 0;
      subscribeMsgChannel();
      // Immediately poll for missed messages
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

    // Tauri: listen for background messages from Rust polling
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

    return () => {
      isMountedRef.current = false;
      forceReconnectRef.current = null;
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