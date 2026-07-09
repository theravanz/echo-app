"use client";

import React, { memo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { LinkPreview } from "./link-preview";
import {
  TbCheck as Check,
  TbChecks as CheckCheck,
  TbGitBranch as MeshIcon,
  TbRelationOneToOne as RelayIcon,
  TbPlayerPlayFilled as Play,
  TbPlayerPauseFilled as Pause,
} from "react-icons/tb";

interface MessageBubbleProps {
  msg: any;
  isMe: boolean;
  showAvatar: boolean;
  activeChat: any;
  user: any;
  onReply: (msg: any) => void;
  onEdit: (msg: any) => void;
  onContextMenu: (e: React.MouseEvent, msg: any, isMine: boolean, rect: DOMRect) => void;
}

const renderFormattedText = (text: string) => {
  if (!text) return null;

  let formatted = text
    .replace(/\|\|(.*?)\|\|/g, '<span class="bg-foreground/20 text-transparent hover:text-inherit rounded px-1 transition-colors cursor-help" title="Spoiler">$1</span>')
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-black/30 p-2 rounded-lg font-mono text-xs my-2 overflow-x-auto"><code>$1</code></pre>')
    .replace(/`(.*?)`/g, '<code class="bg-black/20 px-1 rounded font-mono text-xs">$1</code>')
    .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/~~(.*?)~~/g, "<del>$1</del>");

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = formatted.split(urlRegex);

  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <div key={i} className="my-1">
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

const renderMessageContent = (content: string, type: string) => {
  if (type === "sticker" || type === "gif") {
    return <img src={content} alt="Media" className="max-w-[200px] rounded-2xl shadow-lg" />;
  }

  const isJumbo = isJumboEmoji(content, type);
  if (isJumbo) {
    const hex = Array.from(content).map((c) => c.codePointAt(0)?.toString(16)).join("-");
    return (
      <img
        src={`https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.gif`}
        alt={content}
        className="w-24 h-24"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).src = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${hex}.svg`;
        }}
      />
    );
  }

  return renderFormattedText(content);
};

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function MessageMeta({
  isMe,
  time,
  status,
  deliveryPath,
}: {
  isMe: boolean;
  time: string;
  status?: "sent" | "delivered" | "read";
  deliveryPath?: "direct" | "mesh" | "relay";
}) {
  return (
    <div className={cn("flex items-center gap-1.5 mt-1 px-1 text-[10px] text-white/35", isMe ? "flex-row-reverse" : "flex-row")}>
      {deliveryPath && deliveryPath !== "direct" && (
        <span className="flex items-center gap-1">
          {deliveryPath === "mesh" ? <MeshIcon className="w-2.5 h-2.5" /> : <RelayIcon className="w-2.5 h-2.5" />}
          {deliveryPath}
        </span>
      )}
      <span>{time}</span>
      {isMe &&
        (status === "read" ? (
          <CheckCheck className="w-3 h-3 text-primary" />
        ) : status === "delivered" ? (
          <CheckCheck className="w-3 h-3" />
        ) : (
          <Check className="w-3 h-3" />
        ))}
    </div>
  );
}

function VoiceBubble({
  msg,
  isMe,
  onContextMenu,
  innerRef,
}: {
  msg: any;
  isMe: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  innerRef: React.RefObject<HTMLDivElement>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const duration = msg.media_duration ?? 0;

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  }

  return (
    <div
      ref={innerRef}
      onContextMenu={onContextMenu}
      className={cn(
        "flex items-center gap-2.5 rounded-full px-3.5 py-2.5 min-w-[160px]",
        isMe ? "bg-primary-foreground/95 text-black" : "bg-white/[0.06] border border-white/[0.07] backdrop-blur-md text-white"
      )}
    >
      <audio
        ref={audioRef}
        src={msg.media_url}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (duration || e.currentTarget.duration || 1))}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        hidden
      />
      <button
        onClick={toggle}
        className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", isMe ? "bg-black text-white" : "bg-white text-black")}
      >
        {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </button>
      <div className="relative flex items-center gap-[2px] flex-1 h-4">
        {Array.from({ length: 18 }).map((_, i) => {
          const barProgress = i / 18;
          const active = barProgress <= progress;
          const h = 4 + ((i * 7) % 12);
          return (
            <div
              key={i}
              className="w-[2px] rounded-sm"
              style={{ height: h, background: active ? (isMe ? "#000" : "currentColor") : isMe ? "#00000040" : "#ffffff40" }}
            />
          );
        })}
      </div>
      <span className="text-[10px] opacity-70 shrink-0">{formatDuration(duration)}</span>
    </div>
  );
}

function VideoNoteBubble({ msg, onContextMenu, innerRef }: { msg: any; onContextMenu: (e: React.MouseEvent) => void; innerRef: React.RefObject<HTMLDivElement> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.pause();
    else v.play();
    setPlaying(!playing);
  }

  return (
    <div ref={innerRef} onContextMenu={onContextMenu} onClick={toggle} className="relative w-[150px] h-[150px] rounded-full overflow-hidden cursor-pointer bg-black">
      <video ref={videoRef} src={msg.media_url} className="w-full h-full object-cover" onEnded={() => setPlaying(false)} loop={false} playsInline />
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="w-3.5 h-3.5 text-black" />
          </div>
        </div>
      )}
      {msg.media_duration != null && (
        <span className="absolute bottom-2.5 right-3.5 text-[9px] text-white bg-black/40 px-1.5 py-0.5 rounded-full">{formatDuration(msg.media_duration)}</span>
      )}
    </div>
  );
}

function ImageBubble({ msg, onContextMenu, innerRef }: { msg: any; onContextMenu: (e: React.MouseEvent) => void; innerRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div ref={innerRef} onContextMenu={onContextMenu} className="rounded-[24px] overflow-hidden max-w-[260px] cursor-pointer">
      <img src={msg.media_url} alt="" className="w-full h-auto object-cover" />
    </div>
  );
}

export const MessageBubble = memo(({ msg, isMe, showAvatar, activeChat, user, onReply, onEdit, onContextMenu }: MessageBubbleProps) => {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const isJumbo = isJumboEmoji(msg.content, msg.type);
  const isMedia = msg.type === "sticker" || msg.type === "gif";

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (rect) onContextMenu(e, msg, isMe, rect);
  }

  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={cn("flex items-end gap-3 group animate-in fade-in slide-in-from-bottom-4 duration-500", isMe ? "flex-row-reverse" : "flex-row")}>
      <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
        {msg.type === "voice" ? (
          <VoiceBubble msg={msg} isMe={isMe} onContextMenu={handleContextMenu} innerRef={bubbleRef} />
        ) : msg.type === "video_note" ? (
          <VideoNoteBubble msg={msg} onContextMenu={handleContextMenu} innerRef={bubbleRef} />
        ) : msg.type === "image" ? (
          <ImageBubble msg={msg} onContextMenu={handleContextMenu} innerRef={bubbleRef} />
        ) : (
          <div
            ref={bubbleRef}
            onContextMenu={handleContextMenu}
            className={cn(
              "relative p-4 md:p-5 rounded-[32px] text-sm leading-relaxed max-w-[90%] md:max-w-[85%] transition-all duration-300 shadow-2xl cursor-default",
              isMe
                ? "bg-primary text-primary-foreground rounded-br-none shadow-primary/10"
                : "bg-white/[0.06] border border-white/[0.07] backdrop-blur-md rounded-bl-none shadow-black/60",
              (isJumbo || isMedia) && "bg-transparent border-none shadow-none p-0"
            )}
          >
            {msg.reply_to && (
              <div className="mb-2 p-2 bg-black/20 rounded-xl border-l-2 border-primary text-xs opacity-70">
                <div className="font-bold mb-1">{msg.reply_to.sender_id === user.id ? "Вы" : activeChat.display_name || activeChat.username}</div>
                <div className="truncate">{msg.reply_to.content}</div>
              </div>
            )}
            <div className="whitespace-pre-wrap break-words">{renderMessageContent(msg.content, msg.type || "text")}</div>
          </div>
        )}

        <MessageMeta isMe={isMe} time={time} status={msg.status} deliveryPath={msg.delivery_path} />
      </div>
    </div>
  );
});
MessageBubble.displayName = "MessageBubble";
