"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  bytesToBase64,
  decryptEnvelopeToBlob,
  isSecureEnvelope,
} from "@/lib/media";

/**
 * aSecureMediaUrl — резолвер защищённого медиа.
 *
 * Берёт зашифрованный конверт из ПРИВАТНОГО bucket (через короткоживущий
 * signed-URL), скачивает байты, расшифровывает в Rust и возвращает object-URL
 * (blob:), который уже можно отдать в `<img>/<audio>/<video>`. Результат
 * кэшируется в памяти на время сессии — повторный показ не качает заново.
 *
 * Возвращает `null`, пока не расшифровано / если данных нет — компоненты
 * используют это как "показать заглушку".
 */

const cache = new Map<string, Promise<string | null>>();

function cacheKey(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

/** Получить (или скачать+расшифровать) блоб-URL для зашифрованного медиа. */
export async function loadSecureMediaUrl(
  bucket: string,
  path: string,
  nonce: string | null | undefined,
  mime = "application/octet-stream",
): Promise<string | null> {
  if (!path || !isSecureEnvelope(nonce, "x")) return null;

  const key = cacheKey(bucket, path);
  const existing = cache.get(key);
  if (existing) return existing;

  const pending = (async (): Promise<string | null> => {
    try {
      const { data: signed } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60);
      if (!signed?.signedUrl) return null;

      const res = await fetch(signed.signedUrl);
      if (!res.ok) return null;

      const encrypted = await encryptForDecrypt(await res.arrayBuffer());
      const blob = await decryptEnvelopeToBlob(nonce, encrypted, mime);
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  })();

  cache.set(key, pending);
  return pending;
}

/** arrayBuffer зашифрованного блоба -> base64 (это поле data конверта). */
async function encryptForDecrypt(buf: ArrayBuffer): Promise<string> {
  return bytesToBase64(buf);
}

/** React-хук: возвращает blob-URL или null. */
export function useSecureMediaUrl(
  bucket: string,
  path: string | null | undefined,
  nonce: string | null | undefined,
  mime = "application/octet-stream",
  enabled = true,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !path || !nonce) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    loadSecureMediaUrl(bucket, path, nonce, mime).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
    // mime/не-enable-флаги менять на лету не будем
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, path, nonce, enabled]);

  return url;
}