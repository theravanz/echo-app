"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { GroupMember, GroupRole } from "./types";

/**
 * Участники группы с ролями — источник данных для БУДУЩЕГО профиля группы.
 *
 * Что отдаёт:
 *  - members: GroupMember[] (user_id, role, joined_at + профиль для списка)
 *  - myRole: роль текущего юзера ('owner' | 'admin' | 'member' | null)
 *  - isOwner / isAdmin — гейты для UI настроек (добавить админа и т.п.)
 *
 * Откуда: group_members (role из миграции 0012) + батч profiles.
 * Чтение покрыто RLS-политикой "members can read group members" (0011).
 *
 * МЕСТО ПОД БУДУЩИЕ МУТАЦИИ (реализуешь в настройках профиля группы):
 *  setAdmin(groupId, targetId, makeAdmin) → rpc('group_set_admin', ...)
 *  removeMember(groupId, targetId)        → rpc('group_remove_member', ...)
 *  leaveGroup(groupId)                     → rpc('group_leave', ...)
 * RPC-функций пока НЕТ в БД — это контракты, фронт уже готов их звать.
 */
export function useGroupMembers(
  groupId: string | null,
  isGroup: boolean,
  myId?: string | null,
) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [myRole, setMyRole] = useState<GroupRole | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!groupId || !isGroup) {
      setMembers([]);
      setMyRole(null);
      return;
    }
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from("group_members")
        .select("user_id, role, joined_at")
        .eq("group_id", groupId);
      if (error) throw error;
      const list = (rows ?? []) as { user_id: string; role: string; joined_at?: string | null }[];
      const ids = list.map((r) => r.user_id);
      let profiles: Record<string, any> = {};
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url, avatar_color, avatar_storage_path, avatar_nonce, avatar_mime")
          .in("id", ids);
        for (const p of profs ?? []) profiles[p.id] = p;
      }
      const merged: GroupMember[] = list.map((r) => ({
        user_id: r.user_id,
        role: (r.role === 'owner' || r.role === 'admin' ? r.role : 'member') as GroupRole,
        joined_at: r.joined_at ?? null,
        username: profiles[r.user_id]?.username ?? null,
        display_name: profiles[r.user_id]?.display_name ?? null,
        avatar_url: profiles[r.user_id]?.avatar_url ?? null,
        avatar_color: profiles[r.user_id]?.avatar_color ?? null,
        avatar_storage_path: profiles[r.user_id]?.avatar_storage_path ?? null,
        avatar_nonce: profiles[r.user_id]?.avatar_nonce ?? null,
        avatar_mime: profiles[r.user_id]?.avatar_mime ?? null,
      }));
      setMembers(merged);
      const me = merged.find((m) => m.user_id === myId);
      setMyRole(me?.role ?? null);
    } catch (e) {
      console.warn("[GroupMembers] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [groupId, isGroup, myId]);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  // ── Заглушки мутаций: кидают понятную ошибку, пока нет RPC в БД ──
  const notReady = async (): Promise<never> => {
    throw new Error("Управление ролями появится в настройках профиля группы (нужен RPC group_set_admin)");
  };

  return {
    members,
    myRole,
    /** true — владелец (создатель). Может всё. */
    isOwner: myRole === 'owner',
    /** true — владелец ИЛИ админ. Может управлять обычными участниками. */
    isAdmin: myRole === 'owner' || myRole === 'admin',
    loading,
    refetch: fetchMembers,
    // TODO(настройки профиля группы): заменить на rpc, когда появятся функции.
    setAdmin: notReady as (groupId: string, targetId: string, makeAdmin: boolean) => Promise<void>,
    removeMember: notReady as (groupId: string, targetId: string) => Promise<void>,
    leaveGroup: notReady as (groupId: string) => Promise<void>,
  };
}
