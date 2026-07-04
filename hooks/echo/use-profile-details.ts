// hooks/echo/use-profile-details.ts
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { ViewedProfile } from "@/components/echo/app/profile-view-panel";

export function useProfileDetails(userId: string | null) {
  const [profile, setProfile] = useState<ViewedProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) { setProfile(null); return; }
    let cancelled = false;
    setLoading(true);

    (async () => {
      const [{ data: p }, { data: channel }, { data: gifts }, { data: pubs }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("channels").select("*").eq("owner_id", userId).maybeSingle(),
        supabase.from("gifts").select("*").eq("owner_id", userId),
        supabase.from("publications").select("*").eq("owner_id", userId).order("created_at", { ascending: false }).limit(9),
      ]);
      if (cancelled || !p) return;

      setProfile({
        id: p.id,
        display_name: p.display_name || p.username,
        username: p.username,
        avatar_url: p.avatar_url,
        avatar_color: p.avatar_color,
        bio: p.bio,
        background: p.background,
        status_emoji: p.status_emoji,
        is_online: false, // подставь из onlineUsers снаружи
        last_seen_label: null, // подставь formatRelativeTime(p.last_seen_at) снаружи
        activity_type: p.share_listening_activity ? p.activity_type : null,
        activity_title: p.share_listening_activity ? p.activity_title : null,
        activity_subtitle: p.share_listening_activity ? p.activity_subtitle : null,
        channel_name: channel?.name ?? null,
        channel_username: channel?.username ?? null,
        channel_subscribers: channel?.subscribers_count ?? null,
        gifts: gifts ?? [],
        publications: pubs ?? [],
      });
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  return { profile, loading };
}