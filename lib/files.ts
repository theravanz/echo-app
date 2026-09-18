"use client";

import * as tus from "tus-js-client";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";
import { base64ToBytes, bytesToBase64 } from "@/lib/media";
import { BaseDirectory, writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { appCacheDir, join } from "@tauri-apps/api/path";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 МБ
export const FILES_BUCKET = "files";

export interface FileMeta {
  path: string;
  nonce: string;
  mime: string;
  name: string;
  size: number;
  to: string;
  kind: "file";
}

export type UploadStatus = "uploading" | "paused" | "error";

import { parseVoiceMeta } from "@/lib/voice";

/** Удалить медиа-объект сообщения из Storage (voice/file). Текст — no-op. */
export async function deleteMessageMedia(msg: any): Promise<void> {
  try {
    if (msg?.type === "voice") {
      const meta = parseVoiceMeta(msg?.content);
      if (meta?.path) await supabase.storage.from("voice").remove([meta.path]);
    } else if (msg?.type === "file") {
      const meta = parseFileMeta(msg?.content);
      if (meta?.path) await supabase.storage.from("files").remove([meta.path]);
    }
  } catch (e) {
    // Медиа-сирота не должна блокировать удаление сообщения — залогируем
    console.warn("[DELETE] media cleanup failed:", e);
  }
}

export function parseFileMeta(content: unknown): FileMeta | null {
  if (typeof content !== "string" || !content.startsWith("{")) return null;
  try {
    const raw = JSON.parse(content);
    if (raw && typeof raw.path === "string" && typeof raw.nonce === "string" && typeof raw.to === "string") {
      return {
        path: raw.path, nonce: raw.nonce,
        mime: typeof raw.mime === "string" ? raw.mime : "application/octet-stream",
        name: typeof raw.name === "string" ? raw.name : "file",
        size: Number(raw.size) || 0,
        to: raw.to, kind: "file",
      };
    }
  } catch { /* ignore */ }
  return null;
}

/** Вторая сторона DH: свои сообщения → meta.to, входящие → отправитель */
export function keyUserFor(msg: any, metaTo?: string, myId?: string): string {
  return msg?.sender_id === myId ? (metaTo ?? msg.sender_id ?? "") : (msg?.sender_id ?? "");
}

async function getPublicKey(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from("profiles").select("public_key").eq("id", userId).maybeSingle();
    return data?.public_key ?? null;
  } catch { return null; }
}

