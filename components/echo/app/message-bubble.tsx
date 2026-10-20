"use client";

import React, { memo, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { loadVoiceUrl, parseVoiceMeta } from "@/lib/voice";
import { LinkPreview } from "./link-preview";
import { SecureAvatar } from "./secure-avatar";
import { CallLogMessage } from "./CallLogMessage";
import {
  TbCheck as Check,
  TbChecks as CheckCheck,
  TbClock as Clock,
  TbGitBranch as MeshIcon,
  TbRelationOneToOne as RelayIcon,
  TbPlayerPlayFilled as Play,
  TbPlayerPauseFilled as Pause,
  TbAlertCircle as TbAlertCircle,
  TbPencil as TbPencil,
} from "react-icons/tb";
import { TbX as X, TbDownload, TbPhoto, TbVideo, TbMusic, TbFile, TbFileText, TbFileZip, TbRefresh } from "react-icons/tb";
import { parseFileMeta, keyUserFor, type UploadStatus } from "@/lib/files";
import { AudioFileBubble } from "./audio-file-bubble";
import { messagePreview } from "@/lib/utils";

interface MessageBubbleProps {
  msg: any;
  isMe: boolean;
  showAvatar?: boolean;
  activeChat: any;
  user: any;
  onReply: (msg: any) => void;
  onEdit: (msg: any) => void;
  onContextMenu?: (e: React.MouseEvent, msg: any, isMine: boolean, rect: DOMRect) => void;
  onMentionClick?: (username: string) => void;
  isDimmed?: boolean;
    uploadState?: UploadUiState;
  onFileOpen?: (msg: any) => void;
  onFileCancel?: (msg: any) => void;
  onFileResume?: (msg: any) => void;
  // ── Группа: профиль отправителя (ник + ава). Свои сообщения — справа
  // без авы (isMe), чужие — слева с авой и цветным ником (Telegram-style).
  groupSenderName?: string | null;
  groupSenderColor?: string | null;
  groupSenderAvatar?: {
    src?: string | null;
    path?: string | null;
    nonce?: string | null;
    mime?: string | null;
    color?: string | null;
    fallback?: string;
  } | null;
  /** Групповой ключ (msg_key_0) — для расшифровки v=3 медиа внутри пузыря. */
  groupKeyB64?: string | null;
  /** Клик по аватарке/нику отправителя → открыть его профиль. */
  onOpenSenderProfile?: (senderId: string) => void;
}

// --- Helpers ---
const renderFormattedText = (text: string) => {
  if (!text) return null;
  const mentionRegex = /(?<!\w)@([A-Za-z0-9_]{3,20})(?!\w)/g;
  const mentions: { username: string }[] = [];
  const textWithPlaceholders = text.replace(mentionRegex, (_, username) => {
    mentions.push({ username });
    return `\x00MENTION\x00${mentions.length - 1}\x00MENTION\x00`;
  });

  let formatted = textWithPlaceholders
    .replace(/\|\|(.*?)\|\|/g, '<span class="bg-foreground/20 text-transparent hover:text-inherit rounded px-1 transition-colors cursor-help" title="Spoiler">$1</span>')
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-black/40 p-2.5 rounded-lg font-mono text-xs my-2 overflow-x-auto border border-white/5"><code>$1</code></pre>')
    .replace(/`(.*?)`/g, '<code class="bg-black/30 px-1.5 py-0.5 rounded font-mono text-xs border border-white/5">$1</code>')
    .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/~~(.*?)~~/g, "<del>$1</del>");

  formatted = formatted.replace(/\x00MENTION\x00(\d+)\x00MENTION\x00/g, (_, idx) => {
    const m = mentions[parseInt(idx, 10)];
    if (!m) return _;
    return `<a href="#" data-mention="${m.username.replace(/"/g, '&quot;')}" class="text-primary hover:underline cursor-pointer font-medium">@${m.username}</a>`;
  });

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return formatted.split(urlRegex).map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <div key={i} className="my-1 break-all">
          <a href={part} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{part}</a>
          <LinkPreview url={part} />
        </div>
      );
    }
    return <span key={i} dangerouslySetInnerHTML={{ __html: part }} />;
  });
};

const isJumboEmoji = (content: string, type: string) => {
  if (type !== "text" && type !== undefined) return false;
  const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
  const trimmed = content.trim();
  const matches = trimmed.match(emojiRegex);
  return matches && matches.length === 1 && matches[0] === trimmed;
};

