"use client";

import { supabase } from "@/lib/supabase";
import { isOfflineNow, type FileCipherPayload, type FileMeta } from "@/lib/files";
import {
  encryptGroupBytes,
  makeGroupMediaMeta,
  type GroupMediaMeta,
} from "@/lib/group-media";

export const GROUP_FILES_BUCKET = "files";
export const GROUP_VOICE_BUCKET = "voice";

/** Колбэки прогресса (те же, что у encryptAndUploadFile). */
export interface GroupUploadCallbacks {
  onProgress?: (loaded: number, total: number) => void;
  onStatus?: (s: "uploading" | "paused" | "error") => void;
}

/**
 * Пути групповых медиа.
 *
 * ВАЖНО (RLS storage.objects, миграции 0007/0009): INSERT разрешён ТОЛЬКО
 * когда первый сегмент пути = auth.uid() отправителя. Поэтому групповые
 * объекты лежат в папке ОТПРАВИТЕЛЯ с подпапкой группы:
 *   "<senderId>/g_<groupId>/f_<ts>.enc"  (files)
 *   "<senderId>/g_<groupId>/v_<ts>.enc"  (voice)
 * Участники читают через signed-URL (SELECT разрешён всем authenticated).
 */
const groupFileRemotePath = (senderId: string, groupId: string) =>
  `${senderId}/g_${groupId}/f_${Date.now()}.enc`;
const groupVoiceRemotePath = (senderId: string, groupId: string) =>
  `${senderId}/g_${groupId}/v_${Date.now()}.enc`;

/**
 * Групповая загрузка файла: AES-GCM(msg_key_0) → bucket files.
 *
 * Контракт — тот же FileUploadHandle, что у encryptAndUploadFile
 * (metaPromise/cipherPromise/pause/resume/cancel), но криптография
 * симметричная: один шифротекст читают ВСЕ участники одним ключом.
 * pause/resume — no-op (обычный upload, TUS не используется).
 */
export function encryptAndUploadGroupFile(
  senderId: string,
  groupId: string,
  msgKeyB64: string,
  file: File,
  callbacks?: GroupUploadCallbacks,
): { metaPromise: Promise<FileMeta>; cipherPromise: Promise<FileCipherPayload>; pause: () => void; resume: () => void; cancel: () => void } {
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  const throwIfCancelled = () => {
    if (cancelled) {
      const e: any = new Error("cancelled");
      e.cancelled = true;
      throw e;
    }
  };

  // 1) Локальное шифрование: cipher готов БЕЗ сети (офлайн-ok).
  const cipherPromise: Promise<FileCipherPayload> = (async () => {
    const plain = new Uint8Array(await file.arrayBuffer());
    const { cipher, nonce } = await encryptGroupBytes(plain, msgKeyB64);
    throwIfCancelled();
    return {
      cipher,
      remotePath: groupFileRemotePath(senderId, groupId),
      nonce,
    };
  })();

  // 2) Upload → мета (v=3/enc='group') для колонки content.
  const metaPromise: Promise<FileMeta> = (async () => {
    const cp = await cipherPromise;
    throwIfCancelled();
    if (isOfflineNow()) {
      const e: any = new Error("offline");
      e.offline = true;
      throw e;
    }
    callbacks?.onStatus?.("uploading");
    const total = cp.cipher.length;
    callbacks?.onProgress?.(0, total);
    const { error } = await supabase.storage
      .from(GROUP_FILES_BUCKET)
      .upload(
        cp.remotePath,
        new Blob([cp.cipher as unknown as BlobPart], { type: "application/octet-stream" }),
        { upsert: true, contentType: "application/octet-stream" },
      );
    throwIfCancelled();
    if (error) throw error;
    callbacks?.onProgress?.(total, total);
    const meta: GroupMediaMeta = makeGroupMediaMeta(
      {
        remotePath: cp.remotePath,
        nonce: cp.nonce,
        mime: file.type || "application/octet-stream",
        name: file.name,
        size: file.size,
      },
      groupId,
    );
    // FileMeta-совместимость для общего пайплайна chat-area.
    return { ...meta, kind: "file" } as unknown as FileMeta;
  })();

  return {
    metaPromise,
    cipherPromise,
    pause: () => {}, // групповой upload не поддерживает паузу
    resume: () => {},
    cancel,
  };
}

/** Групповая загрузка голосового: AES-GCM(msg_key_0) → bucket voice. */
export async function encryptAndUploadGroupVoice(
  senderId: string,
  groupId: string,
  msgKeyB64: string,
  blob: Blob,
  durationSec: number,
): Promise<GroupMediaMeta> {
  const plain = new Uint8Array(await blob.arrayBuffer());
  const { cipher, nonce } = await encryptGroupBytes(plain, msgKeyB64);
  const remotePath = groupVoiceRemotePath(senderId, groupId);
  const { error } = await supabase.storage
    .from(GROUP_VOICE_BUCKET)
    .upload(
      remotePath,
      new Blob([cipher as unknown as BlobPart], { type: "application/octet-stream" }),
      { upsert: true, contentType: "application/octet-stream" },
    );
  if (error) throw error;
  return makeGroupMediaMeta(
    {
      remotePath,
      nonce,
      mime: blob.type || "audio/webm",
      duration: Math.max(0, Math.round(durationSec)),
    },
    groupId,
  );
}
