"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchProfiles } from "./profile-cache";
import { leaveGroup as leaveGroupRpc } from "@/lib/groups";
import type { GroupMember, GroupRole } from "./types";

/**
 * Участники группы с ролями — источник данных для БУДУЩЕГО профиля группы.
 *
 * Что отдаёт:
 *  - members: GroupMember[] (user_id, role, joined_at + профиль для списка)
 *  - myRole: роль текущего юзера ('owner' | 'admin' | 'member' | null)
 *  - isOwner / isAdmin — гейты для UI настроек (добавить админа и т.п.)
 *
 * Откуда: group_members (role из миграции 0012) + батч profiles из общего
 * кэша (hooks/echo/profile-cache.ts) — профили не запрашиваются повторно.
 * Список участников кэшируется в памяти на 60с, чтобы переоткрытие
 * профиля группы не било в сеть заново.
 *
 * МЕСТО ПОД БУДУЩИЕ МУТАЦИИ (реализуешь в настройках профиля группы):
 *  setAdmin(groupId, targetId, makeAdmin) → rpc('group_set_admin', ...)
 *  removeMember(groupId, targetId)        → rpc('group_remove_member', ...)
 *  leaveGroup(groupId)                     → rpc('group_leave', ...) — готово.
 * RPC-функций ролей пока НЕТ в БД — это контракты, фронт уже готов их звать.
 */

type MemberRow = { user_id: string; role: string; joined_at?: string | null };

const MEMBERS_TTL_MS = 60 * 1000;
const membersCache = new Map<string, { rows: MemberRow[]; at: number }>();
const membersInFlight = new Map<string, Promise<MemberRow[]>>();

async function loadMemberRows(groupId: string): Promise<MemberRow[]> {
  const cached = membersCache.get(groupId);
  if (cached && Date.now() - cached.at < MEMBERS_TTL_MS) return cached.rows;

  const existing = membersInFlight.get(groupId);
  if (existing) return existing;

  const request: Promise<MemberRow[]> = (async () => {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("group_members")
      .select("user_id, role, joined_at")
      .eq("group_id", groupId);
    if (error) throw error;
    const rows = ((data ?? []) as MemberRow[]).slice();
    membersCache.set(groupId, { rows, at: Date.now() });
    return rows;
  })();
  const clear = () => {
    if (membersInFlight.get(groupId) === request) membersInFlight.delete(groupId);
  };
  // both-ветки: неудачный запрос не должен оставить unhandled rejection.
  void request.then(clear, clear);
  membersInFlight.set(groupId, request);
  return request;
}

export function useGroupMembers(
  groupId: string | null,
  isGroup: boolean,
  myId?: string | null,
) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [myRole, setMyRole] = useState<GroupRole | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async (force = false) => {
    if (!groupId || !isGroup) {
      setMembers([]);
      setMyRole(null);
      return;
    }
    setLoading(true);
    try {
      if (force) membersCache.delete(groupId);
      const list = await loadMemberRows(groupId);

      const ids = list.map((r) => r.user_id);
      // Общий кэш профилей: уже известные участники не запрашиваются.
      const profileMap = ids.length > 0 ? await fetchProfiles(ids) : new Map();

      const merged: GroupMember[] = list.map((r) => {
        const p = profileMap.get(r.user_id);
        return {
          user_id: r.user_id,
          role: (r.role === 'owner' || r.role === 'admin' ? r.role : 'member') as GroupRole,
          joined_at: r.joined_at ?? null,
          username: p?.username ?? null,
          display_name: p?.display_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          avatar_color: p?.avatar_color ?? null,
          avatar_storage_path: p?.avatar_storage_path ?? null,
          avatar_nonce: p?.avatar_nonce ?? null,
          avatar_mime: p?.avatar_mime ?? null,
        };
      });
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

  // ── Выход из группы (реальный RPC; роли-мутации пока заглушки) ──
  const leaveGroup = useCallback(async (gid: string) => {
    await leaveGroupRpc(gid);
    membersCache.delete(gid);
    setMembers([]);
    setMyRole(null);
  }, []);

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
    refetch: () => fetchMembers(true),
    leaveGroup,
    // TODO(настройки профиля группы): заменить на rpc, когда появятся функции.
    setAdmin: notReady as (groupId: string, targetId: string, makeAdmin: boolean) => Promise<void>,
    removeMember: notReady as (groupId: string, targetId: string) => Promise<void>,
  };
}
