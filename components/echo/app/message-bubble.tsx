"use client";

import React, { memo, useCallback, Fragment } from 'react';
import { cn } from "@/lib/utils";
import { LinkPreview } from "./link-preview";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  TbCheck as Check,
  TbChecks as CheckCheck,
  TbArrowBackUp as Reply,
  TbHeart as Heart,
  TbPencil as Pen,
  TbClock as Clock,
  TbTrash as Trash,
  TbCopy as Copy,
  TbFlag as Flag,
  TbShare as Share,
  TbExternalLink as ExternalLink,
} from "react-icons/tb";

interface MessageBubbleProps {
  msg: any;
  isMe: boolean;
  showAvatar: boolean;
  activeChat: any;
  user: any;
  onReply: (msg: any) => void;
  onEdit: (msg: any) => void;
}

/**
 * Безопасный рендеринг форматированного текста.
 * Собирает React-элементы вместо dangerouslySetInnerHTML.
 * Все пользовательские данные экранируются через React-рендеринг.
 */
interface TextSegment {
  type: 'text' | 'bold' | 'italic' | 'boldItalic' | 'code' | 'codeBlock' | 'spoiler' | 'strikethrough' | 'url';
  content: string;
}

const parseFormatting = (text: string): TextSegment[] => {
  if (!text) return [];
  
  const segments: TextSegment[] = [];
  // Regex для markdown-like форматирования (безопасный парсинг, не HTML)
  const pattern = /(\|\|(.*?)\|\|)|(```([\s\S]*?)```)|(`(.*?)`)|(\*\*\*(.*?)\*\*\*)|(\*\*(.*?)\*\*)|(\*(.*?)\*)|(~~(.*?)~~)|((https?:\/\/[^\s]+))/g;
  
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Текст до совпадения
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    // Определяем тип совпадения по группам
    if (match[1]) segments.push({ type: 'spoiler', content: match[2] });           // ||spoiler||
    else if (match[3]) segments.push({ type: 'codeBlock', content: match[4] });    // ```code```
    else if (match[5]) segments.push({ type: 'code', content: match[6] });         // `code`
    else if (match[7]) segments.push({ type: 'boldItalic', content: match[8] });   // ***text***
    else if (match[9]) segments.push({ type: 'bold', content: match[10] });         // **text**
    else if (match[11]) segments.push({ type: 'italic', content: match[12] });     // *text*
    else if (match[13]) segments.push({ type: 'strikethrough', content: match[14] }); // ~~text~~
    else if (match[15]) segments.push({ type: 'url', content: match[15] });         // https://...

    lastIndex = match.index + match[0].length;
  }

  // Остаток текста
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments;
};

const renderSegment = (seg: TextSegment, key: number): React.ReactNode => {
  switch (seg.type) {
    case 'bold':
      return <strong key={key}>{seg.content}</strong>;
    case 'italic':
      return <em key={key}>{seg.content}</em>;
    case 'boldItalic':
      return <strong key={key}><em>{seg.content}</em></strong>;
    case 'code':
      return <code key={key} className="bg-black/20 px-1 rounded font-mono text-xs">{seg.content}</code>;
    case 'codeBlock':
      return <pre key={key} className="bg-black/30 p-2 rounded-lg font-mono text-xs my-2 overflow-x-auto"><code>{seg.content}</code></pre>;
    case 'spoiler':
      return <span key={key} className="bg-foreground/20 text-transparent hover:text-inherit rounded px-1 transition-colors cursor-help" title="Spoiler">{seg.content}</span>;
    case 'strikethrough':
      return <del key={key}>{seg.content}</del>;
    case 'url':
      return (
        <Fragment key={key}>
          <a href={seg.content} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{seg.content}</a>
          <LinkPreview url={seg.content} />
        </Fragment>
      );
    default:
      return <span key={key}>{seg.content}</span>;
  }
};

const renderFormattedText = (text: string): React.ReactNode => {
  if (!text) return null;
  const segments = parseFormatting(text);
  return segments.map((seg, i) => renderSegment(seg, i));
};

// Simple emoji detection without regex surrogates
const isEmoji = (char: string): boolean => {
  const cp = char.codePointAt(0) || 0;
  return cp >= 0x2000 && cp <= 0x33000 || cp === 0xa9 || cp === 0xae;
};

const isJumboEmoji = (content: string, type: string) => {
  if (type !== 'text' && type !== undefined) return false;
  const trimmed = content.trim();
  if ([...trimmed].length !== 1) return false;
  return isEmoji(trimmed);
};

