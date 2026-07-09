"use client";

import { useCallback, useRef, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { savePrivateKey, loadPrivateKey, deletePrivateKey } from '@/lib/db';
import nacl from 'tweetnacl';
// @ts-ignore
import { decodeUTF8, encodeUTF8, decodeBase64, encodeBase64 } from 'tweetnacl-util';

/**
 * Безопасное хранилище ключей через Tauri vault (AES-256-GCM).
 * Ключ хранится зашифрованным в SQLite, расшифровывается только в памяти Rust.
 * localStorage НЕ ИСПОЛЬЗУЕТСЯ для private key более.
 */

export const useE2EE = (chats: any[]) => {
  const publicKeyCacheRef = useRef<Map<string, string>>(new Map());
  const privateKeyRef = useRef<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Загружаем private key при монтировании
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = await loadPrivateKey();
      if (!cancelled) {
        privateKeyRef.current = key;
        setIsReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const getPublicKeyWithFallback = useCallback(async (userId: string) => {
    if (publicKeyCacheRef.current.has(userId)) {
      return publicKeyCacheRef.current.get(userId);
    }

    const chatFromList = chats.find(c => c.id === userId);
    if (chatFromList?.public_key) {
      publicKeyCacheRef.current.set(userId, chatFromList.public_key);
      return chatFromList.public_key;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('public_key')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      if (data?.public_key) {
        publicKeyCacheRef.current.set(userId, data.public_key);
      }

      return data?.public_key;
    } catch (e) {
      return null;
    }
  }, [chats]);

  const encryptMessage = useCallback(async (text: string, recipientId: string) => {
    try {
      const privateKeyBase64 = privateKeyRef.current;
      const recipientPublicKeyBase64 = await getPublicKeyWithFallback(recipientId);

      if (!privateKeyBase64 || !recipientPublicKeyBase64) return null;

      const privateKey = decodeBase64(privateKeyBase64);
      const publicKey = decodeBase64(recipientPublicKeyBase64);

      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const messageUint8 = decodeUTF8(text);

      const encrypted = nacl.box(messageUint8, nonce, publicKey, privateKey);

      return {
        content: encodeBase64(encrypted),
        nonce: encodeBase64(nonce)
      };
    } catch (err) {
      console.error('Encryption error:', err);
      return null;
    }
  }, [getPublicKeyWithFallback]);

  const decryptMessage = useCallback(async (encryptedBase64: string, nonceBase64: string, otherPartyId: string) => {
    try {
      const privateKeyBase64 = privateKeyRef.current;
      const otherPartyPublicKeyBase64 = await getPublicKeyWithFallback(otherPartyId);

      if (!privateKeyBase64 || !otherPartyPublicKeyBase64 || !nonceBase64) return '[E2EE Data Error]';

      const privateKey = decodeBase64(privateKeyBase64);
      const publicKey = decodeBase64(otherPartyPublicKeyBase64);

      const nonce = decodeBase64(nonceBase64);
      const encrypted = decodeBase64(encryptedBase64);

      const decrypted = nacl.box.open(encrypted, nonce, publicKey, privateKey);

      if (!decrypted) return '[Decryption Failed]';
      return encodeUTF8(decrypted);
    } catch (err) {
      console.error('Decryption exception:', err);
      return '[Key Error]';
    }
  }, [getPublicKeyWithFallback]);

  /**
   * Сохранить приватный ключ в защищённое хранилище.
   * Вызывается после генерации seed на фронтенде.
   */
  const savePrivateKeySecurely = useCallback(async (keyBase64: string) => {
    privateKeyRef.current = keyBase64;
    await savePrivateKey(keyBase64);
  }, []);

  /**
   * Удалить приватный ключ из хранилища.
   * Вызывается при logout / purge.
   */
  const clearPrivateKey = useCallback(async () => {
    privateKeyRef.current = null;
    await deletePrivateKey();
  }, []);

  return { encryptMessage, decryptMessage, getPublicKeyWithFallback, savePrivateKey: savePrivateKeySecurely, clearPrivateKey, isReady };
};