"use client";

/**
 * GroupProfilePanel — каркас профиля группы.
 *
 * ТВОЯ ЧАСТЬ (место подготовлено, реализацию пишешь сам):
 *   1) «Настройки группы» — переименование/аватар/описание (сейчас toast).
 *   2) Роли — действия «Сделать админом»/«Убрать» подключи к
 *      useGroupMembers().setAdmin/removeMember (контракты RPC — миграция 0012).
 *   3) «Покинуть группу» — подключи group_leave RPC.
 * Уже работает: имя/аватар/описание, состав с ролями, бейджи, группировка.
 */

import { toast } from "sonner";
import { cn, safeChar } from "@/lib/utils";
import { SecureAvatar } from "./secure-avatar";
import {
  TbX as X,
  TbUsers as UsersIcon,
  TbSettings as SettingsIcon,
  TbUserPlus as AddUserIcon,
  TbShieldCheck as ShieldIcon,
  TbLogout as LeaveIcon,
  TbInfoCircle as InfoIcon,
} from "react-icons/tb";
import type { Chat, GroupMember, GroupRole } from "@/hooks/echo/types";

const ROLE_LABEL: Record<GroupRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
};

const ROLE_BADGE_CLASS: Record<GroupRole, string> = {
  owner: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  admin: "bg-primary/15 text-primary border-primary/25",
  member: "bg-white/5 text-zinc-400 border-white/10",
};

export interface GroupProfilePanelProps {
  chat: Chat;
  myId: string | null;
  members: GroupMember[];
  myRole: GroupRole | null;
  isOwner: boolean;
  isAdmin: boolean;
  onClose: () => void;
}

