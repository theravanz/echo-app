"use client";

import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";

/**
 * Shield Media — единый слой шифрования и сжатия медиа.
 *
 * Поток загрузки:
 *   1. Фронтенд (опционально) сжимает картинку canvas'ом (аватар -> WebP ~Q82).
 *   2. Байты передаются в Rust `media_encrypt` (AES-256-GCM, ключ из E2EE-сида).
 *   3. Зашифрованный конверт заливается в ПРИВАТНЫЙ bucket (публичная ссылка
 *      больше не используется).
 *
 * Поток отображения:
 *   1. `loadSecureMediaUrl(bucket, path, mime)` берёт короткоживущий signed-URL.
 *   2. Скачивает зашифрованные байты, отдаёт в Rust `media_decrypt`.
 *   3. Из расшифрованных байт делает object-URL (blob:) и кэширует.
 *
 * Прямая ссылка на блоб в браузере бесполезна — это AES-GCM шифротекст,
 * расшифровать который умеет только приложение (ключ не покидает Rust).
 */

/** ArrayBuffer -> base64 (без блока на больших файлах, для < ~8 МБ). */
export function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 -> Uint8Array. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function isSecureEnvelope(nonce?: string | null, data?: string | null): boolean {
  return typeof nonce === "string" && typeof data === "string" && nonce.length > 0 && data.length > 0;
}

export interface MediaEnvelope {
  nonce: string;
  data: string;
}

/** Зашифровать произвольный Blob через Rust media_encrypt. */
export async function encryptBlob(blob: Blob): Promise<MediaEnvelope> {
  const buf = await blob.arrayBuffer();
  const plaintextB64 = bytesToBase64(buf);
  const env = await invoke<MediaEnvelope>("media_encrypt", {
    plaintextB64,
  });
  if (!isSecureEnvelope(env.nonce, env.data)) {
    throw new Error("media_encrypt вернул пустой конверт (ключ не загружен?)");
  }
  return env;
}

/** Расшифровать конверт через Rust media_decrypt -> Blob. */
export async function decryptEnvelopeToBlob(
  nonce: string | null | undefined,
  data: string,
  mime = "application/octet-stream",
): Promise<Blob> {
  if (!nonce || !data) throw new Error("Пустой конверт медиа");
  const plaintextB64 = await invoke<string>("media_decrypt", { nonce, data });
  return new Blob([base64ToBytes(plaintextB64) as unknown as BlobPart], { type: mime });
}

/** Доступен ли медиа-ключ (E2EE-сид загружен). */
export async function mediaKeyReady(): Promise<boolean> {
  try {
    return await invoke<boolean>("media_key_status");
  } catch {
    return false;
  }
}

/**
 * Сжать изображение canvas'ом как в Telegram: ресайз под maxSize, WebP ~quality.
 * Легко, без артефактов. Если WebP недоступен — JPEG. Не-картинки не трогаем.
 */
export async function compressImage(
  file: Blob,
  opts: { maxSize?: number; quality?: number; format?: string } = {},
): Promise<Blob> {
  const { maxSize = 1280, quality = 0.82, format = "image/webp" } = opts;
  if (!file.type.startsWith("image/")) return file;

  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    });

    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);

    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), format, quality);
      });
      if (blob) return blob;
      const fallback = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
      });
      return fallback || file;
    } catch {
      return file;
    }
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** Сжатие аватара: меньше 512px не увеличиваем, WebP Q82 (не "говно", но легко). */
export async function compressAvatar(file: Blob): Promise<Blob> {
  return compressImage(file, { maxSize: 512, quality: 0.82, format: "image/webp" });
}

/**
 * Загрузить медиа одним шагом: [сжать] -> зашифровать -> upload в приватный bucket.
 * Возвращает `storage_path` и mime для записи в БД.
 */
export async function uploadShieldedMedia(
  bucket: string,
  path: string,
  file: Blob,
  opts: { compress?: boolean; maxSize?: number } = {},
): Promise<{ storagePath: string; mime: string; nonce?: string }> {
  const byteSource = opts.compress
    ? await compressImage(file, { maxSize: opts.maxSize })
    : file;
  const env = await encryptBlob(byteSource);

  await supabase.storage
    .from(bucket)
    .upload(path, new Blob([base64ToBytes(env.data) as unknown as BlobPart], { type: "application/octet-stream" }), {
      upsert: true,
      contentType: "application/octet-stream",
    });

  return { storagePath: path, mime: byteSource.type || "application/octet-stream", nonce: env.nonce };
}