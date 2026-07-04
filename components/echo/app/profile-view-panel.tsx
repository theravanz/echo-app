"use client";

import { useState } from "react";
import {
  TbChevronLeft as ChevronLeft,
  TbDotsVertical as MoreVertical,
  TbMessageCircle as MessageCircle,
  TbPhone as Phone,
  TbVideo as Video,
  TbBell as Bell,
  TbBellOff as BellOff,
  TbMusic as Music,
  TbSpeakerphone as Megaphone,
  TbChevronRight as ChevronRight,
  TbQrcode as QrCode,
  TbPhoto as ImageIcon,
  TbPlayerPlay as Play,
  TbX as X,
  TbFlag as Flag,
  TbBan as Ban,
  TbTrash as Trash2,
} from "react-icons/tb";
import { cn, safeChar } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/**
 * All fields below map 1:1 onto Supabase columns/tables.
 * See supabase-schema.md for the exact DDL and which fields
 * are owner-editable vs. system-derived.
 */
export interface ProfileGift {
  id: string;
  emoji: string; // gifts.emoji
  name: string; // gifts.name
}

export interface ProfilePublication {
  id: string;
  media_type: "image" | "video"; // publications.media_type
  thumbnail_url: string | null; // publications.thumbnail_url
}

export interface ViewedProfile {
  id: string;
  display_name: string; // profiles.display_name
  username: string; // profiles.username
  avatar_url: string | null; // profiles.avatar_url
  avatar_color: string | null; // profiles.avatar_color (fallback bg when no avatar)
  bio: string | null; // profiles.bio
  background: string | null; // profiles.background — gradient key or image URL, set by OWNER
  status_emoji: string | null; // profiles.status_emoji — set by the profile OWNER, never by viewer
  is_online: boolean;
  last_seen_label: string | null; // derived, e.g. "была(а) недавно"
  activity_type: "music" | "custom" | null; // profiles.activity_type
  activity_title: string | null; // profiles.activity_title (track name / custom status text)
  activity_subtitle: string | null; // profiles.activity_subtitle (artist, music only)
  channel_name: string | null; // channels.name
  channel_username: string | null; // channels.username
  channel_subscribers: number | null; // channels.subscribers_count
  gifts: ProfileGift[];
  publications: ProfilePublication[];
}

const BACKGROUND_PRESETS: Record<string, string> = {
  violet:
    "radial-gradient(circle at 25% 20%,#4a3d8f,transparent 55%),radial-gradient(circle at 75% 70%,#2a2440,transparent 60%),#0d0d14",
  teal: "radial-gradient(circle at 70% 20%,#1a4a4a,transparent 55%),radial-gradient(circle at 20% 80%,#123028,transparent 60%),#0a1614",
  rose: "radial-gradient(circle at 30% 70%,#5a2a3a,transparent 55%),radial-gradient(circle at 80% 20%,#2a1420,transparent 60%),#150a10",
  amber:
    "radial-gradient(circle at 50% 30%,#4a3a1a,transparent 55%),radial-gradient(circle at 20% 80%,#2a2010,transparent 60%),#14100a",
};

function resolveBackground(bg: string | null) {
  if (!bg) return BACKGROUND_PRESETS.violet;
  if (bg in BACKGROUND_PRESETS) return BACKGROUND_PRESETS[bg];
  if (bg.startsWith("http")) return `url(${bg}) center/cover`;
  return bg; // raw CSS value (hex, custom gradient) stored as-is
}

