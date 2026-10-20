"use client";

import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";
import { base64ToBytes, bytesToBase64 } from "@/lib/media";
import { decryptBytes, encryptBytes, MEDIA_VERSION_RAW } from "@/lib/crypto";

/** Диагностические логи (размеры пейлоада) — только на время отладки. */
const DEBUG = false;
const dbg = (...args: unknown[]) => {
  if (DEBUG) console.log("[VOICE]", ...args);
};

export interface VoiceMeta {
  path: string;
  nonce: string;
  mime: string;
  duration: number;
  to?: string;
  /**
   * Формат хранения. 2 = plaintext это СЫРЫЕ байты медиа (NaCL box через
   * raw-bytes IPC / json-вариант на Android). Отсутствует у старых сообщений
   * (plaintext был base64-строкой) — они читаются legacy-командой crypto_decrypt.
   */
  v?: number;
}

export const VOICE_BUCKET = "voice";
const MAX_VOICE_SECONDS = 300;

export function parseVoiceMeta(content: unknown): VoiceMeta | null {
  if (typeof content !== "string" || !content.startsWith("{")) return null;
  try {
    const raw = JSON.parse(content);
    if (raw && typeof raw.path === "string" && typeof raw.nonce === "string") {
      return {
        path: raw.path,
        nonce: raw.nonce,
        mime: typeof raw.mime === "string" ? raw.mime : "audio/webm",
        duration: Number(raw.duration) || 0,
        to: typeof raw.to === "string" ? raw.to : undefined,
        v: typeof raw.v === "number" && Number.isFinite(raw.v) ? raw.v : undefined,
      };
    }
  } catch (e) {
    console.error("[CRYPTO-BYTES] [VOICE] parseVoiceMeta: content не JSON:", e);
  }
  return null;
}

async function getPublicKey(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("public_key")
      .eq("id", userId)
      .maybeSingle();
    return data?.public_key ?? null;
  } catch {
    return null;
  }
}

/** Зашифровать и загрузить голосовое. Возвращает метаданные для content. */
export async function encryptAndUploadVoice(
  senderId: string,
  receiverId: string,
  blob: Blob,
  durationSec: number,
): Promise<VoiceMeta> {
  const pubkey = await getPublicKey(receiverId);
  if (!pubkey) throw new Error("Публичный ключ получателя не найден");

  // v:2 — шифруем СЫРЫЕ байты аудио (base64-обёртка убрана).
  const plain = new Uint8Array(await blob.arrayBuffer());
  const { cipher, nonce } = await encryptBytes(pubkey, plain);
  dbg("upload: plain", plain.length, "→ cipher", cipher.length);

  const path = `${senderId}/voice-${Date.now()}.enc`;
  const { error } = await supabase.storage.from(VOICE_BUCKET).upload(
    path,
    new Blob([cipher], { type: "application/octet-stream" }),
    { upsert: true, contentType: "application/octet-stream" },
  );
  if (error) throw error;

  return {
    path,
    nonce,
    mime: blob.type || "audio/webm",
    duration: Math.min(Math.round(durationSec), MAX_VOICE_SECONDS),
    to: receiverId,
    v: MEDIA_VERSION_RAW,
  };
}

const voiceUrlCache = new Map<string, Promise<string | null>>();

// ═══════════════════════════════════════════════════════════════════
// Payload-разделение: шифруем ЛОКАЛЬНО (офлайн-ок, IPC), заливаем ПОТОМ.
// Нужно для оптимистичной отправки: пузырь появляется сразу, а сеть
// (upload + insert) уходит в фон/очередь.
// ═══════════════════════════════════════════════════════════════════

export interface VoicePayload {
  cipher: Uint8Array;
  nonce: string;
  mime: string;
  duration: number;
  /** Планируемый путь в бакете — детерминирован локально, без сети. */
  remotePath: string;
}

/**
 * Зашифровать голосовое локально. `pubkeyOverride` — ключ из локального
 * кэша чатов (chats.public_key), чтобы работать офлайн без сетевого
 * запроса профиля.
 */
export async function encryptVoicePayload(
  senderId: string,
  receiverId: string,
  blob: Blob,
  durationSec: number,
  pubkeyOverride?: string | null,
): Promise<VoicePayload> {
  const pubkey = pubkeyOverride || (await getPublicKey(receiverId));
  if (!pubkey) throw new Error("Публичный ключ получателя не найден");

  const plain = new Uint8Array(await blob.arrayBuffer());
  const { cipher, nonce } = await encryptBytes(pubkey, plain);
  dbg("payload: plain", plain.length, "→ cipher", cipher.length);

  return {
    cipher,
    nonce,
    mime: blob.type || "audio/webm",
    duration: Math.min(Math.round(durationSec), MAX_VOICE_SECONDS),
    remotePath: `${senderId}/voice-${Date.now()}.enc`,
  };
}

