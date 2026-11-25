"use client";

// ═══════════════════════════════════════════════════════════════════
// Единый кэш профилей (люди, с которыми есть чат).
//
// Зачем: до этого каждый экран тянул `profiles` сам — панель профиля,
// карточки упоминаний, отправители в группах, список чатов, поиск. На
// один заход в мессенджер набегали сотни одинаковых запросов.
//
// Что даёт:
//   • L1 память: повторные обращения к тому же id/username — 0 запросов;
//   • single-flight: параллельные запросы одного id делят один запрос;
//   • батчи: несколько id грузятся одним `in("id", [...])`;
//   • персист в SQLCipher (chat-cache): профиль открывается офлайн,
//     аватар/имя доступны без сети после перезапуска;
//   • TTL: свежий кэш не перезапрашивается, устаревший тихо
//     ревалидируется (офлайн остаётся прошлая копия).
//
// Важно: наружу отдаём всегда «свежую» память, поэтому UI сначала
// рисует кэш и не мигает пустотой, а сеть лишь уточняет данные.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "@/lib/supabase";
import { cacheGetBounded, cacheSet } from "./chat-cache";
import type { UserProfile } from "./types";

const STORE_KEY = "echo_profiles_cache_v1";
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000; // 30 минут
const MAX_ENTRIES = 500;

type Entry = { p: UserProfile; at: number };

const memory = new Map<string, Entry>();
const usernameIndex = new Map<string, string>();
const inFlightById = new Map<string, Promise<UserProfile | null>>();
const inFlightByUsername = new Map<string, Promise<UserProfile | null>>();

let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;

function normalizeUsername(value?: string | null): string | null {
  if (!value) return null;
  const clean = value.replace(/^@/, "").trim().toLowerCase();
  return clean || null;
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const raw = await cacheGetBounded(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const entries: Array<[string, Entry]> = Array.isArray(parsed?.entries)
          ? parsed.entries
          : [];
        for (const [id, entry] of entries) {
          if (!id || !entry?.p) continue;
          // Профиль могли обновить из сети/кэша чатов, пока гидратация
          // читала SQLCipher: свежие поля важнее, но сохранённые extras
          // (bio/status/activity) не теряем.
          const existing = memory.get(id);
          const merged = existing ? { ...entry.p, ...existing.p } : entry.p;
          const at = Math.max(existing?.at ?? 0, Number(entry.at) || 0);
          memory.set(id, { p: merged, at });
          const uname = normalizeUsername(merged.username);
          if (uname) usernameIndex.set(uname, id);
        }
        if (entries.length > 0) {
          console.log(`[PROFILE-CACHE] hydrated ${entries.length} profiles`);
        }
      }
    } catch (e) {
      console.warn("[PROFILE-CACHE] hydrate failed:", e);
    } finally {
      hydrated = true;
      if (persistDirty) {
        persistDirty = false;
        schedulePersist();
      }
    }
  })();
  return hydratePromise;
}

/** Прогреть кэш заранее (например, при старте приложения). */
export function primeProfileCache(): Promise<void> {
  return hydrate();
}

function schedulePersist(): void {
  if (typeof window === "undefined") return;
  // До гидратации писать нельзя: затрём сохранённые профили неполным
  // набором из памяти. Запомним, что нужно записать, и сделаем это после.
  if (!hydrated) {
    persistDirty = true;
    return;
  }
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persist();
  }, 600);
}

async function persist(): Promise<void> {
  try {
    const entries = Array.from(memory.entries())
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    const ok = await cacheSet(STORE_KEY, JSON.stringify({ v: 1, entries }));
    if (!ok) console.warn("[PROFILE-CACHE] persist failed (secure store unavailable)");
  } catch (e) {
    console.warn("[PROFILE-CACHE] persist failed:", e);
  }
}

