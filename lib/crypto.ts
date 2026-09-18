"use client";

/**
 * v:2 E2EE-транспорт медиа (голосовые/файлы): NaCL box над СЫРЫМИ байтами.
 *
 * Формат хранения v:2: plaintext = сырые байты медиа (НЕ base64-строка), т.е.
 * в Storage лежит ровно ciphertext = plaintext + 16B Poly1305-тег.
 *
 * Транспорт IPC выбирается по платформе (детерминированно, не фолбэком):
 *   • desktop/iOS — raw IPC: аргумент Uint8Array, ответ ArrayBuffer.
 *     Тело запроса `crypto_encrypt_bytes` = [32B recipient_pubkey][plaintext]
 *     Тело ответа                         = [24B nonce][ciphertext]
 *     Тело запроса `crypto_decrypt_bytes` = [32B sender_pubkey][24B nonce][ct]
 *     Тело ответа                         = plaintext (сырые байты)
 *   • Android — tauri всегда отдаёт InvokeBody::Json (raw-тело запроса там
 *     невозможно), поэтому идут json-команды с base64: `*_bytes_json`.
 *     Криптология в Rust общая (encrypt_inner/decrypt_inner) → шифротекст
 *     v:2 идентичен на всех платформах.
 *
 * Здесь НЕТ проглатывания ошибок: любая проблема логируется с префиксом
 * [CRYPTO-BYTES] и пробрасывается вызывающему коду.
 */

import { invoke } from "@tauri-apps/api/core";
import { base64ToBytes, bytesToBase64 } from "@/lib/media";

/** Диагностические логи (размеры) — включать только на время отладки. */
const DEBUG = false;
const TAG = "[CRYPTO-BYTES]";

/** 32B X25519 публичный ключ; 24B nonce NaCL box (XSalsa20-Poly1305). */
export const PUBKEY_SIZE = 32;
export const NONCE_SIZE = 24;

/**
 * Версия формата v:2 — plaintext это СЫРЫЕ байты медиа.
 * Отсутствие `v` в мете = legacy (plaintext был base64-строкой).
 */
export const MEDIA_VERSION_RAW = 2;

/** Выбор транспорта по UA. Чистая функция — покрыта headless-тестом. */
export function pickTransport(userAgent: string): "raw" | "json" {
  return userAgent.includes("Android") ? "json" : "raw";
}

/** Платформа фиксируется один раз: в рантайме транспорт не меняется. */
const TRANSPORT: "raw" | "json" =
  typeof navigator === "undefined" ? "raw" : pickTransport(navigator.userAgent);

export function transport(): "raw" | "json" {
  return TRANSPORT;
}

/** base64 публичный ключ → ровно 32 байта (валидация ДО invoke). */
export function decodeKey32(pubkeyB64: string, what: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(pubkeyB64);
  } catch (e) {
    throw new Error(`${TAG} ${what}: публичный ключ не base64 (${(e as Error)?.message ?? e})`);
  }
  if (bytes.length !== PUBKEY_SIZE) {
    throw new Error(`${TAG} ${what}: публичный ключ ${bytes.length}B, ожидалось ${PUBKEY_SIZE}B`);
  }
  return bytes;
}

/** base64 nonce из меты → ровно 24 байта (валидация ДО invoke). */
export function decodeNonce24(nonceB64: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(nonceB64);
  } catch (e) {
    throw new Error(`${TAG} decrypt: nonce не base64 (${(e as Error)?.message ?? e})`);
  }
  if (bytes.length !== NONCE_SIZE) {
    throw new Error(`${TAG} decrypt: nonce ${bytes.length}B, ожидалось ${NONCE_SIZE}B`);
  }
  return bytes;
}

/** Тело `crypto_encrypt_bytes`: [32B recipient_pubkey][plaintext]. */
export function packEncryptBody(
  recipientPub32: Uint8Array,
  plain: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(PUBKEY_SIZE + plain.length);
  body.set(recipientPub32, 0);
  body.set(plain, PUBKEY_SIZE);
  return body;
}

/** Тело `crypto_decrypt_bytes`: [32B sender_pubkey][24B nonce][ciphertext]. */
export function packDecryptBody(
  senderPub32: Uint8Array,
  nonce24: Uint8Array,
  cipher: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(PUBKEY_SIZE + NONCE_SIZE + cipher.length);
  body.set(senderPub32, 0);
  body.set(nonce24, PUBKEY_SIZE);
  body.set(cipher, PUBKEY_SIZE + NONCE_SIZE);
  return body;
}

/**
 * Ответ raw-IPC → байты. Если raw IPC недоступен и tauri вернул JSON-массив
 * чисел (поведение Android), падаем ГРОМКО, а не отдаём мусор в плеер.
 */