export interface FileUploadHandle {
  metaPromise: Promise<FileMeta>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

// TUS на проекте отсутствует (404)? Запоминаем на ВСЮ сессию —
// больше не тратим раундтрип на каждый файл.
let tusDisabled = false;

const isNotFound = (e: any): boolean => {
  const m = String(e?.message ?? e).toLowerCase();
  return m.includes("404") || m.includes("not found");
};

/** Fallback без TUS: POST с прогрессом + авто-ретраи при обрыве сети.
 *  Файл ≤10 МБ, поэтому докачка с оффсета не критична — критично не потерять файл. */
function plainUploadWithRetry(
  blob: Blob, bucket: string, path: string, token: string, apiKey: string,
  cb: { onProgress: (loaded: number, total: number) => void },
): { promise: Promise<void>; abort: () => void } {
  const DELAYS = [1000, 3000, 5000, 10000, 15000, 30000]; // ~64 сек терпения
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  let aborted = false;
  let currentXhr: XMLHttpRequest | null = null;

  const attempt = (n: number): Promise<void> =>
    new Promise((res, rej) => {
      if (aborted) return rej({ paused: true });
      const xhr = new XMLHttpRequest();
      currentXhr = xhr;
      xhr.open("POST", url);
      xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", apiKey);
      xhr.setRequestHeader("x-upsert", "true");
      xhr.setRequestHeader("content-type", "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && !aborted) cb.onProgress(e.loaded, e.total);
      };
      const giveUp = (err: any) => rej(aborted ? { paused: true } : err);
      const retryOrGiveUp = (err: any) => {
        if (aborted) return rej({ paused: true });
        if (n >= DELAYS.length - 1) return giveUp(err);
        setTimeout(() => attempt(n + 1).then(res).catch(giveUp), DELAYS[n]);
      };
      xhr.onload = () => {
        if (aborted) return rej({ paused: true });
        if (xhr.status >= 200 && xhr.status < 300) return res();
        const err = new Error(`upload ${xhr.status}: ${xhr.responseText?.slice(0, 200)}`);
        // 4xx (кроме 408/429) — не сеть, ретраить бессмысленно
        if (xhr.status >= 400 && xhr.status < 500 && xhr.status !== 408 && xhr.status !== 429)
          return giveUp(err);
        retryOrGiveUp(err);
      };
      xhr.onerror = () => retryOrGiveUp(new Error("network-error"));
      xhr.onabort = () => rej({ paused: true });
      xhr.send(blob);
    });

  return {
    promise: attempt(0),
    abort: () => { aborted = true; try { currentXhr?.abort(); } catch {} },
  };
}

/**
 * Шифрует файл и льёт шифротекст. TUS (resumable), если проект его поддерживает,
 * иначе — обычный POST с авто-ретраями при обрыве сети.
 */
export function encryptAndUploadFile(
  senderId: string,
  receiverId: string,
  file: File,
  cb: { onProgress: (loaded: number, total: number) => void; onStatus: (s: UploadStatus) => void },
): FileUploadHandle {
  let cancelled = false;
  let paused = false;
  let settled = false;
  let uploader: tus.Upload | null = null;
  let lastTusUrl: string | null = null;
  let abortFallback: (() => void) | null = null;

  // Готовый шифротекст — чтобы resume не перешифровывал
  let cipher: Blob | null = null;
  let path = "";
  let token = "";
  let nonce = "";

  let resolveMeta!: (m: FileMeta) => void;
  let rejectMeta!: (e: any) => void;
  const metaPromise = new Promise<FileMeta>((res, rej) => { resolveMeta = res; rejectMeta = rej; });

  const finish = (m: FileMeta) => {
    if (settled) return;
    settled = true;
    resolveMeta(m);
  };
  const fail = (e: any) => {
    if (settled) return;
    settled = true;
    rejectMeta(e);
  };

  const tusConfig = () => ({
    endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/tus`,
    retryDelays: [] as number[], // падаем быстро → 404 уводит в fallback
    chunkSize: 64 * 1024 * 1024, // ≤10 МБ => одним куском
    headers: { authorization: `Bearer ${token}`, apikey: (supabase as any).supabaseKey },
    metadata: {
      bucketName: FILES_BUCKET,
      objectName: path,
      contentType: "application/octet-stream",
      cacheControl: "3600",
    },
    onProgress: (l: number, t: number) => {
      lastTusUrl = uploader?.url || lastTusUrl;
      cb.onProgress(l, t);
    },
  });

  const uploadOnce = async (): Promise<void> => {
    // Путь 1: TUS, если жив
    if (!tusDisabled) {
      try {
        await new Promise<void>((res, rej) => {
          uploader = new tus.Upload(cipher!, {
            ...tusConfig(),
            onError: (e) => rej(e),
            onSuccess: () => res(),
          });
          if (lastTusUrl) uploader.url = lastTusUrl; // докачка с оффсета
          uploader.start();
        });
        return;
      } catch (e) {
        if (isNotFound(e)) {
          tusDisabled = true; // на проекте нет TUS — дальше всегда fallback
        } else if (paused || cancelled) {
          return; // пауза/отмена — выходим тихо
        } else {
          throw e;
        }
      }
    }
    // Путь 2: fallback с ретраями
    const fb = plainUploadWithRetry(cipher!, FILES_BUCKET, path, token, (supabase as any).supabaseKey, {
      onProgress: cb.onProgress,
    });
    abortFallback = fb.abort;
    try {
      await fb.promise;
    } finally {
      abortFallback = null;
    }
  };

  const run = async () => {
    try {
      cb.onStatus("uploading");
      const pubkey = await getPublicKey(receiverId);
      if (!pubkey) throw new Error("Публичный ключ получателя не найден");

      const plainB64 = bytesToBase64(await file.arrayBuffer());
      const enc = await invoke<{ ciphertext: string; nonce: string }>(
        "crypto_encrypt", { recipientPubkey: pubkey, plaintext: plainB64 },
      );
      if (cancelled || paused) return;
      nonce = enc.nonce;

      cipher = new Blob([base64ToBytes(enc.ciphertext)], { type: "application/octet-stream" });
      path = `${senderId}/file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.enc`;
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token ?? "";

      await uploadOnce();
      if (cancelled || paused) return;
      finish({ path, nonce, mime: file.type || "application/octet-stream", name: file.name, size: file.size, to: receiverId, kind: "file" });
    } catch (e: any) {
      if (cancelled || paused || e?.paused) return;
      cb.onStatus("error");
      fail(e);
    }
  };
  run();

  return {
    metaPromise,
    pause: () => {
      if (settled || paused) return;
      paused = true;
      if (uploader) { try { uploader.abort(); } catch {} }
      abortFallback?.();
      cb.onStatus("paused");
    },
    resume: () => {
      if (settled || !paused) return;
      paused = false;
      cb.onStatus("uploading");
      if (cipher && path) {
        uploadOnce().then(() => {
          if (cancelled || paused) return;
          finish({ path, nonce, mime: file.type || "application/octet-stream", name: file.name, size: file.size, to: receiverId, kind: "file" });
        }).catch((e) => {
          if (cancelled || paused || e?.paused) return;
          cb.onStatus("error");
        });
      } else {
        run(); // упали до шифрования — начинаем заново
      }
    },
    cancel: () => {
      cancelled = true;
      paused = false;
      try { uploader?.abort(); } catch {}
      abortFallback?.();
      fail({ cancelled: true });
    },
  };
}

// ─── Скачивание / открытие / сохранение ───

async function downloadFileBytes(meta: FileMeta, keyUserId: string): Promise<Uint8Array> {
  const pubkey = await getPublicKey(keyUserId);
  if (!pubkey) throw new Error("Нет публичного ключа");
  const { data: signed, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(meta.path, 60 * 60);
  if (error || !signed?.signedUrl) throw new Error("Не удалось получить ссылку");
  const res = await fetch(signed.signedUrl);
  if (!res.ok) throw new Error(`Скачивание: ${res.status}`);
  const cipherB64 = bytesToBase64(await res.arrayBuffer());
  const plainB64 = await invoke<string>("crypto_decrypt", { senderPubkey: pubkey, ciphertext: cipherB64, nonce: meta.nonce });
  return base64ToBytes(plainB64);
}

const CACHE_SUBDIR = "echo-files";
const safeName = (n: string) => (n.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 120)) || "file";
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

/** Файл в кэше приложения; скачивает и расшифровывает при первом обращении. */
export async function ensureCachedFile(meta: FileMeta, keyUserId: string): Promise<string> {
  const ext = meta.name.includes(".") ? meta.name.slice(meta.name.lastIndexOf(".")) : "";
  const rel = `${CACHE_SUBDIR}/${safeName(meta.name.replace(/\.[^.]+$/, ""))}-${hash(meta.path)}${ext}`;
  const cached = await exists(rel, { baseDir: BaseDirectory.AppCache });
  console.warn("[FILE-CACHE] exists:", cached, "| rel:", rel);
  if (!cached) {
    console.warn("[FILE-CACHE] скачиваю...");
    const bytes = await downloadFileBytes(meta, keyUserId);
    console.warn("[FILE-CACHE] скачано байт:", bytes.length);
    await mkdir(CACHE_SUBDIR, { baseDir: BaseDirectory.AppCache, recursive: true });
    await writeFile(rel, bytes, { baseDir: BaseDirectory.AppCache });
    console.warn("[FILE-CACHE] записано");
  }
  return rel;
}

/** Открыть системным приложением (клик по файлу в чате). */
export async function openFileMessage(meta: FileMeta, keyUserId: string): Promise<void> {
  const rel = await ensureCachedFile(meta, keyUserId);
  const dir = await appCacheDir();
  await openPath(await join(dir, rel));
}

/** Сохранить в Загрузки (десктоп). Возвращает имя файла. */
export async function saveFileToDownloads(name: string, bytes: Uint8Array): Promise<string> {
  const stamped = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${safeName(name)}`;
  await writeFile(stamped, bytes, { baseDir: BaseDirectory.Download });
  return stamped;
}

export { downloadFileBytes };