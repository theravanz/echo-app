//!
//! KV-хранилище кэшей — Rust-слой (SQLCipher).
//!
//! ИНВАРИАНТ: все кэши с расшифрованным контентом (plaintext переписки,
//! превью чатов) должны жить здесь, НЕ в localStorage. Расшифрованные
//! сообщения хранятся только в памяти + SQLCipher через этот модуль.
//!
//! Пишем через `save_auth_progress`/`get_auth_progress` — маршрутизатор
//! `route_table` кладёт всё, кроме `active_theme_id`, в `secure_store`
//! внутри зашифрованной БД. plugin-sql в сборке отсутствует (монополия
//! rusqlite), fallback на него не нужен. Не-Tauri (browser dev) — localStorage.
//! `cacheGet` прозрачно мигрирует legacy-ключи из localStorage: переносит
//! значение в SQLCipher и удаляет plaintext-след (одноразово на ключ).
//!

import { invoke } from "@tauri-apps/api/core";

// ═══════════════════════════════════════════════════════════════════
// L1 in-memory кэш + single-flight + сериализация записей.
//
// ПОЧЕМУ: IPC к Rust на macOS идёт через postMessage-fallback и под
// конкуренцией (StrictMode даёт по 2 одинаковых вызова на ключ, плюс
// 5+ чатов при старте) одно «чтение» растягивалось на секунды. WAL
// допускает одного писателя → параллельные записи ждут busy_timeout.
// Поэтому: повторные чтения — из памяти (0 IPC), одинаковые
// параллельные чтения делят один invoke, записи идут строго по одной.
// ═══════════════════════════════════════════════════════════════════

const memoryCache = new Map<string, string | null>();
const inFlightGet = new Map<string, Promise<string | null>>();
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ═══════════════════════════════════════════════════════════════════
// Таймаут-обёртка: IPC к Rust-слою не должен никогда блокировать
// рендер списка/чата. Если secure_store недоступен/завис — отдаём
// null и продолжаем (онлайн-фетч загрузит данные с сервера).
// ═══════════════════════════════════════════════════════════════════
const CACHE_IO_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        console.warn(`[CHAT-CACHE] ${label} timed out after ${CACHE_IO_TIMEOUT_MS}ms, skipping`);
        resolve(null);
      }, CACHE_IO_TIMEOUT_MS),
    ),
  ]);
}

/** cacheGet с таймаутом — для путей, где задержка недопустима (рендер UI). */
export async function cacheGetBounded(key: string): Promise<string | null> {
  return withTimeout(cacheGet(key), `cacheGet(${key})`);
}

/** cacheSet с таймаутом — запись в фоне, не блокирует UI-поток вызова. */
export async function cacheSetBounded(key: string, value: string): Promise<void> {
  await withTimeout(cacheSet(key, value), `cacheSet(${key})`);
}

/** Удалить устаревшую legacy-копию ключа из localStorage (SQL уже свежее). */
async function cleanupLegacyCopy(key: string): Promise<void> {
  try {
    if (localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
      console.log(`[CHAT-CACHE] removed stale legacy localStorage copy: ${key}`);
    }
  } catch { /* ignore */ }
}

/**
 * Прочитать значение кэша. Порядок: L1 (память) → single-flight →
 * Rust-слой (SQLCipher) → legacy-миграция из localStorage.
 * Возвращает raw JSON-строку или null.
 */
export async function cacheGet(key: string): Promise<string | null> {
  if (memoryCache.has(key)) return memoryCache.get(key) ?? null;

  const existing = inFlightGet.get(key);
  if (existing) return existing;

  const promise = cacheGetUncached(key)
    .then((value) => {
      memoryCache.set(key, value);
      inFlightGet.delete(key);
      return value;
    })
    .catch((e) => {
      inFlightGet.delete(key);
      throw e;
    });

  inFlightGet.set(key, promise);
  return promise;
}

async function cacheGetUncached(key: string): Promise<string | null> {
  if (hasTauri()) {
    // 1. SQLCipher через invoke (plugin-sql удалён из сборки — монополия rusqlite)
    try {
      const t0 = performance.now();
      const result = (await invoke("get_auth_progress", { key })) as string | null;
      const dt = performance.now() - t0;
      if (dt > 300) console.warn(`[CHAT-CACHE] slow get_auth_progress ${key}: ${Math.round(dt)}ms`);
      if (result) {
        await cleanupLegacyCopy(key);
        return result;
      }
    } catch (e) {
      console.warn("[CHAT-CACHE] invoke get_auth_progress failed:", e);
    }
    // 2. Одноразовая миграция legacy localStorage → SQLCipher.
    // Удаляем legacy-копию ТОЛЬКО при подтверждённой записи в SQL,
    // иначе данные потерялись бы в обоих хранилищах.
    let legacy: string | null = null;
    try { legacy = localStorage.getItem(key); } catch { legacy = null; }
    if (legacy !== null) {
      const persisted = await cacheSet(key, legacy);
      if (persisted) {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
        console.log(`[CHAT-CACHE] migrated legacy key to SQLCipher: ${key}`);
      } else {
        console.warn("[CHAT-CACHE] legacy migration persist failed, keeping localStorage copy");
      }
      return legacy;
    }
    return null;
  }
  // Не-Tauri окружение (browser dev) — localStorage и есть хранилище
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Записать значение кэша. Возвращает true, только если запись УДАЛАСЬ.
 * Записи сериализуются (WAL = один писатель; параллельные записи
 * упирались в busy_timeout и выглядели как «зависший» IPC).
 */
export async function cacheSet(key: string, value: string): Promise<boolean> {
  const ok = await enqueueWrite(() => cacheSetUncached(key, value));
  if (ok) memoryCache.set(key, value);
  else memoryCache.delete(key);
  return ok;
}

async function cacheSetUncached(key: string, value: string): Promise<boolean> {
  if (hasTauri()) {
    try {
      const t0 = performance.now();
      await invoke("save_auth_progress", { key, value });
      const dt = performance.now() - t0;
      if (dt > 300) console.warn(`[CHAT-CACHE] slow save_auth_progress ${key}: ${Math.round(dt)}ms`);
      return true;
    } catch (e) {
      console.warn("[CHAT-CACHE] invoke save_auth_progress failed:", e);
      return false;
    }
  }
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn("[CHAT-CACHE] localStorage persist failed:", e);
    return false;
  }
}
