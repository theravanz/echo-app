"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useE2EE } from "./use-e2ee";
import { cacheGetBounded, cacheSetBounded } from "./chat-cache";
import type { Chat, UserProfile, Message, ConnectionStatus } from "./types";

interface UseChatListReturn {
  chats: Chat[];
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
  fetchChats: (currentUserId: string) => Promise<void>;
  selectedChat: Chat | null;
  setSelectedChat: React.Dispatch<React.SetStateAction<Chat | null>>;
  selectedChatRef: React.MutableRefObject<Chat | null>;
  chatsFetchError: boolean;
  drafts: Record<string, string>;
  saveDraft: (chatId: string, text: string) => void;
  loadDraft: (chatId: string) => string;
  onlineUsers: Set<string>;
  lastSeenMap: Record<string, string>;
}

/**
 * Сетевой запрос списка не должен висеть минутами: жёсткий abort-таймаут.
 * Офлайн-детект по статусу (см. ниже) обычно вообще не пускает в сеть —
 * это защита от «статус connected, а сеть мертва».
 */
const CHATS_NET_TIMEOUT_MS = 8000;

export function useChatList(
  user: UserProfile | null,
  connectionStatus: ConnectionStatus = "connected",
): UseChatListReturn {
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsFetchError, setChatsFetchError] = useState(false);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const selectedChatRef = useRef<Chat | null>(null);
  const { decryptMessage } = useE2EE(chats);
  const decryptMessageRef = useRef(decryptMessage);
  decryptMessageRef.current = decryptMessage;
  const userRef = useRef(user);
  userRef.current = user;
  // Статус связи из useConnection: если disconnected — сеть не трогаем,
  // рендерим из кэша сразу (иначе список ждал сетевые таймауты).
  const connectionStatusRef = useRef<ConnectionStatus>(connectionStatus);
  connectionStatusRef.current = connectionStatus;

  // === Online Presence ===
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [lastSeenMap, setLastSeenMap] = useState<Record<string, string>>({});

  // === Drafts ===
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftsLoaded, setDraftsLoaded] = useState(false);

  useEffect(() => {
    if (!user || draftsLoaded) return;
    try {
      const localDrafts = JSON.parse(localStorage.getItem(`echo_drafts_${user.id}`) || "{}");
      const metaDrafts = (user as any).user_metadata?.drafts || {};
      setDrafts({ ...localDrafts, ...metaDrafts });
    } catch {
      setDrafts({});
    }
    setDraftsLoaded(true);
  }, [user?.id, draftsLoaded]);

  const saveDraft = useCallback(
    (chatId: string, text: string) => {
      if (!user) return;
      setDrafts((prev) => {
        if (prev[chatId] === text) return prev;
        const newDrafts = { ...prev, [chatId]: text };
        localStorage.setItem(`echo_drafts_${user.id}`, JSON.stringify(newDrafts));
        return newDrafts;
      });
    },
    [user?.id],
  );

  const loadDraft = useCallback(
    (chatId: string) => {
      return drafts[chatId] || "";
    },
    [drafts],
  );

  // === Chat Fetching ===
  const fetchChats = useCallback(async (currentUserId: string) => {
    const cacheKey = `echo_chats_cache_${currentUserId}`;
    let cachedChatsAvailable = false;

    // 1. Load from cache immediately (SQLCipher через Rust-слой, см. chat-cache.ts)
    try {
      const cached = await cacheGetBounded(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.chats && Array.isArray(parsed.chats)) {
          setChats((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(parsed.chats)) return prev;
            return parsed.chats;
          });
          cachedChatsAvailable = true;
        }
      }
    } catch (e) {
      console.warn("[CHAT-CACHE] failed to read chats cache:", e);
    }

    // 2. Офлайн-детект ДО сети: статус из useConnection + navigator.onLine.
    // Иначе список ждал сетевые таймауты (десятки секунд), хотя сайдбар
    // уже показывал Offline. Нет сети — рендерим кэш и выходим сразу.
    const offlineNow =
      (typeof navigator !== "undefined" && !navigator.onLine) ||
      connectionStatusRef.current === "disconnected";

    if (offlineNow) {
      if (cachedChatsAvailable) {
        console.warn("[CHAT-CACHE] offline (status), using cached chats — network skipped");
        setChatsFetchError(false);
      } else {
        console.warn("[CHAT-CACHE] offline (status) and no cache available");
        setChatsFetchError(true);
      }
      return;
    }

    // 3. Fetch fresh data — с жёстким abort-таймаутом
    const netAbort = new AbortController();
    const netTimeout = setTimeout(() => netAbort.abort(), CHATS_NET_TIMEOUT_MS);
    try {
      const signal = netAbort.signal;
      const { data: recentMessages, error: msgError } = await supabase
        .from("messages")
        .select("*")
        .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
        .order("created_at", { ascending: false })
        .limit(100)
        .abortSignal(signal);

      if (msgError) throw msgError;

      const chatMap: Record<string, any> = {};
      const participantIds: string[] = [];

      for (const m of recentMessages || []) {
        if (!m || !m.sender_id || !m.receiver_id) continue;
        const otherId = m.sender_id === currentUserId ? m.receiver_id : m.sender_id;
        if (!chatMap[otherId]) {
          participantIds.push(otherId);
          chatMap[otherId] = {
            lastMsgRaw: m,
            lastMessageTime: m.created_at,
            unreadCount: m.receiver_id === currentUserId && m.status !== "read" ? 1 : 0,
          };
        } else if (m.receiver_id === currentUserId && m.status !== "read") {
          chatMap[otherId].unreadCount++;
        }
      }

      if (participantIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("*")
          .in("id", participantIds)
          .abortSignal(signal);

if (profiles) {
  const decrypt = decryptMessageRef.current;
  const finalChats = await Promise.all(
    profiles.map(async (p: any) => {
      const chatData = chatMap[p.id];
      if (!chatData?.lastMsgRaw) return null;
      
      const msgType = chatData.lastMsgRaw.type || 'text';
      
      // voice/file/call_log: content — plaintext JSON-мета (или системные данные),
      // decrypt НЕ вызываем. Превью строим из меты напрямую.
      let preview: string;
      if (msgType === 'voice') {
        preview = '🎙 Голосовое сообщение';
      } else if (msgType === 'file') {
        let meta: any = null;
        try {
          meta = JSON.parse(chatData.lastMsgRaw.content || '{}');
        } catch { /* ignore */ }
        preview = meta?.name ? `📎 ${meta.name}` : '📎 Файл';
      } else if (msgType === 'call_log') {
        const cs = chatData.lastMsgRaw.call_status || 'missed';
        preview = cs === 'missed' ? '📞 Пропущенный звонок' : cs === 'incoming' ? '📞 Входящий звонок' : '📞 Исходящий звонок';
      } else if (msgType === 'sticker') {
        preview = '📸 Sticker';
      } else if (msgType === 'gif') {
        preview = '🎥 GIF';
      } else {
        // Только текст прогоняем через E2EE-дешифратор
        const decrypted = await decrypt(
          chatData.lastMsgRaw.content || "",
          chatData.lastMsgRaw.nonce || "",
          p.id,
        );
        preview = decrypted;
      }
      
      return {
        ...p,
        id: p.id,
        lastMessage: preview,
        lastMessageType: msgType,
        lastMessageTime: chatData.lastMessageTime,
        unreadCount: chatData.unreadCount,
      } as Chat;
    }),
  );

          const filteredChats = finalChats.filter((c): c is Chat => c !== null);
          filteredChats.sort(
            (a, b) => new Date(b.lastMessageTime!).getTime() - new Date(a.lastMessageTime!).getTime(),
          );

          setChats(filteredChats);
          // Запись — fire-and-forget: UI не ждёт Rust-слой (сериализованные
          // записи в chat-cache; при таймауте запись всё равно доедет).
          void cacheSetBounded(cacheKey, JSON.stringify({ chats: filteredChats }))
            .catch((e) => console.warn("[CHAT-CACHE] chats cache write failed:", e));
          setChatsFetchError(false);
        }
      }
    } catch (err) {
      // [CHAT-CACHE] Оффлайн: если кэш уже отрендерен (шаг 1 выше) — тихо
      // продолжаем на нём, realtime/fresh обновятся при возврате сети.
      // Если кэша нет — выставляем флаг, чтобы UI показал «нет сети»
      // вместо вечного спиннера / пустого списка.
      if (cachedChatsAvailable) {
        console.warn("[CHAT-CACHE] network fetch failed, using cached chats:", err);
      } else {
        console.warn("[CHAT-CACHE] network fetch failed and no cache available:", err);
        setChatsFetchError(true);
      }
    } finally {
      clearTimeout(netTimeout);
    }
  }, []);

  // === Online Presence Subscription ===
  useEffect(() => {
    if (!user?.id) return;

    let isMounted = true;
    let presenceChannel: any = null;

    const init = async () => {
      presenceChannel = supabase.channel("online-users", {
        config: { presence: { key: user.id } },
      });

      presenceChannel.on("presence", { event: "sync" }, () => {
        if (!isMounted) return;
        const state = presenceChannel.presenceState();
        const newUsers = new Set(Object.keys(state));
        setOnlineUsers((prev) => {
          if (prev.size === newUsers.size && Array.from(prev).every((u) => newUsers.has(u))) return prev;
          return newUsers;
        });
      });

      presenceChannel.subscribe((status: string) => {
        if (status === "SUBSCRIBED" && isMounted) {
          presenceChannel.track({ online_at: new Date().toISOString() });
        }
      });
    };

    init();

    return () => {
      isMounted = false;
      if (presenceChannel) supabase.removeChannel(presenceChannel);
    };
  }, [user?.id]);

  // Sync selectedChat ref
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  const stableOnlineUsers = useMemo(() => onlineUsers, [onlineUsers]);
  const stableDrafts = useMemo(() => drafts, [drafts]);
  const stableLastSeenMap = useMemo(() => lastSeenMap, [lastSeenMap]);

  return {
    chats,
    setChats,
    chatsFetchError,
    fetchChats,
    selectedChat,
    setSelectedChat,
    selectedChatRef,
    drafts: stableDrafts,
    saveDraft,
    loadDraft,
    onlineUsers: stableOnlineUsers,
    lastSeenMap: stableLastSeenMap,
  };
}