export function GroupProfilePanel({
  chat,
  myId,
  members,
  myRole,
  isOwner,
  isAdmin,
  onClose,
}: GroupProfilePanelProps) {
  const memberCount = members.length || chat.member_count || 1;

  // Группировка по ролям для отображения.
  const owners = members.filter((m) => m.role === "owner");
  const admins = members.filter((m) => m.role === "admin");
  const regular = members.filter((m) => m.role === "member");

  const renderMember = (m: GroupMember) => (
    <div key={m.user_id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden"
        style={{ backgroundColor: m.avatar_color || "#27272a", color: "#fff" }}
      >
        {m.avatar_url || m.avatar_storage_path ? (
          <SecureAvatar
            src={m.avatar_url}
            bucket="avatars"
            path={m.avatar_storage_path || undefined}
            nonce={m.avatar_nonce}
            mime={m.avatar_mime}
            fallback={safeChar(m.display_name || m.username || "?")}
            className="w-full h-full object-cover"
          />
        ) : safeChar(m.display_name || m.username || "?")}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">
          {m.display_name || m.username || "Участник"}
          {m.user_id === myId && <span className="text-zinc-500 font-normal"> (вы)</span>}
        </div>
        {m.username && <div className="text-[11px] text-zinc-500 truncate">@{m.username}</div>}
      </div>
      <span className={cn(
        "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0",
        ROLE_BADGE_CLASS[m.role],
      )}>
        {ROLE_LABEL[m.role]}
      </span>
      {/* TODO(настройки): «Сделать админом/Убрать» для owner/admin
          (не показывать для себя и для owner) — через setAdmin/removeMember. */}
    </div>
  );

  const sectionTitle = (icon: React.ReactNode, text: string) => (
    <div className="flex items-center gap-2 px-5 pt-6 pb-2 text-[13px] font-bold text-muted-foreground">
      {icon} {text}
    </div>
  );
  void myRole;

  return (
    <div className="flex flex-col h-full overflow-y-auto settings-scroll bg-[#0a0a0d]">
      <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
        <span className="text-sm font-bold">Профиль группы</span>
        <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-zinc-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Аватар + название + описание (из расшифрованных метаданных Chat) */}
      <div className="flex flex-col items-center px-5 pt-4 pb-6 text-center">
        <div
          className="w-24 h-24 rounded-[28px] flex items-center justify-center text-3xl font-bold overflow-hidden border border-white/10 shadow-xl"
          style={{ backgroundColor: chat.avatar_color || "#27272a", color: chat.avatar_color ? "#fff" : "#a1a1aa" }}
        >
          {chat.avatar_url || chat.avatar_storage_path ? (
            <SecureAvatar
              src={chat.avatar_url}
              bucket="avatars"
              path={chat.avatar_storage_path || undefined}
              nonce={chat.avatar_nonce}
              mime={chat.avatar_mime}
              className="w-full h-full object-cover"
            />
          ) : safeChar(chat.display_name || "Г")}
        </div>
        <h2 className="mt-4 text-xl font-display font-bold">{chat.display_name || "Группа"}</h2>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <UsersIcon className="w-3.5 h-3.5" />
          {memberCount} участников
        </div>
        {chat.bio && (
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-[280px]">{chat.bio}</p>
        )}
      </div>

      {/* ═══ ТОЧКА 1: НАСТРОЙКИ ГРУППЫ (твоя часть) ═══ */}
      {(isOwner || isAdmin) && (
        <>
          {sectionTitle(<SettingsIcon className="w-3.5 h-3.5" />, "Настройки группы")}
          <div className="px-5 space-y-1">
            <SettingsRow
              icon={<InfoIcon className="w-4 h-4 text-zinc-400" />}
              label="Изменить название и описание"
              onClick={() => toast.info("Настройки группы — в разработке")}
            />
            <SettingsRow
              icon={<AddUserIcon className="w-4 h-4 text-zinc-400" />}
              label="Добавить участников"
              onClick={() => toast.info("Добавление участников — в разработке")}
            />
          </div>
        </>
      )}

      {/* ═══ ТОЧКА 2: УПРАВЛЕНИЕ РОЛЯМИ (твоя часть; RPC group_set_admin) ═══ */}
      {isOwner && (
        <>
          {sectionTitle(<ShieldIcon className="w-3.5 h-3.5" />, "Управление админами")}
          <div className="px-5 space-y-1">
            <SettingsRow
              icon={<ShieldIcon className="w-4 h-4 text-zinc-400" />}
              label="Назначить администратора"
              onClick={() => toast.info("Назначение админов — после RPC group_set_admin")}
            />
          </div>
        </>
      )}

      {/* Участники по ролям */}
      {owners.length > 0 && (
        <>
          {sectionTitle(<ShieldIcon className="w-3.5 h-3.5 text-amber-400" />, "Владелец")}
          <div className="px-3 pb-2">{owners.map(renderMember)}</div>
        </>
      )}
      {admins.length > 0 && (
        <>
          {sectionTitle(<ShieldIcon className="w-3.5 h-3.5" />, "Администраторы")}
          <div className="px-3 pb-2">{admins.map(renderMember)}</div>
        </>
      )}
      {regular.length > 0 && (
        <>
          {sectionTitle(<UsersIcon className="w-3.5 h-3.5" />, "Участники")}
          <div className="px-3 pb-2">{regular.map(renderMember)}</div>
        </>
      )}
      {members.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">Загрузка участников…</div>
      )}

      {/* ═══ ТОЧКА 3: ВЫХОД ИЗ ГРУППЫ (твоя часть; RPC group_leave) ═══ */}
      <div className="px-5 pt-6 pb-8">
        <button
          onClick={() => toast.info("Выход из группы — после RPC group_leave")}
          className={cn(
            "w-full h-12 rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold transition-colors",
            isOwner
              ? "bg-white/5 text-zinc-500 cursor-not-allowed"
              : "bg-destructive/10 text-destructive hover:bg-destructive/20",
          )}
          title={isOwner ? "Владелец не может выйти, не передав права" : undefined}
        >
          <LeaveIcon className="w-4 h-4" />
          {isOwner ? "Владелец не может выйти" : "Покинуть группу"}
        </button>
      </div>
    </div>
  );
}

function SettingsRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.04] transition-colors text-left"
    >
      <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">{icon}</div>
      <span className="text-sm font-medium flex-1">{label}</span>
    </button>
  );
}
