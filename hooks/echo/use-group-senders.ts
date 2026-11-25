"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { fetchProfiles, getCachedProfile } from "./profile-cache";
import type { Message, GroupSenderProfile } from "./types";

function toSender(p: {
  id: string;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_color?: string | null;
  avatar_storage_path?: string | null;
  avatar_nonce?: string | null;
  avatar_mime?: string | null;
}): GroupSenderProfile {
  return {
    id: p.id,
    username: p.username ?? null,
    display_name: p.display_name ?? null,
    avatar_url: p.avatar_url ?? null,
    avatar_color: p.avatar_color ?? null,
    avatar_storage_path: p.avatar_storage_path ?? null,
    avatar_nonce: p.avatar_nonce ?? null,
    avatar_mime: p.avatar_mime ?? null,
  };
}

/**
 * Профили отправителей группового чата (ник + ава слева от пузыря).
 *
 * Зачем: messages хранят только sender_id; чтобы показать «кто написал»,
 * берём профили из ОБЩЕГО кэша (hooks/echo/profile-cache.ts): память →
 * SQLCipher → один батч-запрос только за неизвестными id.
 *
 * Эффект зависит от СТАБИЛЬНОГО ключа (отсортированный список sender_id),
 * а не от ссылки `messages` — иначе каждый апдейт массива сообщений
 * перезапускал эффект и плодил запросы.
 */
export function useGroupSenders(
  chatId: string | null,
  isGroup: boolean,
  messages: Message[],
  myId?: string | null,
): { senders: Map<string, GroupSenderProfile>; displayName: (senderId: string) => string } {
  const [senders, setSenders] = useState<Map<string, GroupSenderProfile>>(new Map());

  const senderIds = useMemo(
    () =>
      Array.from(
        new Set(
          messages
            .map((m) => m.sender_id)
            .filter((id): id is string => Boolean(id) && id !== myId),
        ),
      ).sort(),
    [messages, myId],
  );
  const senderIdsKey = senderIds.join(",");
  const senderIdsRef = useRef(senderIds);
  senderIdsRef.current = senderIds;
  const chatIdRef = useRef<string | null>(null);

  // Смена чата — сразу показываем только отправителей текущего чата
  // (кэш при этом общий и никуда не пропадает).
  if (chatIdRef.current !== chatId) {
    chatIdRef.current = chatId;
    setSenders(new Map());
  }

  useEffect(() => {
    if (!isGroup) {
      setSenders(new Map());
      return;
    }
    const ids = senderIdsRef.current;
    if (ids.length === 0) {
      setSenders(new Map());
      return;
    }

    let cancelled = false;

    // 1. Мгновенно — из памяти (без сети, без мигания инициалами).
    const immediate = new Map<string, GroupSenderProfile>();
    for (const id of ids) {
      const p = getCachedProfile(id);
      if (p) immediate.set(id, toSender(p));
    }
    if (immediate.size > 0) setSenders(immediate);

    // 2. Догружаем только неизвестных/устаревших — одним батчем.
    void fetchProfiles(ids).then((map) => {
      if (cancelled) return;
      const next = new Map<string, GroupSenderProfile>();
      for (const id of ids) {
        const p = map.get(id) ?? getCachedProfile(id);
        next.set(id, p ? toSender(p) : { id, display_name: "Удалённый", username: null });
      }
      setSenders(next);
    });

    return () => {
      cancelled = true;
    };
  }, [chatId, isGroup, senderIdsKey]);

  const displayName = (senderId: string): string => {
    const p = senders.get(senderId) ?? getCachedProfile(senderId);
    if (!p) return "Участник";
    return p.display_name || (p.username ? `@${p.username}` : "Участник");
  };

  return { senders, displayName };
}
