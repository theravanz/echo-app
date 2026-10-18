"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useE2EE } from "./use-e2ee";
import { cacheGetBounded, cacheSetBounded } from "./chat-cache";
import { openGroupKeyPacket, openGroupMetadata, loadGroupKeys, saveGroupKey } from "@/lib/groups";
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

/**
 * Построить список групповых чатов текущего пользователя (Zero-Knowledge).
 *
 * Поток на каждую группу:
 *  1. group_members (user_id = me) → список group_id.
 *  2. groups (in group_id) → encrypted_metadata + metadata_nonce + creator_id.
 *  3. profiles (in creator_id) → public_key создателя (нужен для DH).
 *  4. group_key_mailbox (user_id = me) → пакет ключей (только первый вход).
 *  5. Локальный кэш ключей (SQLCipher): если info_key уже раскрыт — не лезем
 *     в mailbox. Иначе openGroupKeyPacket → info_key → openGroupMetadata →
 *     { name, bio, avatar_url } → сохраняем ключ локально.
 *
 * Возвращает Chat[] с type:'group'. Ошибки одной группы не роняют остальные.
 */
async function buildGroupChats(userId: string, signal: AbortSignal): Promise<Chat[]> {
  const { data: memberships, error: memErr } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .abortSignal(signal);
  if (memErr || !memberships?.length) return [];
  const groupIds = memberships.map((m: any) => m.group_id);

  // Подтягиваем всех участников этих групп для подсчета member_count
  const { data: allMembers } = await supabase
    .from("group_members")
    .select("group_id, user_id")
    .in("group_id", groupIds)
    .abortSignal(signal);

  const memberCountMap = new Map<string, number>();
  for (const m of allMembers || []) {
    memberCountMap.set(m.group_id, (memberCountMap.get(m.group_id) || 0) + 1);
  }

  const { data: groups, error: gErr } = await supabase
    .from("groups")
    .select("*")
    .in("id", groupIds)
    .abortSignal(signal);
  if (gErr || !groups?.length) return [];

  const creatorIds = Array.from(new Set(groups.map((g: any) => g.creator_id).filter(Boolean)));
  const [{ data: creators }, { data: packets }] = await Promise.all([
    supabase.from("profiles").select("id, public_key").in("id", creatorIds).abortSignal(signal),
    supabase.from("group_key_mailbox").select("group_id, encrypted_payload, nonce").eq("user_id", userId).abortSignal(signal),
  ]);
  const creatorPub = new Map<string, string>((creators ?? []).map((p: any) => [p.id, p.public_key]));
  const packetByGroup = new Map<string, any>((packets ?? []).map((p: any) => [p.group_id, p]));

  const cachedKeys = await loadGroupKeys(userId);

  const chats = await Promise.all(
    groups.map(async (g: any): Promise<Chat | null> => {
      const creatorPublicKey = creatorPub.get(g.creator_id) ?? "";
      let keys = cachedKeys[g.id];

      if (!keys) {
        const pkt = packetByGroup.get(g.id);
        if (!pkt || !creatorPublicKey) return null;
        try {
          keys = await openGroupKeyPacket(creatorPublicKey, pkt.encrypted_payload, pkt.nonce);
          await saveGroupKey(userId, g.id, keys);
        } catch (e) {
          console.warn("[CHAT-CACHE] group key open failed:", g.id, e);
          return null;
        }
      }
      if (!creatorPublicKey) return null;

      let meta: { name?: string; bio?: string; avatar_url?: string };
      try {
        meta = await openGroupMetadata(keys.info_key, creatorPublicKey, g.encrypted_metadata, g.metadata_nonce);
      } catch (e) {
        console.warn("[CHAT-CACHE] group metadata open failed:", g.id, e);
        return null;
      }

      return {
        id: g.id,
        type: "group",
        creator_id: g.creator_id,
        display_name: meta.name || "Группа",
        bio: meta.bio || "",
        avatar_storage_path: meta.avatar_url || null,
        avatar_nonce: null,
        avatar_mime: null,
        group_seed: keys.seed,
        msg_key_0: keys.msg_key_0, // ← Сохраняем msg_key_0
        member_count: memberCountMap.get(g.id) || 1,
        lastMessage: "Группа создана",
        lastMessageTime: g.created_at,
        created_at: g.created_at,
        unreadCount: 0,
        wallpaper_preset: "solid",
        wallpaper_photo_url: null,
      } as Chat;
    }),
  );

  return chats.filter((c): c is Chat => c !== null);
}

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
      // Группы тянем ПАРАЛЛЕЛЬНО с пайплайном DM (Promise.all внутри buildGroupChats).
      const groupChatsPromise = buildGroupChats(currentUserId, signal);
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

      let dmChats: Chat[] = [];
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
        type: 'direct',
        lastMessage: preview,
        lastMessageType: msgType,
        lastMessageTime: chatData.lastMessageTime,
        unreadCount: chatData.unreadCount,
      } as Chat;
    }),
  );

          dmChats = finalChats.filter((c): c is Chat => c !== null);
        }
      }

      // Объединяем DM + группы в один плоский список, сортируем по
      // последнему обновлению (lastMessageTime, fallback — created_at группы).
      const groupChats = await groupChatsPromise;
      const allChats = [...dmChats, ...groupChats];
      allChats.sort(
        (a, b) =>
          new Date(b.lastMessageTime || b.created_at || 0).getTime() -
          new Date(a.lastMessageTime || a.created_at || 0).getTime(),
      );

      setChats(allChats);
      // Запись — fire-and-forget: UI не ждёт Rust-слой (сериализованные
      // записи в chat-cache; при таймауте запись всё равно доедет).
      void cacheSetBounded(cacheKey, JSON.stringify({ chats: allChats }))
        .catch((e) => console.warn("[CHAT-CACHE] chats cache write failed:", e));
      setChatsFetchError(false);
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
