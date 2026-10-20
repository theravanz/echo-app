"use client";

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useE2EE } from "./use-e2ee";
import { cacheGetBounded, cacheSetBounded } from "./chat-cache";
import { generateTempId } from "./use-network-queue";
import { parseCallLogJson } from "./call-log";
import {
  buildVoiceMeta,
  encryptVoicePayload,
  parseVoiceMeta,
  type VoiceMeta,
  type VoicePayload,
} from "@/lib/voice";
import { MEDIA_VERSION_RAW } from "@/lib/crypto";
import { putOutboxBlob } from "@/lib/outbox-media";
import type { Message, PendingMessage, Chat, UserProfile, ConnectionStatus } from "./types";
import { parseFileMeta } from "@/lib/files";

/** Сетевой запрос истории чата не должен висеть: жёсткий abort-таймаут. */
const MESSAGES_NET_TIMEOUT_MS = 8000;

// ─── Порядок сообщений ───
// Оптимистичная вставка/мердж очереди не должна ломать хронологию:
// после рестарта недосланные сообщения встают на своё место по created_at,
// а не в конец списка.
const msgTs = (m: { created_at?: string }): number => {
  const v = Date.parse(m?.created_at ?? "");
  return Number.isFinite(v) ? v : 0;
};

export function insertByCreatedAt(prev: Message[], msg: Message): Message[] {
  const next = prev.slice();
  next.push(msg);
  next.sort((a, b) => msgTs(a) - msgTs(b)); // sort стабилен (ES2019)
  return next;
}

function sortByCreatedAt(list: Message[]): Message[] {
  return [...list].sort((a, b) => msgTs(a) - msgTs(b));
}

interface UseMessagesReturn {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  replyingTo: Message | null;
  setReplyingTo: React.Dispatch<React.SetStateAction<Message | null>>;
  editingMessage: Message | null;
  setEditingMessage: React.Dispatch<React.SetStateAction<Message | null>>;
  newMessage: string;
  setNewMessage: React.Dispatch<React.SetStateAction<string>>;
  fetchMessages: (chatId: string, currentUserId: string) => Promise<void>;
  handleSendMessage: (
    selectedChat: Chat,
    user: UserProfile,
    text: string,
    type?: "text" | "sticker" | "gif",
    customContent?: string,
    onAddToQueue?: (msg: PendingMessage) => void,
  ) => Promise<void>;
  handleSendVoice: (
    selectedChat: Chat,
    user: UserProfile,
    blob: Blob,
    durationSec: number,
    onAddToQueue?: (msg: PendingMessage) => void,
  ) => Promise<void>;
  handleEditMessage: (
    selectedChat: Chat,
    text: string,
  ) => Promise<void>;
  messagesCacheKey: string;
}

