"use client";

import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";

/**
 * E2EE (Phase 0): приватный ключ живёт ТОЛЬКО в Rust `KeyStore`
 * (`Zeroizing<[u8; 32]>`) и никогда не попадает в JS / localStorage / SQLite.
 * Этот хук — тонкий прокси к IPC-командам Rust:
 *   - encrypt/decrypt → crypto_encrypt / crypto_decrypt
 *   - публичные ключи собеседников → кэш + profiles
 * Никаких приватных ключей в thisRef / базе больше нет.
 */

export const useE2EE = (chats: any[]) => {
  const publicKeyCacheRef = useRef<Map<string, string>>(new Map());
  // Promise-защита: ключ загружается асинхронно (crypto_restore_key). Все
  // обращения к decrypt ждут один общий promise, чтобы не падать на гонке.
  const keyReadyRef = useRef<Promise<boolean> | null>(null);

  // Возвращает true, если E2EE-ключ реально загружен в Rust KeyStore.
  // Если восстановить не удалось (No stored key / HWID_CHANGED / ошибка) —
  // возвращает false, чтобы call-site НЕ звал crypto_decrypt/encrypt без ключа.
  const ensureKeyReady = useCallback(async (userId: string): Promise<boolean> => {
    if (!keyReadyRef.current) {
      keyReadyRef.current = (async (): Promise<boolean> => {
        try {
          const ok = await invoke<boolean>("crypto_status");
          if (ok) return true; // ключ уже в KeyStore
          // Ключ пуст → пробуем восстановить device-bound из локальной БД.
          try {
            // Свой id: переданный userId может быть собеседником, а restore
            // нужен local user. Берём из активной Supabase-сессии.
            const {
              data: { session },
            } = await supabase.auth.getSession();
            const restoreId = session?.user?.id || userId;
            await invoke("crypto_restore_key", { userId: restoreId });
          } catch (restoreErr: any) {
            const msg = String(restoreErr?.message || restoreErr);
            // Любая неудача restore → ключ недоступен; решим это на уровне
            // app/page.tsx (recovery через мнемонику), здесь не падаем.
            console.warn("[E2EE] restore unavailable:", msg);
            return false;
          }
          // После restore проверяем, что ключ действительно появился,
          // а не только что команда не бросила исключение.
          try {
            const ready = await invoke<boolean>("crypto_status");
            return ready;
          } catch {
            return false;
          }
        } catch (e) {
          // не-Tauri / не готово — не блокируем поток
          return false;
        }
      })().then((ready) => {
        if (!ready) {
          // Ключ реально недоступен (не войдено / нет restore / HWID сменился).
          // Сбрасываем кэш: после логина/derive ключ появится, и следующий
          // вызов перепроверит crypto_status вместо того чтобы вечно возвращать false.
          keyReadyRef.current = null;
        }
        return ready;
      }).catch(() => {
        keyReadyRef.current = null; // дать шанс на следующий вызов
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
      } catch (e) {
        return null;
      }
    },
    [chats]
  );

  const encryptMessage = useCallback(
    async (text: string, recipientId: string) => {
      try {
        const keyOk = await ensureKeyReady(recipientId);
        if (!keyOk) {
          // Ключ не загружен (нет restore / не готов) — НЕ дёргаем IPC.
          console.warn("[E2EE] encrypt skipped: key not loaded");
          return null;
        }
        const recipientPublicKeyBase64 =
          await getPublicKeyWithFallback(recipientId);
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
    [getPublicKeyWithFallback, ensureKeyReady]
  );

  const decryptMessage = useCallback(
    async (encryptedBase64: string, nonceBase64: string, otherPartyId: string) => {
      try {
        // Убедиться, что E2EE-ключ загружен (restore при старте, если нужно)
        const keyOk = await ensureKeyReady(otherPartyId);
        if (!keyOk) {
          // Ключ не загружен — не дёргаем crypto_decrypt, чтобы не падать
          // с "[KeyStore] E2EE key not loaded". Вернём честный "[Key Error]".
          console.warn("[E2EE] decrypt skipped: key not loaded");
          return "[Key Error]";
        }
        const senderPublicKeyBase64 =
          await getPublicKeyWithFallback(otherPartyId);
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
    [getPublicKeyWithFallback, ensureKeyReady]
  );

  return { encryptMessage, decryptMessage, getPublicKeyWithFallback };
};