const renderMessageContent = (content: string, type: string) => {
  if (type === "sticker" || type === "gif") {
    return <img src={content} alt="Media" className="max-w-[200px] rounded-2xl shadow-lg" />;
  }
  if (isJumboEmoji(content, type)) {
    const hex = Array.from(content).map(c => c.codePointAt(0)?.toString(16)).join('-');
    return (
      <img src={`https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.gif`}
        alt={content} className="w-24 h-24" loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).src = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${hex}.svg`; }}
      />
    );
  }
  return renderFormattedText(content);
};

export const MessageBubble = memo(({ msg, isMe, showAvatar, activeChat, user, onReply, onEdit }: MessageBubbleProps) => {
  const isJumbo = isJumboEmoji(msg.content, msg.type);
  const isMedia = msg.type === "sticker" || msg.type === "gif";
  const displayContent = msg._pendingContent || msg.content;

  const hReply = useCallback(() => onReply(msg), [msg, onReply]);
  const hEdit = useCallback(() => onEdit(msg), [msg, onEdit]);
  const hCopy = useCallback(() => navigator.clipboard.writeText(msg.content).catch(() => {}), [msg.content]);
  const hShare = useCallback(() => navigator.share?.({ text: msg.content }).catch(() => {}), [msg.content]);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className={"flex items-end gap-3 group animate-message-in " + (isMe ? "flex-row-reverse" : "flex-row")}>
          <div className={"flex flex-col " + (isMe ? "items-end" : "items-start")}>
            <div className={"relative p-4 md:p-5 rounded-[32px] text-sm leading-relaxed max-w-[90%] md:max-w-[85%] transition-all duration-500 shadow-2xl group/bubble "
              + (isMe ? "bg-primary text-primary-foreground rounded-br-none shadow-primary/10 " : "bg-white/5 border border-white/5 rounded-bl-none shadow-black/60 backdrop-blur-md ")
              + ((isJumbo || isMedia) ? "bg-transparent border-none shadow-none p-0" : "")}>
              {msg.reply_to && (
                <div className="mb-2 p-2 bg-black/20 rounded-xl border-l-2 border-primary text-xs opacity-60">
                  <div className="font-bold mb-1">{msg.reply_to.sender_id === user.id ? "You" : (activeChat.display_name || activeChat.username)}</div>
                  <div className="truncate">{msg.reply_to.content}</div>
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{renderMessageContent(displayContent, msg.type || "text")}</div>
              <div className={"flex items-center gap-2 mt-2 opacity-40 text-[9px] font-mono font-bold uppercase tracking-widest "
                + (isMe ? "justify-end" : "justify-start") + " "
                + ((isJumbo || isMedia) ? "opacity-60 drop-shadow-md" : "")}>
                {msg.is_edited && <Pen className="w-2.5 h-2.5 mr-1" />}
                <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                {isMe && msg.status === "pending" && <Clock className="w-3 h-3 text-muted-foreground animate-pulse" />}
                {isMe && msg.status === "sent" && <Check className="w-3 h-3" />}
                {isMe && msg.status === "read" && <CheckCheck className="w-3 h-3 text-white" />}
              </div>
              <div className={"absolute top-0 opacity-0 group-hover/bubble:opacity-100 transition-opacity flex items-center gap-1 p-1 bg-card border border-white/10 rounded-full shadow-2xl z-20 "
                + (isMe ? "right-full mr-3" : "left-full ml-3")}>
                <button className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors" onClick={hReply}><Reply className="w-4 h-4" /></button>
                <button className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-red-400 transition-colors"><Heart className="w-4 h-4" /></button>
                {isMe && <button className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors" onClick={hEdit}><Pen className="w-4 h-4" /></button>}
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={hReply} className="gap-3">
          <Reply className="w-4 h-4 opacity-60" />
          <span>Reply</span>
        </ContextMenuItem>
        {isMe && !isMedia && (
          <ContextMenuItem onClick={hEdit} className="gap-3">
            <Pen className="w-4 h-4 opacity-60" />
            <span>Edit</span>
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={hCopy} className="gap-3">
          <Copy className="w-4 h-4 opacity-60" />
          <span>Copy Text</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={hShare} className="gap-3">
          <Share className="w-4 h-4 opacity-60" />
          <span>Forward</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {isMe ? (
          <ContextMenuItem
            onClick={async () => {
              try {
                const { createClient } = await import('@supabase/supabase-js');
                const sb = createClient(
                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
                );
                await sb.from('messages').delete().eq('id', msg.id);
              } catch (e) { console.error('Delete failed:', e); }
            }}
            variant="destructive"
            className="gap-3"
          >
            <Trash className="w-4 h-4" />
            <span>Delete</span>
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => alert('Report submitted')} className="gap-3">
            <Flag className="w-4 h-4 opacity-60" />
            <span>Report</span>
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});
MessageBubble.displayName = "MessageBubble";
