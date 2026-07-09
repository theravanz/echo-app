"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  TbAt as At,
  TbCalendar as Calendar,
  TbGift as GiftIcon,
  TbShare2,
} from "react-icons/tb";
import { cn, safeChar } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/* ============================================================= */
/*  Types                                                          */
/* ============================================================= */

export interface ProfileGift {
  id: string;
  emoji: string;
  name: string;
}

export interface ProfilePublication {
  id: string;
  media_type: "image" | "video";
  thumbnail_url: string | null;
}

export interface ProfileStory {
  id: string;
  media_url: string;
  media_type: "image" | "video";
}

export interface ViewedProfile {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  avatar_color?: string | null;
  bio: string | null;
  background: string | null;
  status_emoji: string | null;
  birth_date?: string | null;
  birth_date_hide_year?: boolean;
  is_online: boolean;
  last_seen_label: string | null;
  activity_type: "music" | "custom" | null;
  activity_title: string | null;
  activity_subtitle: string | null;
  activity_cover_url?: string | null;
  channel_name: string | null;
  channel_username: string | null;
  channel_subscribers: number | null;
  gifts: ProfileGift[];
  publications: ProfilePublication[];
  stories?: ProfileStory[];
}

/* ============================================================= */
/*  Constants                                                      */
/* ============================================================= */

const BACKGROUND_PRESETS: Record<string, string> = {
  violet:
    "radial-gradient(circle at 25% 20%,#4a3d8f,transparent 55%),radial-gradient(circle at 75% 70%,#2a2440,transparent 60%),#0d0d14",
  teal: "radial-gradient(circle at 70% 20%,#1a4a4a,transparent 55%),radial-gradient(circle at 20% 80%,#123028,transparent 60%),#0a1614",
  rose: "radial-gradient(circle at 30% 70%,#5a2a3a,transparent 55%),radial-gradient(circle at 80% 20%,#2a1420,transparent 60%),#150a10",
  amber:
    "radial-gradient(circle at 50% 30%,#4a3a1a,transparent 55%),radial-gradient(circle at 20% 80%,#2a2010,transparent 60%),#14100a",
};

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/* ============================================================= */
/*  Helpers                                                        */
/* ============================================================= */

function resolveBackground(bg: string | null) {
  if (!bg) return BACKGROUND_PRESETS.violet;
  if (bg in BACKGROUND_PRESETS) return BACKGROUND_PRESETS[bg];
  if (bg.startsWith("http")) return `url(${bg}) center/cover`;
  return bg;
}

function formatBirthDateDisplay(dateStr: string | null, hideYear?: boolean): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  if (hideYear) return `${day} ${month}`;
  return `${day} ${month} ${year}`;
}

function calculateAge(birthDate: string): number | null {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age > 0 ? age : null;
}

function ageWord(age: number): string {
  if (age % 10 === 1 && age % 100 !== 11) return "год";
  if (age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 10 || age % 100 >= 20)) return "года";
  return "лет";
}

