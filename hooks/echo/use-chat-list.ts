"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useE2EE } from "./use-e2ee";
import type { Chat, UserProfile, Message } from "./types";

interface UseChatListReturn {
  chats: Chat[];
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
  fetchChats: (currentUserId: string) => Promise<void>;
  selectedChat: Chat | null;
  setSelectedChat: React.Dispatch<React.SetStateAction<Chat | null>>;
  selectedChatRef: React.MutableRefObject<Chat | null>;
  drafts: Record<string, string>;
  saveDraft: (chatId: string, text: string) => void;
  loadDraft: (chatId: string) => string;
  onlineUsers: Set<string>;
  lastSeenMap: Record<string, string>;
}

export function useChatList(user: UserProfile | null): UseChatListReturn {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const selectedChatRef = useRef<Chat | null>(null);
  const { decryptMessage } = useE2EE(chats);
  const decryptMessageRef = useRef(decryptMessage);
  decryptMessageRef.current = decryptMessage;
  const userRef = useRef(user);
  userRef.current = user;

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

    // 1. Load from cache immediately
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.chats && Array.isArray(parsed.chats)) {
          setChats((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(parsed.chats)) return prev;
            return parsed.chats;
          });
        }
      }
    } catch { /* ignore */ }

    // 2. Fetch fresh data
    try {
      const { data: recentMessages, error: msgError } = await supabase
        .from("messages")
        .select("*")
        .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
        .order("created_at", { ascending: false })
        .limit(100);

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
          .in("id", participantIds);

        if (profiles) {
          const decrypt = decryptMessageRef.current;
          const finalChats = await Promise.all(
            profiles.map(async (p: any) => {
              const chatData = chatMap[p.id];
              if (!chatData?.lastMsgRaw) return null;
              const decrypted = await decrypt(
                chatData.lastMsgRaw.content || "",
                chatData.lastMsgRaw.nonce || "",
                p.id,
              );
              // Format preview for media messages
              const msgType = chatData.lastMsgRaw.type || 'text';
              const preview = msgType === 'sticker' ? '📸 Sticker'
                : msgType === 'gif' ? '🎥 GIF'
                : decrypted;
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
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ chats: filteredChats }));
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      console.error("Fetch chats error:", err);
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
