"use client";

/**
 * Групповые медиа (файлы/голос) — симметричное шифрование через msg_key_0.
 *
 * Проблема DM-пайплайна: voice.ts / files.ts шифруют NaCl box под публичный
 * ключ ОДНОГО получателя (DH). В группе получателей N — так нельзя: каждый
 * участник должен расшифровать ОДИН объект ОДНИМ групповым ключом.
 *
 * Схема (аналог текстов: AES-GCM, Web Crypto, ключ msg_key_0 из Chat):
 *   encrypt: AES-GCM(msg_key_0, iv=12B) → cipher; meta = { path, nonce: iv,
 *            mime, name?, size?, duration?, to: groupId, v: 3, enc: 'group' }
 *   decrypt: AES-GCM-open(msg_key_0, iv, cipher) → сырые байты.
 *
 * v=3 + enc='group' отличают групповую мету от DM (v=2, NaCl box).
 * parse-функции DM (parseVoiceMeta/parseFileMeta) групповую мету НЕ
 * отбрасывают (проверяют только path/nonce), так что бабблы работают.
 *
 * Хранилища те же (buckets voice/files, приватные) — меняется только
 * криптография байтов. Пути: "<groupId>/group-<ts>.enc".
 */

const GROUP_MEDIA_VERSION = 3;

export interface GroupMediaMeta {
  path: string;
  nonce: string;
  mime: string;
  name?: string;
  size?: number;
  duration?: number;
  to: string;
  v: typeof GROUP_MEDIA_VERSION;
  enc: 'group';
}

export function isGroupMediaMeta(raw: unknown): raw is GroupMediaMeta {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Record<string, unknown>;
  return (
    typeof m.path === 'string' &&
    typeof m.nonce === 'string' &&
    (m.v === GROUP_MEDIA_VERSION || m.enc === 'group')
  );
}

export function parseGroupMediaMeta(content: unknown): GroupMediaMeta | null {
  if (typeof content !== 'string' || !content.startsWith('{')) return null;
  try {
    const raw = JSON.parse(content);
    if (!isGroupMediaMeta(raw)) return null;
    return {
      path: raw.path,
      nonce: raw.nonce,
      mime: typeof raw.mime === 'string' ? raw.mime : 'application/octet-stream',
      name: typeof raw.name === 'string' ? raw.name : undefined,
      size: typeof raw.size === 'number' ? raw.size : undefined,
      duration: typeof raw.duration === 'number' ? raw.duration : undefined,
      to: typeof raw.to === 'string' ? raw.to : '',
      v: GROUP_MEDIA_VERSION,
      enc: 'group',
    };
  } catch {
    return null;
  }
}

async function importGroupKey(msgKeyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(msgKeyB64), (c) => c.charCodeAt(0));
  return window.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Зашифровать сырые байты медиа групповым ключом. Возвращает cipher + iv(b64). */
export async function encryptGroupBytes(
  plain: Uint8Array,
  msgKeyB64: string,
): Promise<{ cipher: Uint8Array; nonce: string }> {
  const key = await importGroupKey(msgKeyB64);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource);
  const cipher = new Uint8Array(ct);
  let bin = '';
  for (let i = 0; i < iv.length; i++) bin += String.fromCharCode(iv[i]);
  return { cipher, nonce: btoa(bin) };
}

/** Расшифровать групповой объект. Бросает при чужом ключе/битых данных. */
export async function decryptGroupBytes(
  cipher: Uint8Array,
  nonceB64: string,
  msgKeyB64: string,
): Promise<Uint8Array> {
  const key = await importGroupKey(msgKeyB64);
  const bin = atob(nonceB64);
  const iv = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) iv[i] = bin.charCodeAt(i);
  const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher as BufferSource);
  return new Uint8Array(pt);
}

/** Собрать мету группового файла/голосового для колонки content. */
export function makeGroupMediaMeta(
  p: { remotePath: string; nonce: string; mime: string; name?: string; size?: number; duration?: number },
  groupId: string,
): GroupMediaMeta {
  return {
    path: p.remotePath,
    nonce: p.nonce,
    mime: p.mime,
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.size !== undefined ? { size: p.size } : {}),
    ...(p.duration !== undefined ? { duration: p.duration } : {}),
    to: groupId,
    v: GROUP_MEDIA_VERSION,
    enc: 'group',
  };
}
