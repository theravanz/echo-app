"use client";

/**
 * Аватары для панели группы.
 *  - GroupAvatar  — аватар группы (СКРУГЛЁННЫЙ ПРЯМОУГОЛЬНИК, не круг;
 *                   скругление задаётся через className вызывающим кодом)
 *  - MemberAvatar — аватар участника (СТАНДАРТНЫЙ аватар приложения:
 *                   круг + реальное фото через SecureAvatar + avatar_color)
 */
import type { ChangeEvent } from "react";
import { SecureAvatar } from "@/components/echo/app/secure-avatar";
import { cn, safeChar } from "@/lib/utils";
import type { Chat, GroupMember } from "@/hooks/echo/types";
import {
  getMemberName,
  readGroupMeta,
} from "./lib/group-profile-utils";

interface GroupAvatarProps {
  chat: Chat;
  preview?: string | null;
  size?: number;
  className?: string;
}

export function GroupAvatar({ chat, preview, size = 40, className }: GroupAvatarProps) {
  const meta = readGroupMeta(chat);
  const a = meta.avatar;
  const letter = safeChar(meta.name, "G");
  return (
    <div
      style={{ width: size, height: size }}
      className={cn(
        "relative shrink-0 overflow-hidden bg-primary/20 flex items-center justify-center font-bold text-primary",
        className,
      )}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="h-full w-full object-cover" />
      ) : (
        <SecureAvatar
          src={a.url}
          bucket={a.bucket}
          path={a.path}
          nonce={a.nonce}
          mime={a.mime}
          fallback={<span style={{ fontSize: Math.max(10, size * 0.4) }}>{letter}</span>}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}

interface MemberAvatarProps {
  member: GroupMember;
  size?: number;
  className?: string;
}

/**
 * MemberAvatar — как аватары в сайдбаре/пузырях: круг, реальное фото
 * (SecureAvatar: avatar_url либо зашифрованный avatar_storage_path+nonce),
 * фон — avatar_color профиля, фолбэк — первая буква имени (safeChar).
 */
export function MemberAvatar({ member, size = 38, className }: MemberAvatarProps) {
  const name = getMemberName(member);
  const hasPhoto = Boolean(member.avatar_url || member.avatar_storage_path);
  // Стандарт аватара приложения: если у профиля есть свой цвет — берём его,
  // иначе фиолетовый (bg-primary/20 + text-primary), как в пузырях сообщений.
  const bg = member.avatar_color || "oklch(0.2 0.02 280)";
  const fg = member.avatar_color ? "#ffffff" : "var(--primary)";
  return (
    <div
      style={{ width: size, height: size, backgroundColor: bg, color: fg }}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full flex items-center justify-center font-bold",
        className,
      )}
    >
      {hasPhoto ? (
        <SecureAvatar
          src={member.avatar_url}
          bucket="avatars"
          path={member.avatar_storage_path || undefined}
          nonce={member.avatar_nonce}
          mime={member.avatar_mime}
          fallback={safeChar(name)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span style={{ fontSize: Math.max(10, size * 0.4) }}>{safeChar(name)}</span>
      )}
    </div>
  );
}

/** Обработчик выбора файла для аватара (используется в avatar-editor-screen). */
export function onAvatarFilePicked(
  e: ChangeEvent<HTMLInputElement>,
  onPicked: (blobUrl: string) => void,
) {
  const file = e.target.files?.[0];
  if (!file) return;
  onPicked(URL.createObjectURL(file));
  e.target.value = "";
}
