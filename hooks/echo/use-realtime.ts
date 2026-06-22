"use client";

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useE2EE } from "./use-e2ee";
import type { UserProfile, Chat, Message } from "./types";

interface UseRealtimeProps {
  user: UserProfile | null;
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
  selectedChatRef,
  onNewMessage,
  onUpdateMessage,
  onFetchChats,
  onNotifyMessage,
}: UseRealtimeProps): UseRealtimeReturn {
  const isMountedRef = useRef(true);
  const { decryptMessage } = useE2EE([]);
  const decryptRef = useRef(decryptMessage);
  decryptRef.current = decryptMessage;

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
            onFetchChats();

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
            onFetchChats();
            if (
              selectedChatRef.current &&
              (nm.sender_id === selectedChatRef.current.id ||
                nm.receiver_id === selectedChatRef.current.id)
            ) {
              try {
                const otherId = nm.sender_id === user.id ? nm.receiver_id : nm.sender_id;
                const dec = await decryptRef.current(nm.content, nm.nonce, otherId);
                onUpdateMessage({ ...nm, content: dec } as Message);
              } catch { /* ignore */ }
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

    // Polling fallback
    const startPolling = () => {
      pollInterval = setInterval(async () => {
        if (!isMountedRef.current || !user?.id) return;

        const socketState = (supabase as any).realtime?.connectionState?.();
        if (socketState === "connected") return;

        try {
          const { data } = await supabase
            .from("messages")
            .select("*")
            .or(`receiver_id.eq.${user.id},sender_id.eq.${user.id}`)
            .order("created_at", { ascending: false })
            .limit(50);

          if (data && data.length > 0) {
            onFetchChats();
          }
        } catch { /* silent */ }
      }, 5000);
    };

    startPolling();

    return () => {
      isMountedRef.current = false;
      if (msgChannel) supabase.removeChannel(msgChannel);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [user?.id]);

  return { isSubscribed: true };
}