/* ============================================================= */
/*  Main Component                                                 */
/* ============================================================= */

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
  const [avatarLevel, setAvatarLevel] = useState<0 | 1 | 2>(0);
  const isMobile = typeof window !== "undefined" && "ontouchstart" in window;

  const hasStories = (profile.stories?.length ?? 0) > 0;
  const hasActivity = !!profile.activity_title;
  const age = profile.birth_date && !profile.birth_date_hide_year ? calculateAge(profile.birth_date) : null;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0d] text-white overflow-hidden">
      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
        {/* Banner + avatar */}
        <div
          className={cn(
            "relative overflow-hidden transition-[height] duration-500 ease-out",
            avatarLevel > 0 ? "h-[280px]" : "h-[190px]"
          )}
        >
          <div className="absolute inset-0" style={{ background: resolveBackground(profile.background) }} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0a0a0d]" />

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="absolute top-4 left-4 z-10 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
          >
            <ChevronLeft className="w-4 h-4" />
          </motion.button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
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

          {/* Avatar — level 0 (normal) */}
          <AnimatePresence>
            {avatarLevel === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute left-1/2 -translate-x-1/2 bottom-6 z-[5] flex flex-col items-center"
              >
                <div className="rounded-full p-[3px]" style={{ background: hasStories ? "conic-gradient(from 0deg, var(--primary), #7dd3fc, var(--primary))" : "transparent" }}>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      if (isMobile) setAvatarLevel(1);
                      else setAvatarLevel(2);
                    }}
                    className="group relative w-[92px] h-[92px] rounded-full overflow-hidden bg-[#252038] border-4 border-[#0a0a0d] flex items-center justify-center font-bold text-4xl text-primary"
                  >
                    {profile.avatar_url ? (
                      <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                    ) : (
                      safeChar(profile.display_name || profile.username)
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <TbShare2 className="w-5 h-5" />
                    </div>
                  </motion.button>
                </div>

                {/* Ник по центру под аватаром */}
                <div className="mt-3 text-center px-4">
                  <div className="text-[20px] font-bold flex items-center justify-center gap-1.5">
                    {profile.display_name}
                    {profile.status_emoji && <span className="text-base leading-none">{profile.status_emoji}</span>}
                  </div>
                  <div className="text-[13px] text-white/40 mt-1">
                    {profile.is_online ? "в сети" : profile.last_seen_label || "не в сети"}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Avatar overlay — level 1 (banner fill, mobile) */}
          <AnimatePresence>
            {avatarLevel === 1 && (
              <motion.div
                initial={{ y: "100%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "100%", opacity: 0 }}
                transition={{ type: "spring", damping: 30, stiffness: 280 }}
                drag="y"
                dragConstraints={{ top: 0 }}
                dragElastic={0.1}
                onDragEnd={(_, info) => {
                  if (info.offset.y < -150 || info.velocity.y < -500) setAvatarLevel(2);
                  else if (info.offset.y > 80) setAvatarLevel(0);
                }}
                className="absolute inset-0 z-40 bg-[#0a0a0d]"
              >
                <div className="absolute inset-0">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full bg-[#252038] flex items-center justify-center text-6xl font-bold text-primary">
                      {safeChar(profile.display_name || profile.username)}
                    </div>
                  )}
                </div>
                {/* Блюр-градиент снизу */}
                <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0a0d] via-[#0a0a0d]/60 to-transparent backdrop-blur-sm" />
                {/* Ник и статус слева */}
                <motion.div
                  initial={{ x: "-50%", opacity: 0, scale: 0.9 }}
                  animate={{ x: 0, opacity: 1, scale: 1 }}
                  transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 30 }}
                  className="absolute bottom-6 left-5 right-5 flex items-end justify-between"
                >
                  <div>
                    <div className="text-[22px] font-bold flex items-center gap-1.5">
                      {profile.display_name}
                      {profile.status_emoji && <span className="text-lg">{profile.status_emoji}</span>}
                    </div>
                    <div className="text-[13px] text-white/60 mt-1">
                      {profile.is_online ? "в сети" : profile.last_seen_label || "не в сети"}
                    </div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setAvatarLevel(0)}
                    className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </motion.div>
                <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[11px] text-white/40">
                  свайп вверх — на весь экран
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Avatar fullscreen — level 2 (gallery) */}
          <AnimatePresence>
            {avatarLevel === 2 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="fixed inset-0 z-[60] bg-black flex items-center justify-center"
              >
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.9 }}
                  transition={{ type: "spring", damping: 25 }}
                  className="relative w-full h-full"
                >
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} className="w-full h-full object-contain" alt="" />
                  ) : (
                    <div className="w-full h-full bg-[#252038] flex items-center justify-center text-8xl font-bold text-primary">
                      {safeChar(profile.display_name || profile.username)}
                    </div>
                  )}
                  <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setAvatarLevel(0)}
                      className="w-10 h-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </motion.button>
                    <div className="text-center">
                      <div className="text-sm font-semibold">{profile.display_name}</div>
                      <div className="text-[11px] text-white/50">@{profile.username}</div>
                    </div>
                    <div className="w-10" />
                  </div>
                  <div className="absolute bottom-0 inset-x-0 p-4 flex items-center justify-center gap-4 bg-gradient-to-t from-black/70 to-transparent">
                    <button className="w-12 h-12 rounded-full bg-white/10 backdrop-blur flex items-center justify-center">
                      <TbShare2 className="w-5 h-5" />
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
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

        {/* Activity */}
        {hasActivity && (
          <div className="mx-5 mt-5 rounded-[20px] p-3.5 flex items-center gap-3 bg-gradient-to-br from-[#4a3d1a] to-[#2e2510]">
            <div className="w-[42px] h-[42px] rounded-xl bg-black/20 flex items-center justify-center shrink-0 overflow-hidden">
              {profile.activity_cover_url ? (
                <img src={profile.activity_cover_url} className="w-full h-full object-cover" alt="" />
              ) : (
                <Music className="w-[18px] h-[18px] text-amber-200" />
              )}
            </div>
            <div className="flex-1 min-w-0">
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

        {/* Channel */}
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

        {/* Unified info card */}
        <div className="mx-5 mt-5 rounded-[20px] bg-[#131318] overflow-hidden divide-y divide-white/5">
          {/* Username row */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-[34px] h-[34px] rounded-[11px] bg-[#252038] flex items-center justify-center shrink-0">
                <At className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-bold truncate">@{profile.username}</div>
                <div className="text-xs text-white/40 mt-0.5">Имя пользователя</div>
              </div>
            </div>
            <div className="w-[34px] h-[34px] rounded-[11px] bg-[#252038] flex items-center justify-center shrink-0">
              <QrCode className="w-4 h-4 text-primary" />
            </div>
          </div>

          {/* Bio row */}
          {profile.bio && (
            <div className="p-4">
              <div className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2">О себе</div>
              <p className="text-[13px] text-white/60 leading-relaxed">{profile.bio}</p>
            </div>
          )}

          {/* Birth date row */}
          {profile.birth_date && (
            <div className="flex items-center gap-3 p-4">
              <div className="w-[34px] h-[34px] rounded-[11px] bg-[#252038] flex items-center justify-center shrink-0">
                <Calendar className="w-4 h-4 text-blue-300" />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-bold">
                  {formatBirthDateDisplay(profile.birth_date, profile.birth_date_hide_year)}
                  {age && <span className="text-white/40 font-normal"> ({age} {ageWord(age)})</span>}
                </div>
                <div className="text-xs text-white/40 mt-0.5">Дата рождения</div>
              </div>
            </div>
          )}
        </div>

        {/* Gifts */}
        {profile.gifts.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-5 pt-6 pb-2 text-[13px] font-bold text-white/50">
              <GiftIcon className="w-3.5 h-3.5" /> Подарки
            </div>
            <div className="flex gap-2.5 px-5 pb-1 overflow-x-auto scrollbar-hide">
              {profile.gifts.map((g) => (
                <div
                  key={g.id}
                  title={g.name}
                  className="shrink-0 w-14 h-14 rounded-2xl bg-[#131318] flex items-center justify-center text-2xl"
                >
                  {g.emoji}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Publications */}
        <div className="flex items-center justify-between px-5 pt-6 pb-2">
          <span className="text-[13px] font-bold text-white/50">Публикации</span>
          {profile.publications.length > 0 && <span className="text-xs text-white/30">Все</span>}
        </div>

        {profile.publications.length === 0 ? (
          <div className="px-5 pb-6">
            <div className="rounded-[20px] bg-[#131318] border border-dashed border-white/10 p-6 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                <ImageIcon className="w-6 h-6 text-white/30" />
              </div>
              <div className="text-sm font-semibold text-white/70 mb-1">Пользователь ещё ничего не публиковал</div>
              <div className="text-xs text-white/40 max-w-[220px]">Здесь будут фотографии и видео</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 px-5 pb-6">
            {profile.publications.map((p) => (
              <div
                key={p.id}
                className="aspect-square rounded-2xl bg-[#1c1c24] overflow-hidden relative"
              >
                {p.thumbnail_url ? (
                  <img src={p.thumbnail_url} className="w-full h-full object-cover" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="w-5 h-5 text-white/20" />
                  </div>
                )}
                {p.media_type === "video" && (
                  <Play className="w-4 h-4 text-white absolute bottom-2 right-2 drop-shadow" />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}