function asRawBytes(res: unknown, what: string): Uint8Array<ArrayBuffer> {
  if (res instanceof ArrayBuffer) return new Uint8Array(res);
  if (ArrayBuffer.isView(res)) {
    const view = res as ArrayBufferView;
    return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
  }
  throw new Error(
    `${TAG} ${what}: ожидались сырые байты (ArrayBuffer), получено ` +
      `${Object.prototype.toString.call(res)} — raw IPC недоступен на этой платформе?`,
  );
}

/** Разобрать ответ `crypto_encrypt_bytes`: [24B nonce][ciphertext]. */
export function unpackEncryptResult(res: unknown): {
  nonce: string;
  cipher: Uint8Array<ArrayBuffer>;
} {
  const bytes = asRawBytes(res, "crypto_encrypt_bytes");
  if (bytes.length < NONCE_SIZE + 1) {
    throw new Error(
      `${TAG} crypto_encrypt_bytes: ответ ${bytes.length}B, ` +
        `ожидалось ≥ ${NONCE_SIZE + 1}B ([nonce][ciphertext])`,
    );
  }
  return {
    nonce: bytesToBase64(bytes.subarray(0, NONCE_SIZE)),
    cipher: bytes.subarray(NONCE_SIZE) as Uint8Array<ArrayBuffer>,
  };
}

export interface EncryptBytesResult {
  /** Шифротекст = plaintext + 16B Poly1305-тег (то, что льётся в Storage). */
  cipher: Uint8Array<ArrayBuffer>;
  /** base64 nonce (24B) — идёт в мету сообщения. */
  nonce: string;
}

/** Зашифровать СЫРЫЕ байты медиа для получателя (v:2). */
export async function encryptBytes(
  recipientPubkeyB64: string,
  plain: Uint8Array<ArrayBuffer>,
): Promise<EncryptBytesResult> {
  const pub32 = decodeKey32(recipientPubkeyB64, "encrypt");

  if (transport() === "json") {
    try {
      const res = await invoke<{ ciphertext: string; nonce: string }>(
        "crypto_encrypt_bytes_json",
        { recipientPubkey: recipientPubkeyB64, plaintext: bytesToBase64(plain) },
      );
      if (!res?.ciphertext || !res?.nonce) {
        throw new Error(`пустой конверт: ${JSON.stringify(res)}`);
      }
      if (DEBUG) console.log(`${TAG} json encrypt ok: plain ${plain.length}B`);
      return { cipher: base64ToBytes(res.ciphertext), nonce: res.nonce };
    } catch (e) {
      console.error(`${TAG} encrypt (json/Android) failed:`, e);
      throw e instanceof Error ? e : new Error(`${TAG} encrypt (json/Android): ${String(e)}`);
    }
  }

  try {
    const res = await invoke<ArrayBuffer>("crypto_encrypt_bytes", packEncryptBody(pub32, plain));
    const out = unpackEncryptResult(res);
    if (DEBUG) {
      console.log(`${TAG} raw encrypt ok: plain ${plain.length}B → cipher ${out.cipher.length}B`);
    }
    return out;
  } catch (e) {
    console.error(`${TAG} encrypt (raw) failed:`, e);
    throw e instanceof Error ? e : new Error(`${TAG} encrypt (raw): ${String(e)}`);
  }
}

/** Расшифровать СЫРЫЕ байты медиа от отправителя (v:2). */
export async function decryptBytes(
  senderPubkeyB64: string,
  nonceB64: string,
  cipher: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const pub32 = decodeKey32(senderPubkeyB64, "decrypt");
  const nonce24 = decodeNonce24(nonceB64);

  if (transport() === "json") {
    try {
      const plainB64 = await invoke<string>("crypto_decrypt_bytes_json", {
        senderPubkey: senderPubkeyB64,
        nonce: nonceB64,
        ciphertext: bytesToBase64(cipher),
      });
      if (typeof plainB64 !== "string") {
        throw new Error(`ответ не base64-строка (${typeof plainB64})`);
      }
      if (DEBUG) console.log(`${TAG} json decrypt ok: cipher ${cipher.length}B`);
      return base64ToBytes(plainB64);
    } catch (e) {
      console.error(`${TAG} decrypt (json/Android) failed:`, e);
      throw e instanceof Error ? e : new Error(`${TAG} decrypt (json/Android): ${String(e)}`);
    }
  }

  try {
    const res = await invoke<ArrayBuffer>(
      "crypto_decrypt_bytes",
      packDecryptBody(pub32, nonce24, cipher),
    );
    const plain = asRawBytes(res, "crypto_decrypt_bytes");
    if (DEBUG) {
      console.log(`${TAG} raw decrypt ok: cipher ${cipher.length}B → plain ${plain.length}B`);
    }
    return plain;
  } catch (e) {
    console.error(`${TAG} decrypt (raw) failed:`, e);
    throw e instanceof Error ? e : new Error(`${TAG} decrypt (raw): ${String(e)}`);
  }
}
