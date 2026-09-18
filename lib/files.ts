"use client";

import * as tus from "tus-js-client";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { base64ToBytes, bytesToBase64 } from "@/lib/media";
import { decryptBytes, encryptBytes, MEDIA_VERSION_RAW } from "@/lib/crypto";
import { BaseDirectory, writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { appCacheDir, join } from "@tauri-apps/api/path";

/** Диагностические логи (кэш/размеры) — только на время отладки. */
const DEBUG = false;
const dbg = (...args: unknown[]) => {
  if (DEBUG) console.log("[FILE]", ...args);
};

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
  /**
   * Формат хранения. 2 = plaintext это СЫРЫЕ байты файла (NaCL box через
   * raw-bytes IPC / json-вариант на Android). Отсутствует у старых сообщений
   * (plaintext был base64-строкой) — они читаются legacy-командой crypto_decrypt.
   */
  v?: number;
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
        v: typeof raw.v === "number" && Number.isFinite(raw.v) ? raw.v : undefined,
      };
    }
  } catch (e) {
    console.error("[CRYPTO-BYTES] [FILE] parseFileMeta: content не JSON:", e);
  }
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

      // v:2 — шифруем СЫРЫЕ байты файла (base64-обёртка убрана).
      const plain = new Uint8Array(await file.arrayBuffer());
      const enc = await encryptBytes(pubkey, plain);
      if (cancelled || paused) return;
      nonce = enc.nonce;

      cipher = new Blob([enc.cipher], { type: "application/octet-stream" });
      dbg("upload: plain", plain.length, "→ cipher", enc.cipher.length);
      path = `${senderId}/file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.enc`;
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token ?? "";

      await uploadOnce();
      if (cancelled || paused) return;
      finish({ path, nonce, mime: file.type || "application/octet-stream", name: file.name, size: file.size, to: receiverId, kind: "file", v: MEDIA_VERSION_RAW });
    } catch (e: any) {
      if (cancelled || paused || e?.paused) return;
      console.error("[CRYPTO-BYTES] [FILE] upload failed:", e);
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
          console.error("[CRYPTO-BYTES] [FILE] upload resume failed:", e);
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
  const buf = new Uint8Array(await res.arrayBuffer());
  dbg("download: cipher", buf.length, "| v", meta.v, "| mime", meta.mime);

  try {
    // v:2 → СЫРЫЕ байты (raw-bytes IPC / json-вариант на Android).
    // Иначе — legacy-файл: plaintext был base64-строкой.
    if (meta.v === MEDIA_VERSION_RAW) {
      return await decryptBytes(pubkey, meta.nonce, buf);
    }
    const plainB64 = await invoke<string>("crypto_decrypt", {
      senderPubkey: pubkey,
      ciphertext: bytesToBase64(buf),
      nonce: meta.nonce,
    });
    return base64ToBytes(plainB64);
  } catch (e) {
    // Не глотаем: вызывающий код (openFileMessage) покажет ошибку пользователю.
    console.error("[CRYPTO-BYTES] [FILE] decrypt failed (v:", meta.v, "):", e);
    throw e;
  }
}

const CACHE_SUBDIR = "echo-files";
const safeName = (n: string) => (n.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 120)) || "file";
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

/** Файл в кэше приложения; скачивает и расшифровывает при первом обращении. */
export async function ensureCachedFile(meta: FileMeta, keyUserId: string): Promise<string> {
  const ext = meta.name.includes(".") ? meta.name.slice(meta.name.lastIndexOf(".")) : "";
  const rel = `${CACHE_SUBDIR}/${safeName(meta.name.replace(/\.[^.]+$/, ""))}-${hash(meta.path)}${ext}`;
  const cached = await exists(rel, { baseDir: BaseDirectory.AppCache });
  dbg("[FILE-CACHE] exists:", cached, "| rel:", rel);
  if (!cached) {
    dbg("[FILE-CACHE] скачиваю...");
    const bytes = await downloadFileBytes(meta, keyUserId);
    dbg("[FILE-CACHE] скачано байт:", bytes.length);
    await mkdir(CACHE_SUBDIR, { baseDir: BaseDirectory.AppCache, recursive: true });
    await writeFile(rel, bytes, { baseDir: BaseDirectory.AppCache });
    dbg("[FILE-CACHE] записано");
  }
  return rel;
}

export type OpenPlatform = "android" | "ios" | "desktop";

/**
 * Платформа рантайма для выбора механизма системного открытия файла.
 *
 * Определяем по UA (как `pickTransport` в lib/crypto.ts): в Tauri UA не
 * меняется в рантайме. `@tauri-apps/plugin-os` в проекте нет, а
 * lib/device-info.ts тянет гео-запросы по IP — для выбора механизма это лишнее.
 * Нюанс: iPadOS 13+ в WKWebView отдаёт UA как у macOS ("Macintosh"), поэтому
 * тач-«мак» (maxTouchPoints > 1) считаем iOS.
 */
export function openPlatform(): OpenPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (ua.includes("Android")) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || (ua.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1)) {
    return "ios";
  }
  return "desktop";
}

/** Открыть системным приложением (клик по файлу в чате). */
export async function openFileMessage(meta: FileMeta, keyUserId: string): Promise<void> {
  const rel = await ensureCachedFile(meta, keyUserId);
  const dir = await appCacheDir();
  // Абсолютный путь: на мобильных его же отдаём в Rust-команду открытия.
  const abs = await join(dir, rel);

  const target = openPlatform();
  if (target === "desktop") {
    // Десктоп не трогаем: openPath работает с file:// напрямую.
    await openPath(abs);
    return;
  }

  // Логируем ДО вызова: если JNI/Swift отвалится, в логе останется путь,
  // который не покрыт file_paths.xml (Android) или не существует (iOS).
  console.log(`[OPEN-MOBILE] open (${target})`, {
    path: abs, mime: meta.mime, name: meta.name, size: meta.size,
  });
  try {
    if (target === "android") {
      // content:// URI через FileProvider + системный chooser (Rust/Android).
      await invoke("open_file_system", { path: abs, mime: meta.mime || "application/octet-stream" });
    } else {
      // QLPreviewController модалкой поверх приложения (Rust → Swift).
      await invoke("open_file_ios", { path: abs });
    }
  } catch (e) {
    // Ошибку не глотаем: сначала лог с полным контекстом, потом тост юзеру.
    // Тост здесь, а не в chat-area — чтобы не было двойного тоста (мобильная
    // ветка завершается return).
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[OPEN-MOBILE] open failed:", target, "|", raw, "|", { path: abs, mime: meta.mime });
    toast.error(raw.includes("no-app-for-mime") ? "Нет приложения для этого файла" : "Не удалось открыть файл");
    return;
  }
}

/** Сохранить в Загрузки (десктоп). Возвращает имя файла. */
export async function saveFileToDownloads(name: string, bytes: Uint8Array): Promise<string> {
  const stamped = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${safeName(name)}`;
  await writeFile(stamped, bytes, { baseDir: BaseDirectory.Download });
  return stamped;
}

export { downloadFileBytes };