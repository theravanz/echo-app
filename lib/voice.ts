"use client";

import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";
import { base64ToBytes, bytesToBase64 } from "@/lib/media";

/**
 * Голосовые сообщения (E2EE + Shield-хранение).
 *
 * Формат сообщения:
 *   type: "voice"
 *   content = JSON { path, nonce, mime, duration }
 *     - path   — путь в ПРИВАТНОМ bucket'е `voice` (<sender>/voice-<ts>.enc)
 *     - nonce  — base64 nonce crypto_box (XSalsa20-Poly1305)
 *     - mime   — тип записи (audio/webm | audio/mp4)
 *     - duration — длительность в секундах
 *
 * Шифрование: аудио → base64 → crypto_box на ПУБЛИЧНЫЙ ключ получателя
 * (то же E2EE, что у текстовых сообщений). Благодаря симметрии DH
 * отправитель тоже может расшифровать свои сообщения. Сервер видит
 * только шифротекст в приватном bucket'е.
 */

export interface VoiceMeta {
  path: string;
  nonce: string;
  mime: string;
  duration: number;
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
      };
    }
  } catch { /* ignore */ }
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

  const plainB64 = bytesToBase64(await blob.arrayBuffer());
  const { ciphertext, nonce } = await invoke<{ ciphertext: string; nonce: string }>(
    "crypto_encrypt",
    { recipientPubkey: pubkey, plaintext: plainB64 },
  );

  const path = `${senderId}/voice-${Date.now()}.enc`;
  const { error } = await supabase.storage.from(VOICE_BUCKET).upload(
    path,
    new Blob([base64ToBytes(ciphertext) as unknown as BlobPart], { type: "application/octet-stream" }),
    { upsert: true, contentType: "application/octet-stream" },
  );
  if (error) throw error;

  return {
    path,
    nonce,
    mime: blob.type || "audio/webm",
    duration: Math.min(Math.round(durationSec), MAX_VOICE_SECONDS),
  };
}

const voiceUrlCache = new Map<string, Promise<string | null>>();

/** Расшифровать голосовое и получить blob: URL (с кэшем). */
export function loadVoiceUrl(meta: VoiceMeta, senderId: string): Promise<string | null> {
  const key = `${VOICE_BUCKET}/${meta.path}`;
  const cached = voiceUrlCache.get(key);
  if (cached) return cached;

  const pending = (async (): Promise<string | null> => {
    try {
      const pubkey = await getPublicKey(senderId);
      if (!pubkey) return null;

      const { data: signed } = await supabase.storage
        .from(VOICE_BUCKET)
        .createSignedUrl(meta.path, 60 * 60);
      if (!signed?.signedUrl) return null;

      const res = await fetch(signed.signedUrl);
      if (!res.ok) return null;
      const cipherB64 = bytesToBase64(await res.arrayBuffer());

      const plainB64 = await invoke<string>("crypto_decrypt", {
        senderPubkey: pubkey,
        ciphertext: cipherB64,
        nonce: meta.nonce,
      });

      const url = URL.createObjectURL(
        new Blob([base64ToBytes(plainB64) as unknown as BlobPart], { type: meta.mime }),
      );
      return url;
    } catch {
      return null;
    }
  })();

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