export interface RememberOptions {
  /**
   * false — не обновлять «свежесть» записи (данные пришли из кэша, а не
   * из сети). Тогда следующий онлайн-запрос профилей их ревалидирует.
   * Новая запись при этом получает at=0 (заведомо устаревшая).
   */
  touch?: boolean;
}

/** Положить профиль в кэш (память + отложенная запись в SQLCipher). */
export function rememberProfile(profile?: UserProfile | null, opts: RememberOptions = {}): void {
  if (!profile?.id) return;
  const prevEntry = memory.get(profile.id);
  // undefined = «поле не запрашивали», null = «явно пусто». Пропускаем
  // undefined, чтобы частичный ответ не затирал имя/аватар из кэша.
  const incoming: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile)) {
    if (v !== undefined) incoming[k] = v;
  }
  const merged = { ...(prevEntry?.p ?? {}), ...incoming } as UserProfile;
  const changed =
    !prevEntry ||
    Object.entries(incoming).some(
      ([k, v]) => (prevEntry.p as unknown as Record<string, unknown>)[k] !== v,
    );

  const at = opts.touch === false ? (prevEntry?.at ?? 0) : Date.now();
  memory.set(merged.id, { p: merged, at });
  const uname = normalizeUsername(merged.username);
  if (uname) usernameIndex.set(uname, merged.id);
  // Пишем в SQLCipher только при реальном изменении данных: чтение
  // списка чатов из кэша не должно инициировать запись каждый тик.
  if (changed) schedulePersist();
}

export function rememberProfiles(
  list?: UserProfile[] | null,
  opts: RememberOptions = {},
): void {
  if (!list?.length) return;
  for (const p of list) rememberProfile(p, opts);
}

/** Синхронно из памяти (может быть null, пока кэш не прогрелся). */
export function getCachedProfile(id?: string | null): UserProfile | null {
  if (!id) return null;
  return memory.get(id)?.p ?? null;
}

/** Синхронно по username (без @, case-insensitive). */
export function getCachedProfileByUsername(username?: string | null): UserProfile | null {
  const uname = normalizeUsername(username);
  if (!uname) return null;
  const id = usernameIndex.get(uname);
  return id ? memory.get(id)?.p ?? null : null;
}

