"use client";

/**
 * Outbox-хранилище шифротекста для офлайн-очереди (voice/file).
 *
 * ВЫБОР: шифротекст кладём ФАЙЛОМ в Tauri AppCache (`outbox/<tempId>.enc`),
 * а в очереди держим только путь.
 * Почему не base64 в очередь: очередь персистится (SQLCipher) и целиком
 * перезаписывается на каждое изменение — 10 МБ base64 в JSON = +33% размера
 * и полная сериализация blob'а на каждый чих, плюс эти же байты живут в JS-памяти
 * (и в стейте React, если положить их в Message). Файл: память не занимаем,
 * запись/чтение стримом через нативный fs, чистим сразу после успешной досылки.
 * НЕ-Tauri (browser dev): fallback в память — кэш сессии, без персиста
 * (в браузере нет AppCache; warn, чтобы это не выглядело как «работает»).
 */

import { BaseDirectory, mkdir, remove, writeFile, readFile, exists } from "@tauri-apps/plugin-fs";

const OUTBOX_DIR = "outbox";

/** Fallback для browser-dev: только в памяти процесса. */
const memoryFallback = new Map<string, Uint8Array>();

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Сохранить шифротекст и получить относительный путь для очереди. */
export async function putOutboxBlob(tempId: string, bytes: Uint8Array): Promise<string> {
  const rel = `${OUTBOX_DIR}/${tempId}.enc`;
  if (!isTauri()) {
    console.warn("[QUEUE] outbox: not in Tauri, keeping ciphertext in memory only:", rel);
    memoryFallback.set(rel, bytes);
    return rel;
  }
  await mkdir(OUTBOX_DIR, { baseDir: BaseDirectory.AppCache, recursive: true });
  await writeFile(rel, bytes, { baseDir: BaseDirectory.AppCache });
  return rel;
}

/** Прочитать шифротекст по пути из очереди. */
export async function readOutboxBlob(relPath: string): Promise<Uint8Array | null> {
  if (!isTauri()) {
    return memoryFallback.get(relPath) ?? null;
  }
  try {
    const has = await exists(relPath, { baseDir: BaseDirectory.AppCache });
    if (!has) return null;
    return await readFile(relPath, { baseDir: BaseDirectory.AppCache });
  } catch (e) {
    console.warn("[QUEUE] outbox read failed:", relPath, e);
    return null;
  }
}

/** Удалить шифротекст (после успешной досылки или отмены). */
export async function deleteOutboxBlob(relPath: string): Promise<void> {
  if (!isTauri()) {
    memoryFallback.delete(relPath);
    return;
  }
  try {
    await remove(relPath, { baseDir: BaseDirectory.AppCache });
  } catch (e) {
    // Файла может уже не быть — это не ошибка доставки, но и не «тишина».
    console.warn("[QUEUE] outbox remove failed:", relPath, e);
  }
}