/** Метаданные для колонки content (plaintext JSON, не секрет). */
export function buildVoiceMeta(payload: VoicePayload, receiverId: string): VoiceMeta {
  return {
    path: payload.remotePath,
    nonce: payload.nonce,
    mime: payload.mime,
    duration: payload.duration,
    to: receiverId,
    v: MEDIA_VERSION_RAW,
  };
}

/** Загрузить готовый шифротекст (путь досылки очереди). */
export async function uploadVoiceCipher(cipher: Uint8Array, remotePath: string): Promise<void> {
  const { error } = await supabase.storage
    .from(VOICE_BUCKET)
    .upload(remotePath, new Blob([cipher as unknown as BlobPart], { type: "application/octet-stream" }), {
      upsert: true,
      contentType: "application/octet-stream",
    });
  if (error) throw error;
}

/** Расшифровать голосовое и получить blob: URL (с кэшем). */
export function loadVoiceUrl(meta: VoiceMeta, senderId: string, groupKeyB64?: string | null): Promise<string | null> {
  const key = `${VOICE_BUCKET}/${meta.path}`;
  const cached = voiceUrlCache.get(key);
  if (cached) return cached;

  const pending = (async (): Promise<string | null> => {
    try {
      // Групповое голосовое (v=3, AES-GCM через msg_key_0) — раньше DH-ветки.
      if ((meta as any)?.v === 3 || (meta as any)?.enc === 'group') {
        if (!groupKeyB64) { console.warn("[VOICE-DL] group voice без ключа"); return null; }
        const { decryptGroupBytes } = await import("@/lib/group-media");
        const { data: signed, error: signErr } = await supabase.storage
          .from(VOICE_BUCKET)
          .createSignedUrl(meta.path, 60 * 60);
        if (signErr || !signed?.signedUrl) { console.warn("[VOICE-DL] group signedUrl:", signErr?.message); return null; }
        const res = await fetch(signed.signedUrl);
        if (!res.ok) { console.warn("[VOICE-DL] group fetch:", res.status); return null; }
        const buf = new Uint8Array(await res.arrayBuffer());
        const plain = await decryptGroupBytes(buf, meta.nonce, groupKeyB64);
        return URL.createObjectURL(new Blob([plain as unknown as BlobPart], { type: meta.mime }));
      }

      const pubkey = await getPublicKey(senderId);
      if (!pubkey) { console.warn("[VOICE-DL] 1. нет public_key у", senderId); return null; }

      const { data: signed, error: signErr } = await supabase.storage
        .from(VOICE_BUCKET)
        .createSignedUrl(meta.path, 60 * 60);
      if (signErr) { console.warn("[VOICE-DL] 2. createSignedUrl:", signErr.message); return null; }
      if (!signed?.signedUrl) { console.warn("[VOICE-DL] 2. signedUrl пуст"); return null; }

      const res = await fetch(signed.signedUrl);
      if (!res.ok) {
        console.warn("[VOICE-DL] 3. fetch:", res.status, await res.text().catch(() => ""));
        return null;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      dbg("download: cipher", buf.length, "| v", meta.v, "| mime", meta.mime);

      // v:2 → СЫРЫЕ байты (raw-bytes IPC / json-вариант на Android).
      // Иначе — legacy-медиа: plaintext был base64-строкой.
      const plain = meta.v === MEDIA_VERSION_RAW
        ? await decryptBytes(pubkey, meta.nonce, buf)
        : base64ToBytes(await invoke<string>("crypto_decrypt", {
            senderPubkey: pubkey,
            ciphertext: bytesToBase64(buf),
            nonce: meta.nonce,
          }));

      const url = URL.createObjectURL(
        new Blob([plain], { type: meta.mime }),
      );
      return url;
    } catch (e: any) {
      // Контракт UI: null = «показать заглушку», но ошибку НЕ глотаем —
      // логируем, иначе класс багов конвертации снова станет невидимым.
      console.error("[CRYPTO-BYTES] [VOICE-DL] decrypt failed (v:", meta.v, "):", e);
      return null;
    }
  })();

  // Кэшируем только успехи
  pending.then((u) => { if (!u) voiceUrlCache.delete(key); });
  voiceUrlCache.set(key, pending);
  return pending;
}

/** Лучший поддерживаемый mime для MediaRecorder. */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export { MAX_VOICE_SECONDS };