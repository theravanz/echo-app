/**
 * Общие типы, константы и хелперы панели группы.
 * Все экраны импортируют отсюда — правишь в одном месте.
 */
import type { Chat, GroupMember, GroupRole } from "@/hooks/echo/types";

/* ─────────── Навигация и черновик правок ─────────── */

export type GroupPanelScreen =
  | "editor" // меню редактора (по карандашу)
  | "avatar" // аватар + фон баннера
  | "name" // название
  | "description" // описание
  | "link" // ссылка: по ссылке / без ссылки
  | "tempLinks" // временные ссылки (в разработке)
  | "members" // управление участниками
  | "admins"; // управление админами

/** Локальный черновик правок (до появления RPC сохранения). */
export interface GroupDraftState {
  name: string;
  description: string;
  /** null — «без ссылки»: посторонние войти не могут */
  username: string | null;
  bgIndex: number;
  /** локальный предпросмотр нового аватара (blob-URL) */
  avatarPreview: string | null;
}

/* ─────────── Адаптер под твой Chat ───────────
 * Если поля в твоём Chat называются иначе (title/about/link/…) —
 * правь только здесь, экраны трогать не нужно.
 */
export function readGroupMeta(chat: Chat) {
  const c = chat as any;
  return {
    id: String(c.id ?? ""),
    name: (c.display_name ?? c.name ?? c.title ?? "Группа") as string,
    description: (c.bio ?? c.description ?? c.about ?? "") as string,
    username: (c.username ?? null) as string | null,
    avatar: {
      url: (c.avatar_url ?? null) as string | null,
      bucket: "avatars" as string,
      path: (c.avatar_storage_path ?? null) as string | null,
      nonce: (c.avatar_nonce ?? null) as string | null,
      mime: (c.avatar_mime ?? null) as string | null,
      color: (c.avatar_color ?? null) as string | null,
    },
    membersCount: (c.member_count ?? c.memberCount ?? null) as number | null,
    onlineCount: (c.onlineCount ?? c.online ?? null) as number | null,
    isPrivate: Boolean(c.isPrivate ?? c.private ?? false),
  };
}

export function getMemberName(m: GroupMember): string {
  const x = m as any;
  return x.display_name ?? x.displayName ?? x.name ?? x.username ?? "Участник";
}

export function isMemberOnline(m: GroupMember): boolean {
  const x = m as any;
  return Boolean(x.isOnline ?? x.online ?? x.is_online);
}

/* ─────────── Русская плюрализация и формат статистики ─────────── */

export function plural(n: number, forms: [string, string, string]): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return forms[0];
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return forms[1];
  return forms[2];
}

/** «12 участников, 5 онлайн» */
export function formatMembersOnline(
  membersCount?: number | null,
  onlineCount?: number | null,
): string {
  const m = membersCount ?? 0;
  const base = `${m} ${plural(m, ["участник", "участника", "участников"])}`;
  const o = onlineCount ?? 0;
  return o > 0 ? `${base}, ${o} онлайн` : base;
}

export function formatAdmins(n: number): string {
  return `${n} ${plural(n, ["администратор", "администратора", "администраторов"])}`;
}

/* ─────────── Ссылки ─────────── */

export const ECHO_LINK_PREFIX = "echo.im/g/";

/** Алфавит без похожих символов (0/O, 1/l/I) — для кодов ссылок. */
const LINK_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomLinkCode(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += LINK_ALPHABET[Math.floor(Math.random() * LINK_ALPHABET.length)];
  }
  return out;
}

/* ─────────── Аватары ─────────── */

/** Инициалы (до двух букв) — используется как текстовый фолбэк. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/* ─────────── Роли ─────────── */

export const ROLE_LABEL: Record<GroupRole, string> = {
  owner: "Владелец",
  admin: "Админ",
  member: "Участник",
};

export const ROLE_BADGE_CLASS: Record<GroupRole, string> = {
  owner: "bg-amber-400/15 text-amber-300",
  admin: "bg-primary/15 text-primary",
  member: "bg-white/5 text-muted-foreground",
};

/* ─────────── Пресеты фона баннера ─────────── */

export const GROUP_BG_PRESETS: string[] = [
  // фиолетовый (основной)
  "bg-[radial-gradient(130%_120%_at_25%_-10%,#4c3585_0%,#241b45_45%,#0a0a0d_100%)]",
  // синий
  "bg-[radial-gradient(130%_120%_at_25%_-10%,#1e3a6e_0%,#141f3d_45%,#0a0a0d_100%)]",
  // изумруд
  "bg-[radial-gradient(130%_120%_at_25%_-10%,#14532d_0%,#0f2b1e_45%,#0a0a0d_100%)]",
  // закат
  "bg-[radial-gradient(130%_120%_at_25%_-10%,#7c2d4f_0%,#3d1630_45%,#0a0a0d_100%)]",
  // графит
  "bg-[radial-gradient(130%_120%_at_25%_-10%,#3f3f46_0%,#232327_45%,#0a0a0d_100%)]",
  // янтарь
  "bg-[radial-gradient(130%_120%_at_25%_-10%,#7c4a12_0%,#3a250e_45%,#0a0a0d_100%)]",
];
