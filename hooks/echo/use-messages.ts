"use client";

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useE2EE } from "./use-e2ee";
import { generateTempId } from "./use-network-queue";
import { parseCallLogJson } from "./call-log";
import type { Message, PendingMessage, Chat, UserProfile } from "./types";

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
  handleEditMessage: (
    selectedChat: Chat,
    text: string,
  ) => Promise<void>;
  messagesCacheKey: string;
}

export function useMessages(chats: Chat[] = []): UseMessagesReturn {
  const { encryptMessage, decryptMessage } = useE2EE(chats); // ← Передаем chats!
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const fetchMessages = useCallback(async (chatId: string, currentUserId: string) => {
    const cacheKey = `echo_msgs_cache_${currentUserId}_${chatId}`;

    // 1. Load from cache immediately
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.messages && Array.isArray(parsed.messages)) {
          setMessages(parsed.messages);
        }
      }
    } catch { /* ignore */ }

    // 2. Fetch fresh from server
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${currentUserId},receiver_id.eq.${chatId}),and(sender_id.eq.${chatId},receiver_id.eq.${currentUserId})`,
        )
        .order("created_at", { ascending: true });

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
              ),
            } as Message;
          } catch (err) {
            console.error("Decrypt message failed:", err);
            return { ...m, content: "[E2EE Error]" } as Message;
          }
        }),
      );
      const decryptedMessages = processed.filter(Boolean);
      setMessages(decryptedMessages as Message[]);

      // 3. Save to cache
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({ messages: decryptedMessages, timestamp: new Date().toISOString() }),
        );
      } catch { /* storage full */ }

      // 4. Mark unread as read
      const unreadIds = (data || [])
        .filter((m: any) => m.receiver_id === currentUserId && m.status !== "read")
        .map((m: any) => m.id);
      if (unreadIds.length > 0) {
        await supabase
          .from("messages")
          .update({ status: "read", read_at: new Date().toISOString() })
          .in("id", unreadIds);
      }
    } catch (err) {
      console.error("Fetch messages error:", err);
    }
  }, [decryptMessage]);

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
        content: encrypted.content,
        nonce: encrypted.nonce,
        type: type,
        status: "pending",
        created_at: new Date().toISOString(),
        reply_to_id: replyingTo?.id || null,
        _pendingContent: content,
        _pending: true,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
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

        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? { ...m, id: data.id, status: "sent" as const, _pending: false }
              : m,
          ),
        );
      } catch (err) {
        console.error("Send error, adding to offline queue:", err);

        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "pending" as const } : m)),
        );
        const pendingMsg: PendingMessage = {
          ...optimisticMsg,
          id: tempId,
          status: "pending",
          _pending: true,
        } as PendingMessage;
        onAddToQueue?.(pendingMsg);
      }
    },
    [editingMessage, replyingTo, encryptMessage, handleEditMessage],
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
    messagesCacheKey: "",
  };
}