const mentionRegex = /(?<!\w)@([A-Za-z0-9_]{3,20})(?!\w)/g;
const extractMentions = (text: string) => {
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    if (!mentions.includes(match[1])) mentions.push(match[1]);
  }
  return mentions;
};

function MentionMiniCard({ username, onClick }: { username: string; onClick?: (u: string) => void }) {
  const [profile, setProfile] = useState<{ display_name?: string; avatar_url?: string; avatar_storage_path?: string | null; avatar_nonce?: string | null; avatar_mime?: string | null; bio?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setProfile(null);
    (async () => {
      try {
        const { supabase } = await import("@/lib/supabase");
        const { data } = await supabase.from("profiles").select("display_name,avatar_url,avatar_storage_path,avatar_nonce,avatar_mime,bio").eq("username", username).maybeSingle();
        if (!cancelled) { setProfile(data); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [username]);

  return (
    <button onClick={() => onClick?.(username)} className="flex w-full max-w-[320px] items-start gap-3 rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-md p-3.5 text-left transition hover:border-primary/50 hover:bg-zinc-800">
      {loading ? <div className="h-11 w-11 shrink-0 rounded-full bg-white/10 animate-pulse" /> : (profile?.avatar_url || profile?.avatar_storage_path) ? (
        <SecureAvatar src={profile.avatar_url} bucket="avatars" path={profile.avatar_storage_path || undefined} nonce={profile.avatar_nonce} mime={profile.avatar_mime} className="h-11 w-11 shrink-0 rounded-full object-cover border border-white/5" />
      ) : (
        <div className="h-11 w-11 shrink-0 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm border border-primary/20">{username[0].toUpperCase()}</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-primary">@{username}</div>
        {!loading && profile?.display_name && <div className="truncate text-xs text-zinc-300 mt-0.5">{profile.display_name}</div>}
        {!loading && profile?.bio && <div className="mt-2 line-clamp-3 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">{profile.bio}</div>}
      </div>
    </button>
  );
}

const renderMessageContent = (content: string, type: string) => {
  if (type === "sticker" || type === "gif") return <img src={content} alt="Media" className="max-w-[140px] max-h-[140px] rounded-2xl object-contain drop-shadow-md" />;
  const isJumbo = isJumboEmoji(content, type);
  if (isJumbo) {
    const hex = Array.from(content).map((c) => c.codePointAt(0)?.toString(16)).join("-");
    return <img src={`https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.gif`} alt={content} className="w-24 h-24 drop-shadow-md" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).src = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${hex}.svg`; }} />;
  }
  return renderFormattedText(content);
};

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface UploadUiState { status: UploadStatus; loaded: number; total: number; }

/** Статус отправки, который реально не подтверждён сервером (часики, не галочка). */
const isPendingStatus = (status?: string): boolean => status === "pending" || status === "sending";

/**
 * Индикатор доставки в TG-стиле: часики для pending/sending, одна галочка
 * для sent, двойная — delivered/read. Рендерится и для текста, и для
 * voice/file (у медиа статус-строки раньше не было вообще).
 */
function DeliveryStatus({ status, time, className }: { status?: string; time: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1 px-1 mt-1 select-none", className)}>
      <span className="text-[11px] font-medium tabular-nums">{time}</span>
      {isPendingStatus(status) ? (
        <Clock className="w-3.5 h-3.5 opacity-80" />
      ) : status === "read" ? (
        <CheckCheck className="w-3.5 h-3.5 opacity-90" />
      ) : status === "delivered" ? (
        <CheckCheck className="w-3.5 h-3.5 opacity-70" />
      ) : status === "sent" ? (
        <Check className="w-3.5 h-3.5 opacity-60" />
      ) : null}
    </div>
  );
}

const formatBytes = (n: number) => n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`;

const fileIcon = (mime: string, name: string) => {
  if (mime.startsWith("image/")) return TbPhoto;
  if (mime.startsWith("video/")) return TbVideo;
  if (mime.startsWith("audio/")) return TbMusic;
  if (/\.pdf$/i.test(name)) return TbFileText;
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return TbFileZip;
  return TbFile;
};

// Кольцо прогресса с кнопкой (TG-стиль)
function RingButton({ progress, paused, isMe, onClick }: { progress: number; paused: boolean; isMe: boolean; onClick: () => void }) {
  const R = 13, C = 2 * Math.PI * R;
  const indeterminate = !paused && progress <= 0; // шифрование/старт — «карусель»
  return (
    <div className="relative w-9 h-9 shrink-0">
      <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
        <circle cx="18" cy="18" r={R} fill="none" strokeWidth="3" className="stroke-current opacity-20" />
        {!indeterminate && (
          <circle cx="18" cy="18" r={R} fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-current"
            strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, progress))} />
        )}
      </svg>
      {indeterminate && (
        <svg viewBox="0 0 36 36" className="absolute inset-0 w-9 h-9 -rotate-90 animate-spin">
          <circle cx="18" cy="18" r={R} fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-current" strokeDasharray={`${C * 0.3} ${C}`} />
        </svg>
      )}
      <button onClick={(e) => { e.stopPropagation(); onClick(); }} className="absolute inset-0 flex items-center justify-center">
        {paused ? <Play className="w-3.5 h-3.5" /> : <X className="w-4 h-4" />}
      </button>
    </div>
  );
}

function FileBubble({ msg, isMe, upload, onOpen, onCancel, onResume, onContextMenu, innerRef }: {
  msg: any; isMe: boolean; upload?: UploadUiState;
  onOpen?: () => void; onCancel?: () => void; onResume?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void; innerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const meta = parseFileMeta(msg?.content);
  if (!meta) return null;
  const Icon = fileIcon(meta.mime, meta.name);
  const uploading = upload?.status === "uploading";
  const paused = upload?.status === "paused";
  const failed = upload?.status === "error";
  // Не в БД/Storage ещё — «открывать» нечего, но и не ошибка (ждём очередь).
  const pending = Boolean(msg?._pending);
  const progress = upload && upload.total > 0 ? upload.loaded / upload.total : 0;
  const done = !upload && !pending;

  return (
    <div ref={innerRef} onContextMenu={onContextMenu}
      onClick={() => { if (failed) onResume?.(); else if (done) onOpen?.(); }}
      className={cn(
        "flex items-center gap-3 rounded-2xl px-3 py-2.5 select-none cursor-pointer",
        "w-[min(300px,calc(100vw-110px))] min-w-[220px]",
        isMe ? "bg-primary/90 text-primary-foreground" : "bg-zinc-800/90 border border-white/10 text-white backdrop-blur-md",
        failed && "border-red-500/40"
      )}>
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", isMe ? "bg-primary-foreground/10" : "bg-white/[0.07]")}>
        <Icon className="w-5 h-5 opacity-80" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold truncate">{meta.name}</div>
        <div className="text-[11px] opacity-70 tabular-nums mt-0.5">
          {failed ? "Не отправлено — нажмите для повтора"
            : paused ? `${formatBytes(meta.size)} · пауза`
            : uploading ? `${formatBytes(meta.size)} · ${Math.round(progress * 100)}%`
            : formatBytes(meta.size)}
        </div>
      </div>
      {uploading || paused ? (
        <RingButton progress={progress} paused={paused} isMe={isMe} onClick={paused ? onResume! : onCancel!} />
      ) : failed ? (
        <div className="w-9 h-9 rounded-full flex items-center justify-center bg-red-500/15 text-red-500 shrink-0"><TbRefresh className="w-4 h-4" /></div>
      ) : pending ? (
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", isMe ? "bg-primary-foreground/10" : "bg-white/[0.07]")}>
          <Clock className="w-4 h-4 opacity-70" />
        </div>
      ) : (
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", isMe ? "bg-primary-foreground/10" : "bg-white/[0.07]")}>
          <TbDownload className="w-4 h-4 opacity-60" />
        </div>
      )}
    </div>
  );
}

function VoiceBubble({ msg, isMe, recipientId, groupKeyB64, pending, onContextMenu, innerRef }: {
  msg: any;
  isMe: boolean;
  recipientId: string;
  /** Групповой ключ (msg_key_0) — для v=3 голосовых. */
  groupKeyB64?: string | null;
  /** Сообщение ещё не улетело (pending/queue) — играть нечего. */
  pending?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  innerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [url, setUrl] = useState<string | null>(null);
  const [dur, setDur] = useState(0);
  const meta = (msg as any).voice ?? parseVoiceMeta(msg?.content);
  const metaDur = meta?.duration || (msg as any).media_duration || 0;
  const total = dur || metaDur;

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (pending) return; // ещё в очереди — файла в Storage нет
    if (playing) { el.pause(); setPlaying(false); return; }
    if (!url) {
      if (!meta) return;
      setLoading(true);
      const u = await loadVoiceUrl(meta, recipientId, groupKeyB64);
      setLoading(false);
      if (!u) return;
      setUrl(u);
      requestAnimationFrame(() => {
        el.play().then(() => setPlaying(true)).catch(() => {});
      });
      return;
    }
    el.play().then(() => setPlaying(true)).catch(() => {});
  }

  function seek(e: React.PointerEvent<HTMLDivElement>) {
    const el = audioRef.current;
    const wave = waveRef.current;
    if (!el || !wave || !total) return;
    const rect = wave.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * total;
    setProgress(ratio);
  }

  return (
    <div
      ref={innerRef}
      onContextMenu={onContextMenu}
      className={cn(
        // Ширина: резиновая до 288px, но никогда не шире вьюпорта минус хром чата
        "flex items-center gap-2 md:gap-3 rounded-2xl px-3 py-2.5 md:px-4 md:py-3",
        "w-[min(288px,calc(100vw-110px))]",
        isMe
          ? "bg-primary/90 text-primary-foreground"
          : "bg-zinc-800/90 border border-white/10 text-white backdrop-blur-md"
      )}
    >
      <audio
        ref={audioRef}
        src={url ?? undefined}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
        onTimeUpdate={(e) => {
          const t = total || e.currentTarget.duration || 1;
          setProgress(e.currentTarget.currentTime / t);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        hidden
      />

      <button
        onClick={toggle}
        disabled={pending}
        aria-label={pending ? "Ожидает отправки" : playing ? "Пауза" : "Воспроизвести"}
        className={cn(
          "h-9 w-9 md:h-10 md:w-10 rounded-full flex items-center justify-center shrink-0 transition-all",
          "hover:scale-105 active:scale-95",
          isMe
            ? "bg-primary-foreground text-primary hover:bg-primary-foreground/85"
            : "bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:bg-primary/90",
          loading && "opacity-70",
          pending && "opacity-70"
        )}
      >
        {pending ? (
          <Clock className="w-4 h-4" />
        ) : loading ? (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      {/* Волна: бары резиновые (flex-1), клик/тап — seek */}
      <div
        ref={waveRef}
        onPointerDown={seek}
        className="relative flex items-center gap-[2px] flex-1 h-7 md:h-8 min-w-0 cursor-pointer"
      >
        {Array.from({ length: 28 }).map((_, i) => {
          const barProgress = i / 28;
          const h = 6 + ((i * 7) % 14);
          const active = barProgress <= progress;
          return (
            <motion.div
              key={i}
              className="flex-1 min-w-[2px] rounded-full"
              style={{
                height: h,
                background: active
                  ? (isMe ? "var(--primary-foreground)" : "var(--primary)")
                  : (isMe ? "color-mix(in oklch, var(--primary-foreground) 30%, transparent)" : "rgba(255,255,255,0.4)"),
                transformOrigin: "center",
              }}
              animate={playing ? { scaleY: [1, 1 + ((i * 7) % 10) / 10, 1] } : { scaleY: 1 }}
              transition={playing
                ? { repeat: Infinity, duration: 0.7 + (i % 5) * 0.12, ease: "easeInOut", delay: i * 0.04 }
                : { duration: 0.2 }}
            />
          );
        })}
      </div>

      <span className="text-[11px] md:text-xs font-medium opacity-80 shrink-0 tabular-nums w-8 text-right">
        {formatDuration(total)}
      </span>
    </div>
  );
}

function VideoNoteBubble({ msg, onContextMenu, innerRef }: { msg: any; onContextMenu: (e: React.MouseEvent) => void; innerRef: React.RefObject<HTMLDivElement | null> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  function toggle(e: React.MouseEvent) { e.stopPropagation(); if (!videoRef.current) return; playing ? videoRef.current.pause() : videoRef.current.play(); setPlaying(!playing); }
  return (
    <div ref={innerRef} onContextMenu={onContextMenu} onClick={toggle} className="relative w-[160px] h-[160px] rounded-2xl overflow-hidden cursor-pointer bg-black border border-white/5 shadow-lg">
      <video ref={videoRef} src={msg.media_url} className="w-full h-full object-cover" onEnded={() => setPlaying(false)} loop={false} playsInline />
      {!playing && <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px]"><div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg"><Play className="w-5 h-5 text-black ml-0.5" /></div></div>}
      {msg.media_duration != null && <span className="absolute bottom-2.5 right-2.5 text-[10px] font-medium text-white bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-md tabular-nums">{formatDuration(msg.media_duration)}</span>}
    </div>
  );
}

function ImageBubble({ msg, onContextMenu, innerRef }: { msg: any; onContextMenu: (e: React.MouseEvent) => void; innerRef: React.RefObject<HTMLDivElement | null> }) {
  return <div ref={innerRef} onContextMenu={onContextMenu} className="rounded-2xl overflow-hidden max-w-[240px] cursor-pointer border border-white/5 shadow-lg"><img src={msg.media_url} alt="" className="w-full h-auto object-cover" /></div>;
}

// --- Main Component ---

export const MessageBubble = memo(({
  msg, isMe, showAvatar, activeChat, user, onReply, onEdit, onContextMenu, onMentionClick, isDimmed,
  uploadState, onFileOpen, onFileCancel, onFileResume,
  groupSenderName, groupSenderColor, groupSenderAvatar, groupKeyB64,
  onOpenSenderProfile,
}: MessageBubbleProps) => {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const isJumbo = isJumboEmoji(msg.content, msg.type);
  const isMedia = msg.type === "sticker" || msg.type === "gif" || msg.type === "image" || msg.type === "video_note";
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ac = activeChat as any;
  const otherPartyId: string | undefined = ac?.other_user_id ?? ac?.peer_id ?? ac?.user_id ?? ac?.participant_id;

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (rect && onContextMenu) onContextMenu(e, msg, isMe, rect);
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    touchTimeoutRef.current = setTimeout(() => {
      e.preventDefault();
      if (navigator.vibrate) navigator.vibrate(30);

      const rect = bubbleRef.current?.getBoundingClientRect();
      if (rect && onContextMenu) {
        onContextMenu(e as unknown as React.MouseEvent, msg, isMe, rect);
      }
    }, 500);
  };

  const handleTouchEnd = () => {
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current);
      touchTimeoutRef.current = null;
    }
  };

  const handleTouchMove = () => {
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current);
      touchTimeoutRef.current = null;
    }
  };

  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const mentionLink = target.closest('a[data-mention]');
    if (mentionLink) { e.preventDefault(); onMentionClick?.(mentionLink.getAttribute('data-mention') || ""); }
  };

  const isText = msg.type === "text" || msg.type === undefined;
  const isOnlyMention = isText ? /^\s*@[A-Za-z0-9_]{3,20}\s*$/.test(msg.content || "") : false;
  const mentions = isText ? extractMentions(msg.content || "") : [];
  const mentionCards = mentions.map((username, idx) => (
    <MentionMiniCard key={`mention-${String(msg.id || 'no-id')}-${idx}-${username}`} username={username} onClick={onMentionClick} />
  ));

  // 1. ДЛЯ CALL_LOG
  if (msg.type === "call_log") {
    return (
      <div className={cn(
        "flex items-end gap-2 group animate-in fade-in slide-in-from-bottom-3 duration-300",
        "transition-all duration-300 ease-out relative select-none",
        isMe ? "flex-row-reverse" : "flex-row",
        // ЧИСТЫЙ БЛЮР ДЛЯ СОСЕДЕЙ, Z-50 ДЛЯ ЦЕЛЕВОГО. НИКАКИХ RING И SCALE.
        isDimmed ? "blur-[4px] opacity-20 pointer-events-none" : "z-50"
      )}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
          <CallLogMessage status={msg.call_status ?? "missed"} duration={Number(msg.call_duration ?? 0)} timestamp={msg.created_at} isMe={isMe} />
        </div>
      </div>
    );
  }

  if (msg.type === "file") {
    const meta = parseFileMeta(msg?.content);
    // Аудио-ФАЙЛЫ (mime audio/*, честный mime из File.type при отправке)
    // получают встроенный мини-плеер — как mp3 в Telegram. Видео остаётся
    // обычным файл-бабблом с системным открытием.
    // Пока файл ещё льётся (uploadState), pending (очередь) или path пуст —
    // показываем обычный FileBubble: играть нечего.
    const filePending = Boolean(msg?._pending) || isPendingStatus(msg?.status);
    const isAudio = Boolean(meta?.mime?.startsWith("audio/") && meta?.path && !filePending);
    // Ключ = вторая сторона DH (как в handleFileOpen у chat-area):
    // свои → meta.to, входящие → sender_id. Групповое (v=3) — groupKeyB64.
    const fileKeyUserId = keyUserFor(msg, meta?.to, user?.id);
    return (
      <div ref={bubbleRef} onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onTouchMove={handleTouchMove}
        className={cn(
          "flex items-end gap-2 group animate-in fade-in slide-in-from-bottom-3 duration-300 relative select-none [-webkit-touch-callout:none]",
          isMe ? "flex-row-reverse" : "flex-row",
          isDimmed ? "blur-[4px] opacity-20 pointer-events-none" : "z-50"
        )}>
        <div className={cn("flex flex-col min-w-0 max-w-full", isMe ? "items-end" : "items-start")}>
          {isAudio && meta && !uploadState ? (
            <AudioFileBubble meta={meta} isMe={isMe} keyUserId={fileKeyUserId} groupKeyB64={groupKeyB64} />
          ) : (
            <FileBubble msg={msg} isMe={isMe} upload={uploadState}
              onOpen={() => onFileOpen?.(msg)} onCancel={() => onFileCancel?.(msg)} onResume={() => onFileResume?.(msg)} />
          )}
          {isMe && <DeliveryStatus status={msg.status} time={time} className="text-muted-foreground" />}
        </div>
      </div>
    );
  }

  // 1.5. ГОЛОСОВЫЕ СООБЩЕНИЯ (E2EE-аудио в приватном bucket)
  if (msg.type === "voice") {
    const meta = parseVoiceMeta(msg?.content);
    // КЛЮЧ = вторая сторона DH: свои → meta.to (шифровали на получателя),
    // входящие → sender_id (шифровали на нас)
    const keyUserId = isMe ? (meta?.to ?? otherPartyId ?? msg.sender_id) : msg.sender_id;

    if (!keyUserId) {
      return (
        <div className={cn(
          "flex items-end gap-2 group animate-in fade-in slide-in-from-bottom-3 duration-300",
          isMe ? "flex-row-reverse" : "flex-row",
          isDimmed ? "blur-[4px] opacity-20 pointer-events-none" : "z-50"
        )}>
          <div className={cn("flex items-center gap-3 rounded-2xl px-4 py-3 min-w-[210px] bg-zinc-800/80 border border-white/5 text-zinc-400 text-[13px]")}>
            <TbAlertCircle className="w-4 h-4 text-red-400" />
            Голосовое не удалось расшифровать
          </div>
        </div>
      );
    }

    return (
      <div
        ref={bubbleRef}
        onContextMenu={handleContextMenu}
        className={cn(
          "flex items-end gap-2 group animate-in fade-in slide-in-from-bottom-3 duration-300",
          "transition-all duration-300 ease-out relative select-none [-webkit-touch-callout:none]",
          isMe ? "flex-row-reverse" : "flex-row",
          isDimmed ? "blur-[4px] opacity-20 pointer-events-none" : "z-50"
        )}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
          <VoiceBubble
            msg={msg}
            isMe={isMe}
            recipientId={keyUserId}
            groupKeyB64={groupKeyB64}
            pending={Boolean(msg?._pending) || isPendingStatus(msg?.status)}
          />
          {isMe && <DeliveryStatus status={msg.status} time={time} className="text-muted-foreground" />}
        </div>
      </div>
    );
  }

  // 2. ДЛЯ ОБЫЧНЫХ СООБЩЕНИЙ
  // Группа: чужие — слева с авой отправителя; свои — справа без авы.
  const showGroupSender = !isMe && !!groupSenderName;
  return (
    <div className={cn(
      "flex items-end gap-2 group animate-in fade-in slide-in-from-bottom-3 duration-300",
      "transition-all duration-300 ease-out relative",
      isMe ? "flex-row-reverse" : "flex-row",
      // ЧИСТЫЙ БЛЮР ДЛЯ СОСЕДЕЙ, Z-50 ДЛЯ ЦЕЛЕВОГО. НИКАКИХ RING И SCALE.
      isDimmed ? "blur-[4px] opacity-20 pointer-events-none" : "z-50"
    )}>
      {showGroupSender && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenSenderProfile?.(msg.sender_id); }}
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden mb-0.5 cursor-pointer hover:opacity-80 transition-opacity"
          style={{ backgroundColor: groupSenderAvatar?.color || "#27272a", color: "#fff" }}
          title={groupSenderName || undefined}
        >
          {groupSenderAvatar && (groupSenderAvatar.src || groupSenderAvatar.path) ? (
            <SecureAvatar
              src={groupSenderAvatar.src}
              bucket="avatars"
              path={groupSenderAvatar.path || undefined}
              nonce={groupSenderAvatar.nonce}
              mime={groupSenderAvatar.mime}
              fallback={groupSenderAvatar.fallback || groupSenderName?.[0]?.toUpperCase()}
              className="w-full h-full object-cover"
            />
          ) : (
            groupSenderAvatar?.fallback || groupSenderName?.[0]?.toUpperCase() || "?"
          )}
        </button>
      )}
      <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
        <div
          ref={bubbleRef}
          onContextMenu={handleContextMenu}
          className={cn(
            "relative px-3.5 py-2.5 md:px-4 md:py-3 text-[15px] leading-relaxed shadow-sm transition-all duration-200 rounded-2xl",
            isMe ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-zinc-800/80 backdrop-blur-md border border-white/5 text-zinc-100",
            (isJumbo || isMedia) && "bg-transparent border-none shadow-none p-0 rounded-2xl overflow-visible",
            isOnlyMention && "bg-transparent border-none shadow-none p-0 rounded-none"
          )}
        >
          {showGroupSender && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenSenderProfile?.(msg.sender_id); }}
              className="block text-[12px] font-bold leading-tight mb-1 truncate max-w-[220px] cursor-pointer hover:underline"
              style={{ color: groupSenderColor || "#4dabf7" }}
            >
              {groupSenderName}
            </button>
          )}
          {msg.reply_to && (
            <div className={cn("mb-2.5 p-2.5 rounded-xl border-l-2 text-xs backdrop-blur-sm", isMe ? "bg-black/20 border-primary-foreground/50" : "bg-black/30 border-primary")}>
              <div className={cn("font-semibold mb-0.5 truncate", isMe ? "text-primary-foreground/80" : "text-primary")}>
                {msg.reply_to.sender_id === user?.id ? "Вы" : (activeChat.display_name || activeChat.username)}
              </div>
              <div className={cn("truncate", isMe ? "text-primary-foreground/60" : "text-zinc-400")}>
                {messagePreview(msg.reply_to)}
              </div>
            </div>
          )}

          {!isOnlyMention && (
            <div className="relative">
              <div
                className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word]"
                onClick={handleContentClick}
              >
                {renderMessageContent(msg.content, msg.type || "text")}
                {/* Инлайн-футер: в потоке, текст обтекает */}
                <span className={cn(
                  "float-right inline-flex items-center gap-1 pl-2 -mb-1 translate-y-0.5",
                  isMe ? "text-primary-foreground/60" : "text-zinc-500"
                )}>
                {msg.delivery_path && msg.delivery_path !== "direct" && (
                  <span className="opacity-70">{msg.delivery_path === "mesh" ? <MeshIcon className="w-3 h-3" /> : <RelayIcon className="w-3 h-3" />}</span>
                )}
                {msg.is_edited && <TbPencil className="w-3 h-3 opacity-80" />}
                  <span className="text-[10px] font-medium tabular-nums">{time}</span>
                {isMe && (msg.status === "read" ? <CheckCheck className="w-3.5 h-3.5 opacity-90" /> : msg.status === "delivered" ? <CheckCheck className="w-3.5 h-3.5 opacity-70" /> : <Check className="w-3.5 h-3.5 opacity-50" />)}
                </span>
                </div>
            </div>
          )}
          {isOnlyMention && <div className="flex flex-col gap-2">{mentionCards}</div>}
        </div>

        {!isOnlyMention && mentionCards.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 w-full items-start">
            {isMe && <div className="w-full flex justify-end">{mentionCards}</div>}
            {!isMe && mentionCards}
          </div>
        )}
      </div>
    </div>
  );
});
MessageBubble.displayName = "MessageBubble";