async function loadProfilesByIds(
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, UserProfile>> {
  const out = new Map<string, UserProfile>();
  if (ids.length === 0) return out;
  try {
    const base = supabase.from("profiles").select("*").in("id", ids);
    const { data, error } = signal ? await base.abortSignal(signal) : await base;
    if (error) throw error;
    rememberProfiles((data ?? []) as UserProfile[]);
    for (const p of (data ?? []) as UserProfile[]) out.set(p.id, p);
  } catch (e) {
    // Офлайн/таймаут: отдаём то, что уже лежит в кэше.
    console.warn("[PROFILE-CACHE] batch fetch failed:", e);
    for (const id of ids) {
      const cached = memory.get(id);
      if (cached) out.set(id, cached.p);
    }
  }
  return out;
}

export interface FetchProfilesOptions {
  /** Возраст, после которого кэш считается устаревшим. */
  maxAgeMs?: number;
  /** Игнорировать TTL и запросить заново. */
  force?: boolean;
  /** Abort для сетевого запроса (кэш всё равно вернётся). */
  signal?: AbortSignal;
}

/**
 * Получить профили по id. Возвращает Map<id, profile>.
 *
 * Грузит ТОЛЬКО отсутствующие/устаревшие id — одним батч-запросом.
 * Параллельные вызовы с теми же id не плодят запросы (single-flight).
 */
export async function fetchProfiles(
  ids: Array<string | null | undefined>,
  opts: FetchProfilesOptions = {},
): Promise<Map<string, UserProfile>> {
  const unique = Array.from(new Set(ids.filter(Boolean) as string[]));
  const result = new Map<string, UserProfile>();
  if (unique.length === 0) return result;

  await hydrate();

  const maxAge = opts.force ? -1 : opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = Date.now();
  const toLoad: string[] = [];

  for (const id of unique) {
    const entry = memory.get(id);
    if (entry) result.set(id, entry.p);
    if (!entry || now - entry.at > maxAge) toLoad.push(id);
  }

  const fresh = toLoad.filter((id) => !inFlightById.has(id));
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  const pending: Array<Promise<UserProfile | null>> = toLoad
    .map((id) => inFlightById.get(id))
    .filter((p): p is Promise<UserProfile | null> => Boolean(p));

  // Офлайн: не плодим заведомо падающие запросы — отдаём кэш как есть,
  // ревалидация произойдёт при возврате сети.
  if (fresh.length > 0 && !offline) {
    const batch = loadProfilesByIds(fresh, opts.signal);
    for (const id of fresh) {
      const single: Promise<UserProfile | null> = batch
        .then((map) => map.get(id) ?? memory.get(id)?.p ?? null)
        .catch(() => memory.get(id)?.p ?? null);
      void single.finally(() => {
        if (inFlightById.get(id) === single) inFlightById.delete(id);
      });
      inFlightById.set(id, single);
      pending.push(single);
    }
  }

  if (pending.length > 0) {
    const settled = await Promise.all(pending);
    for (const p of settled) if (p?.id) result.set(p.id, p);
  }

  // Итог всегда дополняем памятью: даже если сеть упала, кэш на месте.
  for (const id of unique) {
    const p = memory.get(id)?.p;
    if (p) result.set(id, p);
  }
  return result;
}

/** Получить один профиль (кэш + single-flight). */
export async function fetchProfile(
  id?: string | null,
  opts: FetchProfilesOptions = {},
): Promise<UserProfile | null> {
  if (!id) return null;
  const map = await fetchProfiles([id], opts);
  return map.get(id) ?? null;
}

/** Получить профиль по username (для @упоминаний и поиска). */
export async function fetchProfileByUsername(
  username?: string | null,
  opts: FetchProfilesOptions = {},
): Promise<UserProfile | null> {
  const raw = username?.replace(/^@/, "").trim();
  const uname = normalizeUsername(raw);
  if (!raw || !uname) return null;

  await hydrate();

  const maxAge = opts.force ? -1 : opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const knownId = usernameIndex.get(uname);
  if (knownId) {
    const entry = memory.get(knownId);
    if (entry && Date.now() - entry.at <= maxAge) return entry.p;
  }

  const existing = inFlightByUsername.get(uname);
  if (existing) return existing;

  // Офлайн: сеть не трогаем, отдаём то, что успели сохранить.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return knownId ? memory.get(knownId)?.p ?? null : null;
  }

  const promise: Promise<UserProfile | null> = (async (): Promise<UserProfile | null> => {
    try {
      // Username'ы в приложении канонически в нижнем регистре, а упоминание
      // в тексте может быть набрано с заглавными — ищем по lower-case, а при
      // промахе повторяем исходным написанием (legacy-аккаунты).
      const lookup = async (value: string) => {
        const base = supabase.from("profiles").select("*").eq("username", value);
        const res = opts.signal
          ? await base.abortSignal(opts.signal).maybeSingle()
          : await base.maybeSingle();
        if (res.error) throw res.error;
        return res.data as UserProfile | null;
      };

      let found = await lookup(uname);
      if (!found && raw !== uname) found = await lookup(raw);
      if (found) {
        rememberProfile(found);
        return found;
      }
      return null;
    } catch (e) {
      console.warn("[PROFILE-CACHE] username fetch failed:", uname, e);
      return knownId ? memory.get(knownId)?.p ?? null : null;
    }
  })();
  void promise.finally(() => {
    if (inFlightByUsername.get(uname) === promise) inFlightByUsername.delete(uname);
  });

  inFlightByUsername.set(uname, promise);
  return promise;
}
