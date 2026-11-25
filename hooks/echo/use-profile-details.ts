// hooks/echo/use-profile-details.ts
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { cacheGetBounded, cacheSetBounded } from "./chat-cache";
import { getCachedProfile, primeProfileCache, rememberProfile } from "./profile-cache";
import type { ViewedProfile } from "@/components/echo/app/profile-view-panel";

const VIEWED_PROFILE_PREFIX = "echo_viewed_profile_v1_";
const VIEWED_TTL_MS = 10 * 60 * 1000;

const memoryCache = new Map<string, { profile: ViewedProfile; at: number }>();
const inFlight = new Map<string, Promise<ViewedProfile | null>>();

function toViewedProfile(p: any, channel: any, gifts: any[], pubs: any[]): ViewedProfile {
  return {
    id: p.id,
    display_name: p.display_name || p.username,
    username: p.username,
    avatar_url: p.avatar_url,
    avatar_storage_path: p.avatar_storage_path,
    avatar_nonce: p.avatar_nonce,
    avatar_mime: p.avatar_mime,
    avatar_color: p.avatar_color,
    bio: p.bio,
    background: p.background,
    status_emoji: p.status_emoji,
    is_online: false, // подставь из onlineUsers снаружи
    last_seen_label: null, // подставь formatRelativeTime(p.last_seen_at) снаружи
    activity_type: p.share_listening_activity ? p.activity_type : null,
    activity_title: p.share_listening_activity ? p.activity_title : null,
    activity_subtitle: p.share_listening_activity ? p.activity_subtitle : null,
    activity_cover_url: p.share_listening_activity ? p.activity_cover_url : null,
    activity_cover_path: p.share_listening_activity ? p.activity_cover_path : null,
    activity_cover_nonce: p.share_listening_activity ? p.activity_cover_nonce : null,
    channel_name: channel?.name ?? null,
    channel_username: channel?.username ?? null,
    channel_subscribers: channel?.subscribers_count ?? null,
    gifts: gifts ?? [],
    publications: pubs ?? [],
  };
}

async function loadProfileDetails(userId: string): Promise<ViewedProfile | null> {
  const [{ data: p }, { data: channel }, { data: gifts }, { data: pubs }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("channels").select("*").eq("owner_id", userId).maybeSingle(),
    supabase.from("gifts").select("*").eq("owner_id", userId),
    supabase
      .from("publications")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(9),
  ]);
  if (!p) return null;
  // Профиль дублируем в общий кэш: тот же человек в списке чатов,
  // упоминаниях и групповых отправителях больше не будет запрашиваться.
  rememberProfile(p);
  return toViewedProfile(p, channel, gifts ?? [], pubs ?? []);
}

/**
 * Профиль для правой панели. Cache-first:
 *   1) память (мгновенно при повторном открытии);
 *   2) SQLCipher (офлайн после перезапуска);
 *   3) сеть — только если кэша нет или он старше TTL.
 * Ошибка сети никогда не стирает уже показанный кэш.
 */
export function useProfileDetails(userId: string | null) {
  const [profile, setProfile] = useState<ViewedProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const cacheKey = `${VIEWED_PROFILE_PREFIX}${userId}`;

    (async () => {
      // 1. Память — отдаём сразу, без мигания пустой панелью.
      const mem = memoryCache.get(userId);
      if (mem) {
        setProfile(mem.profile);
        setLoading(false);
      } else {
        // Сброс прошлого профиля, пока грузим новый.
        setProfile(null);
        setLoading(true);
      }

      // 2. Персист — если в памяти ещё нет.
      if (!mem) {
        try {
          const raw = await cacheGetBounded(cacheKey);
          if (cancelled) return;
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.profile) {
              const cached = { profile: parsed.profile as ViewedProfile, at: Number(parsed.at) || 0 };
              memoryCache.set(userId, cached);
              setProfile(cached.profile);
              setLoading(false);
            }
          }
        } catch (e) {
          console.warn("[PROFILE-CACHE] viewed profile read failed:", e);
        }
      }

      if (cancelled) return;

      // 2.5. Общий кэш профилей: если человек есть в списке чатов, его
      // профиль уже сохранён (в т.ч. в SQLCipher) — показываем базовые
      // данные сразу, даже офлайн, не дожидаясь сети.
      if (!memoryCache.has(userId)) {
        try {
          await primeProfileCache();
          if (cancelled) return;
          const shared = getCachedProfile(userId);
          if (shared) {
            const seeded = toViewedProfile(shared, null, [], []);
            memoryCache.set(userId, { profile: seeded, at: 0 });
            setProfile(seeded);
            setLoading(false);
          }
        } catch {
          /* ignore — ниже попробуем сеть */
        }
      }

      if (cancelled) return;

      // 3. Свежесть: моложе TTL — сеть не трогаем.
      const at = memoryCache.get(userId)?.at ?? 0;
      const hasFresh = Date.now() - at < VIEWED_TTL_MS;
      if (hasFresh) {
        setLoading(false);
        return;
      }

      // 4. Сеть — single-flight на пользователя (панель могут открыть
      // повторно, пока первый запрос ещё летит).
      let request = inFlight.get(userId);
      if (!request) {
        const created: Promise<ViewedProfile | null> = loadProfileDetails(userId);
        const cleanup = () => {
          if (inFlight.get(userId) === created) inFlight.delete(userId);
        };
        // both-ветки: не оставляем unhandled rejection при офлайне.
        void created.then(cleanup, cleanup);
        inFlight.set(userId, created);
        request = created;
      }

      let fresh: ViewedProfile | null = null;
      try {
        fresh = await request;
      } catch (e) {
        // Офлайн: уже показанный кэш (memory/SQLCipher/общий профиль)
        // остаётся на экране, панель не зависает в загрузке.
        console.warn("[PROFILE-CACHE] viewed profile fetch failed:", e);
      }
      if (cancelled || !fresh) {
        if (!cancelled) setLoading(false);
        return;
      }

      memoryCache.set(userId, { profile: fresh, at: Date.now() });
      setProfile(fresh);
      setLoading(false);
      void cacheSetBounded(
        cacheKey,
        JSON.stringify({ profile: fresh, at: Date.now() }),
      ).catch((e) => console.warn("[PROFILE-CACHE] viewed profile write failed:", e));
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { profile, loading };
}
