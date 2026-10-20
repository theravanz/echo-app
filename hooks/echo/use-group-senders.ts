"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { Message, GroupSenderProfile } from "./types";

/**
 * Профили отправителей группового чата (ник + ава слева от пузыря).
 *
 * Зачем: messages хранят только sender_id; чтобы показать «кто написал»,
 * батчем подтягиваем profiles по DISTINCT sender_id текущего списка
 * сообщений. Кэш in-memory на время открытого чата (senderId → профиль),
 * дозапрос — только для неизвестных id. Себя не запрашиваем.
 *
 * Возвращает Map<senderId, GroupSenderProfile> + displayName(senderId).
 */
export function useGroupSenders(
  chatId: string | null,
  isGroup: boolean,
  messages: Message[],
  myId?: string | null,
): { senders: Map<string, GroupSenderProfile>; displayName: (senderId: string) => string } {
  const [senders, setSenders] = useState<Map<string, GroupSenderProfile>>(new Map());
  const cacheRef = useRef<Map<string, GroupSenderProfile>>(new Map());
  const chatIdRef = useRef<string | null>(null);

  // Смена чата — сбрасываем кэш.
  if (chatIdRef.current !== chatId) {
    chatIdRef.current = chatId;
    cacheRef.current = new Map();
    setSenders(new Map());
  }

  useEffect(() => {
    if (!chatId || !isGroup || messages.length === 0) return;
    const unknown = Array.from(
      new Set(messages.map((m) => m.sender_id).filter((id) => id && id !== myId && !cacheRef.current.has(id))),
    );
    if (unknown.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url, avatar_color, avatar_storage_path, avatar_nonce, avatar_mime")
          .in("id", unknown);
        if (cancelled || error) return;
        for (const p of data ?? []) {
          cacheRef.current.set(p.id, p as GroupSenderProfile);
        }
        // Неизвестных в profiles (удалены?) — помечаем заглушкой, чтобы не дёргать снова.
        for (const id of unknown) {
          if (!cacheRef.current.has(id)) {
            cacheRef.current.set(id, { id, display_name: "Удалённый", username: null });
          }
        }
        if (!cancelled) setSenders(new Map(cacheRef.current));
      } catch {
        /* offline — тихо, покажем инициалы по id */
      }
    })();
    return () => { cancelled = true; };
  }, [chatId, isGroup, messages, myId]);

  const displayName = (senderId: string): string => {
    const p = cacheRef.current.get(senderId) ?? senders.get(senderId);
    return p?.display_name || (p?.username ? `@${p.username}` : "Участник");
  };

  return { senders, displayName };
}
