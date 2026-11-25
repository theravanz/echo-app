"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  base64ToBytes,
  bytesToBase64,
  decryptEnvelopeToBlob,
  isSecureEnvelope,
} from "@/lib/media";
import { cacheGetBounded, cacheSetBounded } from "./chat-cache";

/**
 * aSecureMediaUrl — резолвер защищённого медиа.
 *
 * Берёт зашифрованный конверт из ПРИВАТНОГО bucket (через короткоживущий
 * signed-URL), скачивает байты, расшифровывает в Rust и возвращает object-URL
 * (blob:), который уже можно отдать в `<img>/<audio>/<video>`. Результат
 * кэшируется в памяти на время сессии, а аватарки — ещё и в SQLCipher
 * (переживают перезапуск и открываются офлайн).
 *
 * Возвращает `null`, пока не расшифровано / если данных нет — компоненты
 * используют это как "показать заглушку".
 */

const cache = new Map<string, Promise<string | null>>();
const resolvedCache = new Map<string, string>();
const signedResolvedCache = new Map<string, string>();

function cacheKey(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

// ═══════════════════════════════════════════════════════════════════
// Персистентный кэш медиа (аватарок) в SQLCipher.
//
// Signed-URL живёт час и офлайн недоступен, поэтому после первой
// расшифровки/скачивания сохраняем САМИ БАЙТЫ. Тогда аватарка:
//   • больше не запрашивается при каждом маунте/перезапуске;
//   • открывается без интернета;
//   • не плодит createSignedUrl + fetch на каждый рендер списка.
// Ограничиваемся bucket'ом avatars и небольшим размером, чтобы не
// раздувать secure_store большими картинками/видео.
// ═══════════════════════════════════════════════════════════════════

const PERSIST_BUCKETS = new Set(["avatars"]);
const PERSIST_MAX_BYTES = 512 * 1024;
const PERSIST_PREFIX = "echo_media_blob_v1:";

type PersistedMedia = { mime: string; data: string };

function canPersist(bucket: string, size: number): boolean {
  return PERSIST_BUCKETS.has(bucket) && size > 0 && size <= PERSIST_MAX_BYTES;
}

async function readPersistedMedia(bucket: string, path: string): Promise<string | null> {
  if (!PERSIST_BUCKETS.has(bucket)) return null;
  try {
    const raw = await cacheGetBounded(`${PERSIST_PREFIX}${cacheKey(bucket, path)}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedMedia;
    if (!parsed?.data || !parsed?.mime) return null;
    const bytes = base64ToBytes(parsed.data);
    return URL.createObjectURL(
      new Blob([bytes as unknown as BlobPart], { type: parsed.mime }),
    );
  } catch {
    return null;
  }
}

async function persistMediaBlob(bucket: string, path: string, blob: Blob): Promise<void> {
  if (!canPersist(bucket, blob.size)) return;
  try {
    const buf = await blob.arrayBuffer();
    const data = bytesToBase64(buf);
    await cacheSetBounded(
      `${PERSIST_PREFIX}${cacheKey(bucket, path)}`,
      JSON.stringify({ mime: blob.type || "application/octet-stream", data }),
    );
  } catch (e) {
    console.warn("[MEDIA-CACHE] persist avatar failed:", e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Батчинг signed-URL.
//
// Раньше каждая аватарка в списке/группе дергала createSignedUrl —
// на большой чат это сотни запросов подряд. Supabase умеет отдавать
// signed-URL пачкой (createSignedUrls), поэтому собираем запросы за
// короткое окно и отправляем одним вызовом на bucket.
// ═══════════════════════════════════════════════════════════════════

const SIGNED_BATCH_DELAY_MS = 40;
const SIGNED_BATCH_CHUNK = 100;

interface SignedBatch {
  paths: string[];
  waiters: Map<string, Array<(url: string | null) => void>>;
  timer: ReturnType<typeof setTimeout> | null;
}

const signedBatches = new Map<string, SignedBatch>();

function requestSignedUrl(bucket: string, path: string): Promise<string | null> {
  // Офлайн: не собираем батч, который всё равно упадёт. Компонент
  // перезапросит URL при следующем маунте/возврате сети.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return Promise.resolve(null);
  }

  let batch = signedBatches.get(bucket);
  if (!batch) {
    batch = { paths: [], waiters: new Map(), timer: null };
    signedBatches.set(bucket, batch);
  }

  const promise = new Promise<string | null>((resolve) => {
    const list = batch!.waiters.get(path);
    if (list) list.push(resolve);
    else batch!.waiters.set(path, [resolve]);
    if (!batch!.paths.includes(path)) batch!.paths.push(path);
  });

  if (!batch.timer) {
    batch.timer = setTimeout(() => {
      void flushSignedBatch(bucket);
    }, SIGNED_BATCH_DELAY_MS);
  }
  return promise;
}

async function flushSignedBatch(bucket: string): Promise<void> {
  const batch = signedBatches.get(bucket);
  if (!batch) return;
  signedBatches.delete(bucket);

  const paths = batch.paths;
  const urls = new Map<string, string | null>();

  for (let i = 0; i < paths.length; i += SIGNED_BATCH_CHUNK) {
    const chunk = paths.slice(i, i + SIGNED_BATCH_CHUNK);
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls(chunk, 60 * 60);
      if (!error && data) {
        for (const item of data as Array<{ path?: string; signedUrl?: string | null }>) {
          if (item?.path) urls.set(item.path, item.signedUrl ?? null);
        }
      }
    } catch {
      /* офлайн — все получат null и попробуют позже */
    }
  }

  for (const path of paths) {
    const list = batch.waiters.get(path) ?? [];
    const url = urls.get(path) ?? null;
    for (const resolve of list) resolve(url);
  }
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
  const resolved = resolvedCache.get(key);
  if (resolved) return resolved;

  const existing = cache.get(key);
  if (existing) return existing;

  const pending: Promise<string | null> = (async (): Promise<string | null> => {
    // 1. Офлайн-кэш: аватар уже расшифровывали ранее.
    const persisted = await readPersistedMedia(bucket, path);
    if (persisted) {
      resolvedCache.set(key, persisted);
      return persisted;
    }

    // 2. Сеть: signed-URL (батчем) → байты → расшифровка в Rust.
    try {
      const signedUrl = await requestSignedUrl(bucket, path);
      if (!signedUrl) return null;

      const res = await fetch(signedUrl);
      if (!res.ok) return null;

      const encrypted = await encryptForDecrypt(await res.arrayBuffer());
      const blob = await decryptEnvelopeToBlob(nonce, encrypted, mime);
      const url = URL.createObjectURL(blob);
      resolvedCache.set(key, url);
      void persistMediaBlob(bucket, path, blob);
      return url;
    } catch {
      return null;
    }
  })();

  cache.set(key, pending);
  void pending.then((url) => {
    // Неуспех НЕ кэшируем: иначе аватар останется пустым до перезапуска
    // (в т.ч. после возврата сети). Следующий маунт попробует снова.
    if (!url && cache.get(key) === pending) cache.delete(key);
  });
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
  const resolved = signedResolvedCache.get(key);
  if (resolved) return resolved;

  const existing = signedCache.get(key);
  if (existing) return existing;

  const pending: Promise<string | null> = (async (): Promise<string | null> => {
    // Офлайн-кэш: legacy-аватар уже скачивали ранее.
    const persisted = await readPersistedMedia(bucket, path);
    if (persisted) {
      signedResolvedCache.set(key, persisted);
      return persisted;
    }

    try {
      const signedUrl = await requestSignedUrl(bucket, path);
      if (!signedUrl) return null;

      // Аватарки сохраняем байтами, чтобы потом открывались без сети.
      if (PERSIST_BUCKETS.has(bucket)) {
        try {
          const res = await fetch(signedUrl);
          if (res.ok) {
            const blob = await res.blob();
            if (canPersist(bucket, blob.size)) {
              const objectUrl = URL.createObjectURL(blob);
              signedResolvedCache.set(key, objectUrl);
              void persistMediaBlob(bucket, path, blob);
              return objectUrl;
            }
          }
        } catch {
          /* не смогли скачать — отдадим signed-URL ниже */
        }
      }

      return signedUrl;
    } catch {
      return signedResolvedCache.get(key) ?? null;
    }
  })();

  signedCache.set(key, pending);
  void pending.then((resolvedUrl) => {
    if (!resolvedUrl && signedCache.get(key) === pending) signedCache.delete(key);
  });
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