export function ProfileViewPanel({
  profile,
  onClose,
  onMuteToggle,
  onBlock,
  onReport,
  onClearHistory,
  isMuted,
}: {
  profile: ViewedProfile;
  onClose: () => void;
  onMuteToggle?: () => void;
  onBlock?: () => void;
  onReport?: () => void;
  onClearHistory?: () => void;
  isMuted?: boolean;
}) {
  const [avatarExpanded, setAvatarExpanded] = useState(false);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0d] text-white overflow-hidden">
      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
        {/* Banner + avatar */}
        <div
          className={cn(
            "relative overflow-hidden transition-[height] duration-500 ease-out",
            avatarExpanded ? "h-[280px]" : "h-[190px]"
          )}
        >
          <div
            className="absolute inset-0"
            style={{ background: resolveBackground(profile.background) }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0a0a0d]" />

          <button
            onClick={onClose}
            className="absolute top-4 left-4 z-10 w-9 h-9 rounded-full bg-black/40 flex items-center justify-center"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/40 flex items-center justify-center">
                <MoreVertical className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-2xl border-white/10 bg-background/95 backdrop-blur-3xl p-2">
              <DropdownMenuItem onClick={onMuteToggle} className="rounded-xl gap-3 py-2.5 cursor-pointer">
                {isMuted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                {isMuted ? "Включить уведомления" : "Отключить уведомления"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onClearHistory} className="rounded-xl gap-3 py-2.5 cursor-pointer">
                <Trash2 className="w-4 h-4" />
                Очистить историю переписки
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/5" />
              <DropdownMenuItem onClick={onReport} className="rounded-xl gap-3 py-2.5 cursor-pointer text-amber-400">
                <Flag className="w-4 h-4" />
                Пожаловаться
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onBlock} className="rounded-xl gap-3 py-2.5 cursor-pointer text-destructive">
                <Ban className="w-4 h-4" />
                Заблокировать
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tap to view full-size avatar photo */}
          <button
            onClick={() => setAvatarExpanded((v) => !v)}
            className={cn(
              "absolute z-[5] transition-all duration-500 ease-out overflow-hidden bg-[#252038] flex items-center justify-center font-bold text-primary",
              avatarExpanded
                ? "inset-0 rounded-none text-[0px]"
                : "left-6 -bottom-8 w-24 h-24 rounded-full border-4 border-[#0a0a0d] text-4xl"
            )}
          >
            {profile.avatar_url ? (
              <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
            ) : (
              safeChar(profile.display_name || profile.username)
            )}
          </button>
        </div>

        {/* Name + status emoji (owner-set, read-only here) */}
        <div className="px-6 pt-12 pb-1">
          <div className="text-[23px] font-bold flex items-center gap-2">
            {profile.display_name}
            {profile.status_emoji && <span className="text-lg leading-none">{profile.status_emoji}</span>}
          </div>
          <div className="text-[13px] text-white/40 mt-1.5">
            {profile.is_online ? "в сети" : profile.last_seen_label || "не в сети"}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex px-2 pt-5 pb-2">
          {[
            { icon: MessageCircle, label: "Чат" },
            { icon: Phone, label: "Звонок" },
            { icon: Video, label: "Видео" },
            { icon: isMuted ? BellOff : Bell, label: isMuted ? "Включить" : "Звук", onClick: onMuteToggle },
          ].map((a, i) => (
            <button key={i} onClick={a.onClick} className="flex-1 flex flex-col items-center gap-1.5">
              <a.icon className="w-[22px] h-[22px]" />
              <span className="text-[11px] text-white/60 font-semibold">{a.label}</span>
            </button>
          ))}
        </div>

        {/* Activity — Discord-style, only rendered when the owner is sharing one */}
        {profile.activity_title && (
          <div className="mx-5 mt-5 rounded-[20px] p-3.5 flex items-center gap-3 bg-gradient-to-br from-[#4a3d1a] to-[#2e2510]">
            <div className="w-[42px] h-[42px] rounded-xl bg-black/20 flex items-center justify-center shrink-0">
              <Music className="w-[18px] h-[18px] text-amber-200" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-amber-300/80">
                {profile.activity_type === "music" ? "Сейчас слушает" : "Статус активности"}
              </div>
              <div className="text-sm font-bold text-amber-100 truncate">{profile.activity_title}</div>
              {profile.activity_subtitle && (
                <div className="text-[11px] text-amber-300/60 truncate">{profile.activity_subtitle}</div>
              )}
            </div>
            {profile.activity_type === "music" && (
              <div className="flex items-end gap-[2px] h-4 shrink-0">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-[3px] h-full bg-amber-200 rounded-sm origin-bottom animate-pulse"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Channel — only rendered when the owner has one linked */}
        {profile.channel_name && (
          <div className="mx-5 mt-3 rounded-[20px] p-3.5 flex items-center gap-3 bg-gradient-to-br from-[#123028] to-[#0d1f1a]">
            <div className="w-[42px] h-[42px] rounded-xl bg-black/20 flex items-center justify-center shrink-0">
              <Megaphone className="w-[18px] h-[18px] text-emerald-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-emerald-300/80">Канал автора</div>
              <div className="text-sm font-bold text-emerald-100 truncate">{profile.channel_name}</div>
              {profile.channel_subscribers != null && (
                <div className="text-[11px] text-emerald-300/60">
                  {profile.channel_subscribers.toLocaleString("ru-RU")} подписчиков
                </div>
              )}
            </div>
            <ChevronRight className="w-4 h-4 text-emerald-300/60 shrink-0" />
          </div>
        )}

        {/* Bio */}
        {profile.bio && (
          <div className="px-5 pt-5">
            <p className="text-[13px] text-white/60 leading-relaxed">{profile.bio}</p>
          </div>
        )}

        {/* Username */}
        <div className="mx-5 mt-4 rounded-[20px] bg-[#131318] overflow-hidden">
          <div className="flex items-center justify-between p-4">
            <div>
              <div className="text-[15px] font-bold">@{profile.username}</div>
              <div className="text-xs text-white/40 mt-0.5">Имя пользователя</div>
            </div>
            <div className="w-[34px] h-[34px] rounded-[11px] bg-[#252038] flex items-center justify-center">
              <QrCode className="w-4 h-4 text-primary" />
            </div>
          </div>
        </div>

        {/* Gifts — only rendered when non-empty */}
        {profile.gifts.length > 0 && (
          <>
            <div className="px-5 pt-5 pb-2 text-[13px] font-bold text-white/50">Подарки</div>
            <div className="flex gap-2.5 px-5 pb-1 overflow-x-auto scrollbar-hide">
              {profile.gifts.map((g) => (
                <div
                  key={g.id}
                  title={g.name}
                  className="shrink-0 w-[60px] h-[60px] rounded-2xl bg-[#131318] flex items-center justify-center text-2xl"
                >
                  {g.emoji}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Publications — only rendered when non-empty */}
        {profile.publications.length > 0 && (
          <>
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <span className="text-[13px] font-bold text-white/50">Публикации</span>
              <span className="text-xs text-white/30">Все</span>
            </div>
            <div className="grid grid-cols-3 gap-2 px-5 pb-6">
              {profile.publications.map((p) => (
                <div
                  key={p.id}
                  className="aspect-square rounded-2xl bg-[#1c1c24] flex items-center justify-center overflow-hidden relative"
                >
                  {p.thumbnail_url ? (
                    <img src={p.thumbnail_url} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-white/20" />
                  )}
                  {p.media_type === "video" && (
                    <Play className="w-4 h-4 text-white absolute bottom-2 right-2 drop-shadow" />
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}