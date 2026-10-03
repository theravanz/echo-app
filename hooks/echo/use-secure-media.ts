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

/**
 * Извлечь storage-путь из ПУБЛИЧНОГО URL Supabase Storage
 * (`.../storage/v1/object/public/<bucket>/<path>`).
 *
 * Нужно для LEGACY-медиа: до перехода на шифрование в БД сохранялись прямые
 * публичные ссылки. После того как bucket'ы стали приватными (0007), такие
 * ссылки отдают 400. Но объект в бакете остался — мы достаём путь и открываем
 * его через короткоживущий signed-URL (для незашифрованных legacy-файлов).
 *
 * Возвращает `null`, если URL не относится к этому bucket'у (внешняя ссылка
 * или другой бакет) — тогда вызывающий код использует `src` как есть.
 */
export function publicUrlToStoragePath(bucket: string, url?: string | null): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const raw = url.slice(idx + marker.length).split("?")[0].split("#")[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
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

/**
 * Signed-URL для LEGACY-объекта по его публичной ссылке.
 *
 * Возвращает:
 *   • сам URL, если он уже signed (`/object/sign/...` или содержит `token=`);
 *   • короткоживущий signed-URL, если `url` — публичная ссылка на приватный
 *     bucket (путь извлекается из URL);
 *   • `null`, если URL внешний / не из этого bucket'а → вызывающий использует
 *     `src` напрямую.
 */
const signedCache = new Map<string, Promise<string | null>>();

export async function loadSignedStorageUrl(
  bucket: string,
  url?: string | null,
): Promise<string | null> {
  if (!url) return null;
  if (url.includes("/storage/v1/object/sign/") || url.includes("token=")) return url;

  const path = publicUrlToStoragePath(bucket, url);
  if (!path) return null;

  const key = cacheKey(bucket, path);
  const existing = signedCache.get(key);
  if (existing) return existing;

  const pending = (async (): Promise<string | null> => {
    try {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  })();

  signedCache.set(key, pending);
  return pending;
}

/** React-хук: signed-URL для legacy публичной ссылки или null. */
export function useSignedStorageUrl(
  bucket: string,
  url: string | null | undefined,
  enabled = true,
): string | null {
  const [signed, setSigned] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !url) {
      setSigned(null);
      return;
    }
    // Если URL уже походит на внешний — не нужно ничего резолвить.
    let cancelled = false;
    loadSignedStorageUrl(bucket, url).then((u) => {
      if (!cancelled) setSigned(u);
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, url, enabled]);

  return signed;
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