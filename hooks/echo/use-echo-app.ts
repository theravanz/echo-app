"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useE2EE } from './use-e2ee';

export const useEchoApp = (user: any) => {
  const [chats, setChats] = useState<any[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [lastSeenMap, setLastSeenMap] = useState<Record<string, string>>({});
  const { decryptMessage } = useE2EE(chats);

  const fetchChats = useCallback(async (currentUserId: string) => {
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
          const finalChats = await Promise.all(profiles.map(async (p) => {
            const chatData = chatMap[p.id];
            if (!chatData || !chatData.lastMsgRaw) return null;
            
            const decrypted = await decryptMessage(
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
          setChats(filteredChats);
        }
      }
    } catch (err) {
      console.error('Fetch chats error:', err);
    }
  }, [decryptMessage]);

  useEffect(() => {
    if (!user) return;

    fetchChats(user.id);

    // Setup presence
    const presence = supabase.channel('online-presence', { config: { presence: { key: user.id } } });
    presence.on('presence', { event: 'sync' }, () => {
      setOnlineUsers(new Set(Object.keys(presence.presenceState())));
    }).subscribe(async (s) => {
      if (s === 'SUBSCRIBED') await presence.track({ online_at: new Date().toISOString() });
    });

    // Global messages listener for chat list updates
    const msgChannel = supabase.channel('global-chat-updates').on('postgres_changes', { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'messages' 
    }, (payload) => {
      const nm = payload.new as any;
      if (nm.receiver_id === user.id || nm.sender_id === user.id) {
        fetchChats(user.id);
      }
    }).subscribe();

    return () => {
      supabase.removeChannel(presence);
      supabase.removeChannel(msgChannel);
    };
  }, [user?.id, fetchChats]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftsLoaded, setDraftsLoaded] = useState(false);

  // Drafts logic
  useEffect(() => {
    if (user && !draftsLoaded) {
      const localDrafts = JSON.parse(localStorage.getItem(`echo_drafts_${user.id}`) || '{}');
      const supabaseDrafts = user.user_metadata?.drafts || {};
      const merged = { ...localDrafts, ...supabaseDrafts };
      setDrafts(merged);
      setDraftsLoaded(true);
    }
  }, [user, draftsLoaded]);

  const saveDraft = useCallback((chatId: string, text: string) => {
    if (!user) return;
    const newDrafts = { ...drafts, [chatId]: text };
    setDrafts(newDrafts);
    localStorage.setItem(`echo_drafts_${user.id}`, JSON.stringify(newDrafts));
    
    // Debounced sync to Supabase (simplification: just log for now or implement debounce)
  }, [user, drafts]);

  // Security Watchdog
  useEffect(() => {
    if (!user) return;
    const hwid = localStorage.getItem('echo_device_hwid');
    
    const deviceChannel = supabase.channel(`security-${user.id}`).on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'devices',
      filter: `user_id=eq.${user.id}`
    }, (payload) => {
      // If our current device is deleted, logout
      if (payload.old && payload.old.hwid === hwid) {
        supabase.auth.signOut();
        window.location.href = '/auth';
      }
    }).subscribe();

    return () => { supabase.removeChannel(deviceChannel); };
  }, [user?.id]);

  return { chats, setChats, onlineUsers, lastSeenMap, fetchChats, drafts, saveDraft };
};
