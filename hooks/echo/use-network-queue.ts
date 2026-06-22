"use client";

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { PendingMessage } from "./types";

interface UseNetworkQueueReturn {
  pendingQueue: PendingMessage[];
  addToQueue: (msg: PendingMessage) => void;
  processPendingQueue: () => Promise<void>;
  updateLocalMessageStatus: (tempId: string, updates: Partial<PendingMessage>) => void;
  getQueueLength: () => number;
}

// Генерация временного ID для локальных сообщений
const generateTempId = () => `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export function useNetworkQueue(): UseNetworkQueueReturn {
  const [pendingQueue, setPendingQueue] = useState<PendingMessage[]>([]);
  const pendingQueueRef = useRef<PendingMessage[]>([]);

  // Keep ref in sync
  pendingQueueRef.current = pendingQueue;

  const addToQueue = useCallback((msg: PendingMessage) => {
    setPendingQueue(prev => [...prev, msg]);
  }, []);

  const updateLocalMessageStatus = useCallback((tempId: string, updates: Partial<PendingMessage>) => {
    setPendingQueue(prev => prev.map(m => m.id === tempId ? { ...m, ...updates } : m));
  }, []);

  const processPendingQueue = useCallback(async () => {
    const queue = pendingQueueRef.current;
    if (queue.length === 0) return;

    console.log(`[NetworkQueue] Processing ${queue.length} pending messages...`);
    const remaining: PendingMessage[] = [];

    for (const msg of queue) {
      try {
        const { error } = await supabase.from("messages").insert({
          sender_id: msg.sender_id,
          receiver_id: msg.receiver_id,
          content: msg.content,
          nonce: msg.nonce,
          type: msg.type || "text",
          status: "sent",
          reply_to_id: msg.reply_to_id || null,
        });

        if (error) throw error;
        console.log(`[NetworkQueue] Pending message sent: ${msg.id}`);
      } catch (err) {
        console.error("[NetworkQueue] Failed to send, will retry:", msg.id, err);
        remaining.push(msg);
      }
    }

    setPendingQueue(remaining);
    console.log(`[NetworkQueue] ${remaining.length} messages still in queue`);
  }, []);

  const getQueueLength = useCallback(() => pendingQueueRef.current.length, []);

  return {
    pendingQueue,
    addToQueue,
    processPendingQueue,
    updateLocalMessageStatus,
    getQueueLength,
  };
}

export { generateTempId };
