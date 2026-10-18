"use client";

import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";

// Вспомогательные функции для симметричного шифрования групп (AES-GCM)
async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const rawKey = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptGroupMessage(text: string, msgKeyB64: string) {
  const key = await importAesKey(msgKeyB64);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  return {
    content: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    nonce: btoa(String.fromCharCode(...iv)),
  };
}

async function decryptGroupMessage(ciphertextB64: string, nonceB64: string, msgKeyB64: string): Promise<string> {
  try {
    const key = await importAesKey(msgKeyB64);
    const ciphertext = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(nonceB64), (c) => c.charCodeAt(0));
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error("Group decryption error:", e);
    return "[E2EE Group Key Error]";
  }
}

export const useE2EE = (chats: any[]) => {
  const publicKeyCacheRef = useRef<Map<string, string>>(new Map());
  const keyReadyRef = useRef<Promise<boolean> | null>(null);

  const ensureKeyReady = useCallback(async (userId: string): Promise<boolean> => {
    if (!keyReadyRef.current) {
      keyReadyRef.current = (async (): Promise<boolean> => {
        try {
          const ok = await invoke<boolean>("crypto_status");
          if (ok) return true;
          try {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            const restoreId = session?.user?.id || userId;
            await invoke("crypto_restore_key", { userId: restoreId });
          } catch (restoreErr: any) {
            console.warn("[E2EE] restore unavailable:", String(restoreErr?.message || restoreErr));
            return false;
          }
          try {
            return await invoke<boolean>("crypto_status");
          } catch {
            return false;
          }
        } catch {
          return false;
        }
      })().then((ready) => {
        if (!ready) keyReadyRef.current = null;
        return ready;
      }).catch(() => {
        keyReadyRef.current = null;
        return false;
      });
    }
    return keyReadyRef.current;
  }, []);

  const getPublicKeyWithFallback = useCallback(
    async (userId: string): Promise<string | null> => {
      if (publicKeyCacheRef.current.has(userId)) {
        return publicKeyCacheRef.current.get(userId) || null;
      }

      const chatFromList = chats.find((c) => c.id === userId);
      if (chatFromList?.public_key) {
        publicKeyCacheRef.current.set(userId, chatFromList.public_key);
        return chatFromList.public_key;
      }

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("public_key")
          .eq("id", userId)
          .maybeSingle();

        if (error) throw error;
        if (data?.public_key) {
          publicKeyCacheRef.current.set(userId, data.public_key);
        }
        return data?.public_key ?? null;
      } catch {
        return null;
      }
    },
    [chats]
  );

  const encryptMessage = useCallback(
    async (text: string, recipientId: string) => {
      try {
        const chat = chats.find((c) => c.id === recipientId);
        // Если это групповой чат — шифруем симметрично через msg_key_0
        if (chat?.type === 'group') {
          if (!chat.msg_key_0) {
            console.warn("[E2EE] group msg_key_0 missing");
            return null;
          }
          return await encryptGroupMessage(text, chat.msg_key_0);
        }

        // Стандартный DM пайплайн (1-на-1)
        const keyOk = await ensureKeyReady(recipientId);
        if (!keyOk) {
          console.warn("[E2EE] encrypt skipped: key not loaded");
          return null;
        }
        const recipientPublicKeyBase64 = await getPublicKeyWithFallback(recipientId);
        if (!recipientPublicKeyBase64) return null;

        const { ciphertext, nonce } = await invoke<{
          ciphertext: string;
          nonce: string;
        }>("crypto_encrypt", {
          recipientPubkey: recipientPublicKeyBase64,
          plaintext: text,
        });

        return { content: ciphertext, nonce };
      } catch (err) {
        console.error("Encryption error:", err);
        return null;
      }
    },
    [chats, getPublicKeyWithFallback, ensureKeyReady]
  );

  const decryptMessage = useCallback(
    async (encryptedBase64: string, nonceBase64: string, otherPartyId: string, chatId?: string) => {
      try {
        const targetId = chatId || otherPartyId;
        const chat = chats.find((c) => c.id === targetId);

        // Если это групповой чат — расшифровываем через msg_key_0 группы
        if (chat?.type === 'group') {
          if (!chat.msg_key_0) return "[Key Error]";
          return await decryptGroupMessage(encryptedBase64, nonceBase64, chat.msg_key_0);
        }

        // Стандартный DM пайплайн (1-на-1)
        const keyOk = await ensureKeyReady(otherPartyId);
        if (!keyOk) {
          console.warn("[E2EE] decrypt skipped: key not loaded");
          return "[Key Error]";
        }
        const senderPublicKeyBase64 = await getPublicKeyWithFallback(otherPartyId);
        if (!senderPublicKeyBase64 || !nonceBase64) return "[E2EE Data Error]";

        return await invoke<string>("crypto_decrypt", {
          senderPubkey: senderPublicKeyBase64,
          ciphertext: encryptedBase64,
          nonce: nonceBase64,
        });
      } catch (err) {
        console.error("Decryption exception:", err);
        return "[Key Error]";
      }
    },
    [chats, getPublicKeyWithFallback, ensureKeyReady]
  );

  return { encryptMessage, decryptMessage, getPublicKeyWithFallback };
};