export function useMessages(
  chats: Chat[] = [],
  connectionStatus: ConnectionStatus = "connected",
  pendingQueue: PendingMessage[] = [],
): UseMessagesReturn {
  const { encryptMessage, decryptMessage } = useE2EE(chats); // ← Передаем chats!
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  // Офлайн-детект по статусу: открытие чата без сети не ждёт таймауты.
  const connectionStatusRef = useRef<ConnectionStatus>(connectionStatus);
  connectionStatusRef.current = connectionStatus;
  // Очередь недосланных — источник для мерджа после рестарта приложения.
  const pendingQueueRef = useRef<PendingMessage[]>(pendingQueue);
  pendingQueueRef.current = pendingQueue;

  /**
   * Домешать к списку сообщения из офлайн-очереди этого чата: после рестарта
   * пузырь с часиками восстанавливается из SQLCipher, а не только из БД
   * (в БД его ещё нет). Дедуп по temp-id + сортировка по created_at.
   */
  const withPendingForChat = useCallback(
    (list: Message[], chatId: string, myId: string): Message[] => {
      const pending = pendingQueueRef.current.filter(
        (p) => p.receiver_id === chatId && p.sender_id === myId,
      );
      if (pending.length === 0) return list;
      const known = new Set(list.map((m) => String(m.id)));
      const merged = list.slice();
      for (const p of pending) {
        if (known.has(String(p.id))) continue;
        known.add(String(p.id));
        // Текст в очереди лежит шифротекстом → для рендера берём plaintext-копию.
        const isText = !p.type || p.type === "text" || p.type === "sticker" || p.type === "gif";
        merged.push(isText ? { ...p, content: p._pendingContent || p.content } : { ...p });
      }
      return sortByCreatedAt(merged);
    },
    [],
  );

  const fetchMessages = useCallback(async (chatId: string, currentUserId: string) => {
    const cacheKey = `echo_msgs_cache_${currentUserId}_${chatId}`;

    // 1. Load from cache immediately (SQLCipher через Rust-слой, см. chat-cache.ts;
    //    plaintext сообщений в localStorage запрещён — миграция legacy-ключей
    //    прозрачна внутри cacheGet: перенос в secure_store + удаление следа)
    try {
      const cached = await cacheGetBounded(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.messages && Array.isArray(parsed.messages)) {
          setMessages(withPendingForChat(parsed.messages, chatId, currentUserId));
        }
      }
    } catch (e) {
      console.warn("[CHAT-CACHE] failed to read messages cache:", e);
    }

    // 2. Офлайн-детект ДО сети: нет связи — сообщения уже отрендерены
    //    из кэша выше, сеть не трогаем (иначе ждали бы таймауты).
    //    Недосланные из очереди домиксовываем здесь же: они обязаны быть
    //    видны с часиками сразу после рестарта приложения.
    const offlineNow =
      (typeof navigator !== "undefined" && !navigator.onLine) ||
      connectionStatusRef.current === "disconnected";
    if (offlineNow) {
      setMessages((prev) => withPendingForChat(prev, chatId, currentUserId));
      console.warn("[CHAT-CACHE] offline (status), using cached messages — network skipped");
      return;
    }

    // 3. Fetch fresh from server — с жёстким abort-таймаутом
    const netAbort = new AbortController();
    const netTimeout = setTimeout(() => netAbort.abort(), MESSAGES_NET_TIMEOUT_MS);
    try {
      // ГРУППА: выбираем ВСЕ сообщения с receiver_id = groupId — всех
      // отправителей, не только свои (DM-фильтр 1-на-1 их бы отрезал).
      // chats в deps ниже: нужен, чтобы узнать type + передать groupId
      // в decryptMessage (групповой ключ msg_key_0).
      const isGroupChat = chats.some((c) => c.id === chatId && c.type === 'group');
      const baseSelect = supabase.from("messages").select("*");
      const filtered = isGroupChat
        ? baseSelect.eq("receiver_id", chatId)
        : baseSelect.or(
          `and(sender_id.eq.${currentUserId},receiver_id.eq.${chatId}),and(sender_id.eq.${chatId},receiver_id.eq.${currentUserId})`,
        );
      const { data, error } = await filtered
        .order("created_at", { ascending: true })
        .abortSignal(netAbort.signal);

      if (error) throw error;

      const processed = await Promise.all(
        (data || []).map(async (m: any) => {
          // Логи звонков НЕ шифруются E2EE — пропускаем дешифратор,
          // парсим незашифрованный JSON-метаданные из content.
          if (m.type === "call_log") {
            const meta = parseCallLogJson(m.content || "");
            return {
              ...m,
              call_status: meta.status,
              call_duration: meta.duration,
            } as Message;
          }
          // Голосовые: content — plaintext JSON-метаданные (аудио зашифровано
          // отдельно в bucket `voice`). Дешифратор текста не вызываем.
          if (m.type === "voice") {
            return { ...m, voice: parseVoiceMeta(m.content) } as Message;
          }
          // Файлы: content — plaintext JSON-мета (шифротекст лежит отдельно
          // в bucket `files`). Дешифратор текста не вызываем.
          if (m.type === "file") {
            return { ...m, file: parseFileMeta(m.content) } as Message;
          }
          // Текст/прочее: группы — симметрично через msg_key_0 (chatId как
          // 4-й аргумент!), DM — классический DH по собеседнику.
          const otherId =
            m.sender_id === currentUserId ? m.receiver_id : m.sender_id;
          // Остальные сообщения — стандартный E2EE-пайплайн,
          // защищённый try/catch от bad-padding при гонке ключей.
          try {
            return {
              ...m,
              content: await decryptMessage(
                m.content || "",
                m.nonce || "",
                otherId,
                isGroupChat ? chatId : undefined,
              ),
            } as Message;
          } catch (err) {
            console.error("Decrypt message failed:", err);
            return { ...m, content: "[E2EE Error]" } as Message;
          }
        }),
      );
      const decryptedMessages = processed.filter(Boolean) as Message[];

            // ─── Reply-таргеты: собираем id, дозапрашиваем, декриптим по типу ───
      const replyIds = [...new Set(
        (data || []).map((m: any) => m.reply_to_id).filter(Boolean)
      )] as string[];

      if (replyIds.length > 0) {
        try {
          const { data: replyRows } = await supabase
            .from("messages")
            .select("id, sender_id, receiver_id, content, nonce, type, created_at, call_status")
            .in("id", replyIds);

          if (replyRows) {
            const replyMap = new Map<string, any>();
            await Promise.all(replyRows.map(async (r: any) => {
              let content: string;
              if (r.type === "voice" || r.type === "file" || r.type === "call_log") {
                // plaintext-мета — decrypt не вызываем
                content = r.content || "";
              } else {
                const rIsGroup = chats.some((c) => c.id === r.receiver_id && c.type === 'group');
                const otherId = r.sender_id === currentUserId ? r.receiver_id : r.sender_id;
                try {
                  content = await decryptMessage(
                    r.content || "", r.nonce || "", otherId,
                    rIsGroup ? r.receiver_id : undefined,
                  );
                } catch { content = "[E2EE Error]"; }
              }
              replyMap.set(r.id, {
                id: r.id,
                sender_id: r.sender_id,
                type: r.type,
                content,
                call_status: r.call_status,
              });
            }));

            for (const m of decryptedMessages as any[]) {
              if (m.reply_to_id && replyMap.has(m.reply_to_id)) {
                m.reply_to = replyMap.get(m.reply_to_id);
              }
            }
          }
        } catch (e) {
          console.warn("[REPLY] reply-join failed:", e);
        }
      }

      // Недосланные из очереди — поверх серверного списка (они ещё не в БД).
      const withPending = withPendingForChat(decryptedMessages, chatId, currentUserId);
      setMessages(withPending);

      // 3. Save to cache (SQLCipher — plaintext в localStorage запрещён).
      // Fire-and-forget: UI не ждёт Rust-слой.
      void cacheSetBounded(
        cacheKey,
        JSON.stringify({ messages: withPending, timestamp: new Date().toISOString() }),
      ).catch((e) => console.warn("[CHAT-CACHE] messages cache write failed:", e));

      // 4. Mark unread as read (только DM: у групп нет per-user статуса;
      //    точный read-receipt — будущая таблица user_reads, см. 0012).
      const unreadIds = (data || [])
        .filter((m: any) => !isGroupChat && m.receiver_id === currentUserId && m.status !== "read")
        .map((m: any) => m.id);
      if (unreadIds.length > 0) {
        await supabase
          .from("messages")
          .update({ status: "read", read_at: new Date().toISOString() })
          .in("id", unreadIds);
      }
    } catch (err) {
      console.warn("[CHAT-CACHE] messages fetch failed, using cached:", err);
    } finally {
      clearTimeout(netTimeout);
    }
  }, [decryptMessage, withPendingForChat, chats]);

  const handleEditMessage = useCallback(
    async (selectedChat: Chat, text: string) => {
      if (!editingMessage) return;

      const encrypted = await encryptMessage(text, selectedChat.id);
      if (!encrypted) {
        toast.error("E2EE Key Error");
        return;
      }

      try {
        await supabase
          .from("messages")
          .update({ content: encrypted.content, nonce: encrypted.nonce, is_edited: true })
          .eq("id", editingMessage.id);

        setMessages((prev) =>
          prev.map((m) => (m.id === editingMessage.id ? { ...m, content: text, is_edited: true } : m)),
        );
        setEditingMessage(null);
        setNewMessage("");
      } catch {
        toast.error("Failed to edit message");
      }
    },
    [editingMessage, encryptMessage],
  );

  const handleSendMessage = useCallback(
    async (
      selectedChat: Chat,
      user: UserProfile,
      text: string,
      type: "text" | "sticker" | "gif" = "text",
      customContent?: string,
      onAddToQueue?: (msg: PendingMessage) => void,
    ) => {
      const content = customContent || text.trim();
      if (!content || !selectedChat || !user) return;

      // Handle edit mode
      if (editingMessage && type === "text") {
        await handleEditMessage(selectedChat, content);
        return;
      }

      setNewMessage("");

      const encrypted = await encryptMessage(content, selectedChat.id);
      if (!encrypted) {
        toast.error("E2EE Key Error");
        return;
      }

      // === Оптимистичное обновление ===
      const tempId = generateTempId();
      const optimisticMsg: Message = {
        id: tempId,
        sender_id: user.id,
        receiver_id: selectedChat.id,
        content: content,
        nonce: encrypted.nonce,
        type: type,
        status: "pending",
        created_at: new Date().toISOString(),
        reply_to_id: replyingTo?.id || null,
        reply_to: replyingTo ? {
          id: replyingTo.id,
          sender_id: replyingTo.sender_id,
          type: replyingTo.type,
          content: replyingTo.content, // уже расшифрованный в памяти
          call_status: replyingTo.call_status,
        } : null,
        _pendingContent: content,
        _pending: true,
      };
      setMessages((prev) => insertByCreatedAt(prev, optimisticMsg));
      setReplyingTo(null);

      try {
        const { data, error } = await supabase
          .from("messages")
          .insert({
            sender_id: user.id,
            receiver_id: selectedChat.id,
            content: encrypted.content,
            nonce: encrypted.nonce,
            type: type,
            status: "sent",
            reply_to_id: replyingTo?.id || null,
          })
          .select("id")
          .single();

        if (error) throw error;

        // FCM-пуш получателю — фоном, не блокирует отправку.
        // Убирает задержку доставки в фоне (Android Doze): если вебсокет
        // у получателя подвешен, push будит приложение и показывает
        // уведомление мгновенно. Edge-функция прочитает его токен из
        // device_tokens, чтобы контент (E2EE) в push не попадал.
        try {
          supabase.functions
            .invoke("send-message-push", {
              body: {
                receiver_id: selectedChat.id,
                sender_id: user.id,
                sender_name: user.display_name || user.username || "",
                sender_avatar: user.avatar_url || "",
              },
            })
            .then((res) => {
              console.log("[Push] send-message-push result:", res?.data ?? res);
            })
            .catch((e) => {
              // Не глотаем — даём видимый, полный диагноз (404 = не задеплоена,
              // 500 = секреты FCM, 200+skipped = у получателя нет токена).
              console.error("[Push] send-message-push failed:", e?.context ?? e?.message ?? e);
            });
        } catch (e) {
          console.error("[Push] failed to invoke send-message-push:", e);
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? { ...m, id: data.id, status: "sent" as const, _pending: false, content: content }
              : m,
          ),
        );
      } catch (err) {
        console.error("[QUEUE] text send failed, adding to offline queue:", err);

        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "pending" as const } : m)),
        );
        // ВАЖНО: в очередь (и в БД при досылке) уходит ТОЛЬКО шифротекст —
        // plaintext живёт исключительно в памяти/_pendingContent (SQLCipher).
        const pendingMsg: PendingMessage = {
          ...optimisticMsg,
          content: encrypted.content,
          nonce: encrypted.nonce,
          status: "pending",
          _pending: true,
          _pendingContent: content,
        } as PendingMessage;
        if (onAddToQueue) {
          onAddToQueue(pendingMsg);
        } else {
          console.error("[QUEUE] onAddToQueue не проброшен — текст не будет дослан");
          toast.error("Сообщение не отправлено");
        }
      }
    },
    [editingMessage, replyingTo, encryptMessage, handleEditMessage],
  );

  /**
   * ГОЛОСОВЫЕ — оптимистично, как текст:
   *  1) пузырь с часиками появляется СРАЗУ (placeholder-мета: duration уже
   *     известна, path/nonce пустые — шифра ещё нет);
   *  2) шифрование локально (IPC, офлайн-ok) → реальная мета в пузырь;
   *  3) шифротекст → outbox-файл (переживёт рестарт) → очередь;
   *  4) отправку (Storage upload + INSERT) делает очередь, сендинг в фоне.
   * При сетевом сбое ничего не теряется: сообщение остаётся pending и
   * досылается при возврате сети.
   */
  const handleSendVoice = useCallback(
    async (
      selectedChat: Chat,
      user: UserProfile,
      blob: Blob,
      durationSec: number,
      onAddToQueue?: (msg: PendingMessage) => void,
    ) => {
      if (!selectedChat || !user || !blob) return;

      const receiverId = selectedChat.id;
      const tempId = generateTempId();
      const createdAt = new Date().toISOString();
      const replyToId = replyingTo?.id || null;

      // 1) Мгновенный пузырь. duration берём из рекордера → волна и время
      //    рендерятся сразу, без ожидания шифрования/сети.
      const placeholder: VoiceMeta = {
        path: "",
        nonce: "",
        mime: blob.type || "audio/webm",
        duration: Math.max(0, Math.round(durationSec)),
        to: receiverId,
        v: MEDIA_VERSION_RAW,
      };
      const optimistic: Message = {
        id: tempId,
        sender_id: user.id,
        receiver_id: receiverId,
        content: JSON.stringify(placeholder),
        voice: placeholder,
        type: "voice",
        status: "sending",
        created_at: createdAt,
        reply_to_id: replyToId,
        _pending: true,
        _pendingContent: "",
      };
      setMessages((prev) => insertByCreatedAt(prev, optimistic));
      setReplyingTo(null);

      // 2) Фон: шифруем локально → outbox → очередь (она же делает отправку).
      void (async () => {
        // ГРУППА: голос шифруем msg_key_0 (один шифротекст для всех),
        // мета v=3/enc='group'. DM — прежний NaCl box (encryptVoicePayload).
        if (selectedChat.type === 'group' && selectedChat.msg_key_0) {
          try {
            const { encryptAndUploadGroupVoice } = await import("@/lib/group-upload");
            const gMeta = await encryptAndUploadGroupVoice(
              user.id, receiverId, selectedChat.msg_key_0, blob, durationSec,
            );
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempId ? { ...m, content: JSON.stringify(gMeta), voice: gMeta as any } : m,
              ),
            );
            // Групповой шифротекст уже залит — INSERT делаем сразу здесь
            // (очередь для групп пока не умеет v=3 outbox; TODO: унификация).
            try {
              const { supabase } = await import("@/lib/supabase");
              const { data: inserted, error } = await supabase.from("messages").insert({
                sender_id: user.id,
                receiver_id: receiverId,
                type: "voice",
                content: JSON.stringify(gMeta),
                status: "sent",
                reply_to_id: replyToId,
              }).select().single();
              if (error) throw error;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempId ? { ...m, id: inserted.id, status: "sent" as const, _pending: false } : m,
                ),
              );
            } catch (e) {
              console.warn("[GROUP-VOICE] insert failed → pending:", e);
              if (onAddToQueue) {
                onAddToQueue({
                  ...optimistic,
                  content: JSON.stringify(gMeta),
                  voice: gMeta as any,
                  status: "pending",
                  _pending: true,
                  _pendingContent: "",
                } as PendingMessage);
              }
            }
          } catch (e) {
            console.error("[QUEUE] group voice encrypt failed:", e);
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            toast.error("Не удалось зашифровать голосовое сообщение");
          }
          return;
        }
        let payload: VoicePayload;
        try {
          // Публичный ключ берём из локального кэша чата (chats.public_key) —
          // иначе офлайн-старт упёрся бы в сетевой запрос профиля.
          payload = await encryptVoicePayload(
            user.id,
            receiverId,
            blob,
            durationSec,
            selectedChat.public_key ?? null,
          );
        } catch (e) {
          console.error("[QUEUE] voice encrypt failed:", e);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          toast.error("Не удалось зашифровать голосовое сообщение");
          return;
        }

        try {
          const realMeta = buildVoiceMeta(payload, receiverId);
          // Реальная мета в пузыре: нужна и для досылки, и для восстановления
          // пузыря из очереди после рестарта.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId ? { ...m, content: JSON.stringify(realMeta), voice: realMeta } : m,
            ),
          );

          // Шифротекст — ФАЙЛОМ в AppCache (в очередь кладём только путь:
          // очередь персистится в SQLCipher и перезаписывается целиком).
          const outboxPath = await putOutboxBlob(tempId, payload.cipher);

          const pending: PendingMessage = {
            ...optimistic,
            content: JSON.stringify(realMeta),
            voice: realMeta,
            status: "pending",
            _pending: true,
            _pendingContent: "",
            media: {
              kind: "voice",
              outboxPath,
              remotePath: payload.remotePath,
              nonce: payload.nonce,
              mime: payload.mime,
              duration: realMeta.duration,
            },
          } as PendingMessage;

          if (!onAddToQueue) {
            console.error("[QUEUE] onAddToQueue не проброшен — голосовое не будет дослано");
            toast.error("Очередь отправки недоступна");
            return;
          }
          // Очередь = источник правды: она сразу же попробует отправить
          // (быстрый путь) и оставит сообщение при сетевом сбое.
          onAddToQueue(pending);
        } catch (e) {
          console.error("[QUEUE] voice queueing failed:", e);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          toast.error("Не удалось отправить голосовое сообщение");
        }
      })();
    },
    [replyingTo],
  );

  return {
    messages,
    setMessages,
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    newMessage,
    setNewMessage,
    fetchMessages,
    handleSendMessage,
    handleEditMessage,
    handleSendVoice,
    messagesCacheKey: "",
  };
}