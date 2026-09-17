"use client";

import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";
import { base64ToBytes, bytesToBase64 } from "@/lib/media";

export interface VoiceMeta {
  path: string;
  nonce: string;
  mime: string;
  duration: number;
  to?: string;
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

  // ── ДИАГНОСТИКА UPLOAD: отпечаток шифротекста до попадания в Storage ──
  console.warn(
    "[VOICE-UP] plain:", plainB64.length,
    "| ct:", ciphertext.length,
    "| nonce:", nonce,
    "| pub:", pubkey.slice(0, 12),
    "| head:", ciphertext.slice(0, 24),
  );

  const path = `${senderId}/voice-${Date.now()}.enc`;
  const { error } = await supabase.storage.from(VOICE_BUCKET).upload(
    path,
    new Blob([base64ToBytes(ciphertext)], { type: "application/octet-stream" }),
    { upsert: true, contentType: "application/octet-stream" },
  );
  if (error) throw error;

  return {
    path,
    nonce,
    mime: blob.type || "audio/webm",
    duration: Math.min(Math.round(durationSec), MAX_VOICE_SECONDS),
    to: receiverId,
  };
}

const voiceUrlCache = new Map<string, Promise<string | null>>();

// ── Диагностика: выполняется ОДИН раз за сессию ──
let diagRan = false;
async function runCryptoDiagnostics(pubkey: string, realCt: string, realNonce: string) {
  if (diagRan) return;
  diagRan = true;
  console.warn("═══ [VOICE-DIAG] старт ═══");
  try {
    // T1: команды шифрования на малой строке
    const rt1 = await invoke<{ ciphertext: string; nonce: string }>("crypto_encrypt", {
      recipientPubkey: pubkey, plaintext: "ROUNDTRIP-TEST",
    });
    const rt1out = await invoke<string>("crypto_decrypt", {
      senderPubkey: pubkey, ciphertext: rt1.ciphertext, nonce: rt1.nonce,
    });
    console.warn("[VOICE-DIAG] T1 малый:", rt1out === "ROUNDTRIP-TEST" ? "OK" : `FAIL: ${rt1out?.slice(0, 30)}`);

    // T2: большой пейлоад через IPC (~264KB, как реальное аудио)
    const big = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=".repeat(6000);
    const t0 = performance.now();
    const rt2 = await invoke<{ ciphertext: string; nonce: string }>("crypto_encrypt", {
      recipientPubkey: pubkey, plaintext: big,
    });
    const rt2out = await invoke<string>("crypto_decrypt", {
      senderPubkey: pubkey, ciphertext: rt2.ciphertext, nonce: rt2.nonce,
    });
    console.warn("[VOICE-DIAG] T2 264KB:",
      rt2out === big ? `OK (${(performance.now() - t0).toFixed(0)}ms)` : `FAIL len ${rt2out?.length}/${big.length}`);

    // T3b: конвертеры на случайных байтах 64KB
    const raw = crypto.getRandomValues(new Uint8Array(65536));
    const back = base64ToBytes(bytesToBase64(raw));
    console.warn("[VOICE-DIAG] T3b конвертеры:",
      back instanceof Uint8Array && back.length === raw.length && back.every((v, i) => v === raw[i])
        ? "OK" : `FAIL type=${(back as any)?.constructor?.name} len=${back.length}`);

    // T3c: конструкция Blob как на upload
    const bt = new Blob([base64ToBytes(bytesToBase64(raw))]);
    const rt = bytesToBase64(new Uint8Array(await bt.arrayBuffer()));
    console.warn("[VOICE-DIAG] T3c blob-roundtrip:",
      rt === bytesToBase64(raw) ? "OK" : "FAIL — Blob строится из мусора");

    // Отпечаток реального пейлоада (сравнить с [VOICE-UP])
    console.warn("[VOICE-DIAG] real payload: ct:", realCt.length, "| nonce:", realNonce, "| head:", realCt.slice(0, 24));
  } catch (e: any) {
    console.warn("[VOICE-DIAG] упал:", e?.message ?? e);
  }
  console.warn("═══ [VOICE-DIAG] конец ═══");
}

/** Расшифровать голосовое и получить blob: URL (с кэшем). */
export function loadVoiceUrl(meta: VoiceMeta, senderId: string): Promise<string | null> {
  const key = `${VOICE_BUCKET}/${meta.path}`;
  const cached = voiceUrlCache.get(key);
  if (cached) return cached;

  const pending = (async (): Promise<string | null> => {
    try {
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
      const buf = await res.arrayBuffer();
      const cipherB64 = bytesToBase64(buf);

      // ── ДИАГНОСТИКА DOWNLOAD: отпечаток скачанного ──
      console.warn(
        "[VOICE-DL] скачано байт:", buf.byteLength,
        "| ct:", cipherB64.length,
        "| nonce:", meta.nonce,
        "| pub:", pubkey.slice(0, 12),
        "| head:", cipherB64.slice(0, 24),
      );

      // Тесты — один раз, строго ДО decrypt
      await runCryptoDiagnostics(pubkey, cipherB64, meta.nonce);

      const plainB64 = await invoke<string>("crypto_decrypt", {
        senderPubkey: pubkey,
        ciphertext: cipherB64,
        nonce: meta.nonce,
      });

      const url = URL.createObjectURL(
        new Blob([base64ToBytes(plainB64)], { type: meta.mime }),
      );
      return url;
    } catch (e: any) {
      console.warn("[VOICE-DL] 4. исключение:", e?.message ?? e);
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