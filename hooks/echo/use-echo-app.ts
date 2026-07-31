"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { clearAuthProgress } from '@/lib/auth-storage';
import { deletePrivateKey } from '@/lib/db';
import { useE2EE } from './use-e2ee';

export const useEchoApp = (user: any) => {
  const router = useRouter();
  const [chats, setChats] = useState<any[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [lastSeenMap, setLastSeenMap] = useState<Record<string, string>>({});
  const { decryptMessage } = useE2EE(chats);

  // === Ref для актуальной decryptMessage ===
  const decryptMessageRef = useRef(decryptMessage);
  decryptMessageRef.current = decryptMessage;

  const userRef = useRef(user);
  userRef.current = user;

  const fetchChats = useCallback(async (currentUserId: string) => {
    const cacheKey = `echo_chats_cache_${currentUserId}`;

    // 1. Load from cache immediately
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.chats && Array.isArray(parsed.chats)) {
          setChats(prev => {
            if (JSON.stringify(prev) === JSON.stringify(parsed.chats)) return prev;
            return parsed.chats;
          });
        }
      }
    } catch (e) { /* ignore */ }

    // 2. Fetch fresh data
    try {
      const { data: recentMessages, error: msgError } = await supabase
        .from('messages')
        .select('*')
        .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
        .order('created_at', { ascending: false })
        .limit(100);

      if (msgError) throw msgError;

      const chatMap: Record<string, any> = {};
      const participantIds: string[] = [];

      for (const m of (recentMessages || [])) {
        if (!m || !m.sender_id || !m.receiver_id) continue;
        const otherId = m.sender_id === currentUserId ? m.receiver_id : m.sender_id;
        if (!chatMap[otherId]) {
          participantIds.push(otherId);
          chatMap[otherId] = {
            lastMsgRaw: m,
            lastMessageTime: m.created_at,
            unreadCount: (m.receiver_id === currentUserId && m.status !== 'read') ? 1 : 0
          };
        } else if (m.receiver_id === currentUserId && m.status !== 'read') {
          chatMap[otherId].unreadCount++;
        }
      }

      if (participantIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', participantIds);
        if (profiles) {
          const decrypt = decryptMessageRef.current;

          const finalChats = await Promise.all(profiles.map(async (p) => {
            const chatData = chatMap[p.id];
            if (!chatData || !chatData.lastMsgRaw) return null;

            const decrypted = await decrypt(
              chatData.lastMsgRaw.content || '',
              chatData.lastMsgRaw.nonce || '',
              p.id
            );
            return {
              ...p,
              lastMessage: decrypted,
              lastMessageTime: chatData.lastMessageTime,
              unreadCount: chatData.unreadCount
            };
          }));

          const filteredChats = finalChats.filter((c): c is any => c !== null);
          filteredChats.sort((a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime());

          setChats(prev => {
            if (prev.length === filteredChats.length &&
                prev.every((c, i) => c.id === filteredChats[i].id &&
                                     c.lastMessage === filteredChats[i].lastMessage &&
                                     c.unreadCount === filteredChats[i].unreadCount)) {
              return prev;
            }
            return filteredChats;
          });

          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              chats: filteredChats,
              timestamp: new Date().toISOString()
            }));
          } catch (e) { /* ignore */ }
        }
      }
    } catch (err) {
      console.error('Fetch chats error:', err);
    }
  }, []);

  // === Realtime подписки для user.id ===
  useEffect(() => {
    if (!user?.id) return;

    let isMounted = true;
    let presenceChannel: any = null;
    let msgChannel: any = null;

    const init = async () => {
      fetchChats(user.id);

      presenceChannel = supabase.channel('online-presence', {
        config: { presence: { key: user.id } }
      });

      presenceChannel.on('presence', { event: 'sync' }, () => {
        if (!isMounted) return;
        const state = presenceChannel.presenceState();
        const newUsers = new Set(Object.keys(state));
        setOnlineUsers(prev => {
          if (prev.size === newUsers.size && Array.from(prev).every(u => newUsers.has(u))) {
            return prev;
          }
          return newUsers;
        });
      });

      presenceChannel.on('presence', { event: 'join' }, () => {
        if (!isMounted) return;
        const state = presenceChannel.presenceState();
        const newUsers = new Set(Object.keys(state));
        setOnlineUsers(prev => {
          if (prev.size === newUsers.size && Array.from(prev).every(u => newUsers.has(u))) {
            return prev;
          }
          return newUsers;
        });
      });

      presenceChannel.on('presence', { event: 'leave' }, () => {
        if (!isMounted) return;
        const state = presenceChannel.presenceState();
        const newUsers = new Set(Object.keys(state));
        setOnlineUsers(prev => {
          if (prev.size === newUsers.size && Array.from(prev).every(u => newUsers.has(u))) {
            return prev;
          }
          return newUsers;
        });
      });

      presenceChannel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED' && isMounted) {
          presenceChannel.track({ online_at: new Date().toISOString() });
        }
      });

      msgChannel = supabase.channel('global-chat-updates');
      msgChannel.on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages'
      }, (payload: any) => {
        const nm = payload.new as any;
        if (nm.receiver_id === user.id || nm.sender_id === user.id) {
          fetchChats(user.id);
        }
      }).subscribe();
    };

    init();

    return () => {
      isMounted = false;
      if (presenceChannel) supabase.removeChannel(presenceChannel);
      if (msgChannel) supabase.removeChannel(msgChannel);
    };
  }, [user?.id]);

  // === Drafts ===
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftsLoaded, setDraftsLoaded] = useState(false);

  useEffect(() => {
    if (!user || draftsLoaded) return;

    try {
      const localDrafts = JSON.parse(localStorage.getItem(`echo_drafts_${user.id}`) || '{}');
      const supabaseDrafts = user.user_metadata?.drafts || {};
      const merged = { ...localDrafts, ...supabaseDrafts };
      setDrafts(merged);
    } catch (e) {
      setDrafts({});
    }
    setDraftsLoaded(true);
  }, [user?.id, draftsLoaded]);

  const saveDraft = useCallback((chatId: string, text: string) => {
    if (!user) return;

    setDrafts(prev => {
      if (prev[chatId] === text) return prev;
      const newDrafts = { ...prev, [chatId]: text };
      localStorage.setItem(`echo_drafts_${user.id}`, JSON.stringify(newDrafts));
      return newDrafts;
    });
  }, [user?.id]);

  // === Security Watchdog ===
  useEffect(() => {
    if (!user?.id) return;

    const hwid = localStorage.getItem('echo_device_hwid');
    let deviceChannel: any = null;

    deviceChannel = supabase.channel(`security-${user.id}`);
    deviceChannel.on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'devices',
      filter: `user_id=eq.${user.id}`
    }, (payload: any) => {
      if (payload.old && payload.old.hwid === hwid) {
        supabase.auth.signOut().catch(() => {});
        clearAuthProgress().catch(() => {});
        deletePrivateKey().catch(() => {});
        try {
          localStorage.removeItem('echo_public_key');
          localStorage.removeItem('echo_mnemonic_backup');
        } catch {
          // ignore
        }
        router.push('/auth');
      }
    }).subscribe();

    return () => {
      if (deviceChannel) supabase.removeChannel(deviceChannel);
    };
  }, [user?.id]);

  // === Стабилизация объектов ===
  const stableOnlineUsers = useMemo(() => onlineUsers, [onlineUsers]);
  const stableDrafts = useMemo(() => drafts, [drafts]);
  const stableLastSeenMap = useMemo(() => lastSeenMap, [lastSeenMap]);

  return {
    chats,
    setChats,
    onlineUsers: stableOnlineUsers,
    setOnlineUsers,
    lastSeenMap: stableLastSeenMap,
    fetchChats,
    drafts: stableDrafts,
    saveDraft
  };
};