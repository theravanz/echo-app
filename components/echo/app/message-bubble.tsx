"use client";

import React, { memo } from 'react';
import { cn } from "@/lib/utils";
import { LinkPreview } from "./link-preview";
import { TbCheck as Check, TbChecks as CheckCheck, TbArrowBackUp as Reply, TbHeart as Heart, TbDotsVertical as MoreVertical, TbPencil as Pen } from "react-icons/tb";
import { Button } from "@/components/ui/button";

interface MessageBubbleProps {
  msg: any;
  isMe: boolean;
  showAvatar: boolean;
  activeChat: any;
  user: any;
  onReply: (msg: any) => void;
  onEdit: (msg: any) => void;
}

const renderFormattedText = (text: string) => {
  if (!text) return null;
  
  // Basic markdown-like formatting
  let formatted = text
    .replace(/\|\|(.*?)\|\|/g, '<span class="bg-foreground/20 text-transparent hover:text-inherit rounded px-1 transition-colors cursor-help" title="Spoiler">$1</span>')
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-black/30 p-2 rounded-lg font-mono text-xs my-2 overflow-x-auto"><code>$1</code></pre>')
    .replace(/`(.*?)`/g, '<code class="bg-black/20 px-1 rounded font-mono text-xs">$1</code>')
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/~~(.*?)~~/g, '<del>$1</del>');

  // Split by URLs to insert previews
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
  if (type !== 'text' && type !== undefined) return false;
  const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
  const trimmed = content.trim();
  const matches = trimmed.match(emojiRegex);
  return matches && matches.length === 1 && matches[0] === trimmed;
};

const renderMessageContent = (content: string, type: string) => {
  if (type === 'sticker' || type === 'gif') {
    return <img src={content} alt="Media" className="max-w-[200px] rounded-2xl shadow-lg" />;
  }

  const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
  const isJumbo = isJumboEmoji(content, type);
  
  if (isJumbo) {
    const hex = Array.from(content).map(c => c.codePointAt(0)?.toString(16)).join('-');
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

export const MessageBubble = memo(({ 
  msg, isMe, showAvatar, activeChat, user, onReply, onEdit 
}: MessageBubbleProps) => {
  const isJumbo = isJumboEmoji(msg.content, msg.type);
  const isMedia = msg.type === 'sticker' || msg.type === 'gif';

  return (
    <div className={cn(
      "flex items-end gap-3 group animate-in fade-in slide-in-from-bottom-4 duration-500",
      isMe ? "flex-row-reverse" : "flex-row"
    )}>
      <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
        <div className={cn(
          "relative p-4 md:p-5 rounded-[32px] text-sm leading-relaxed max-w-[90%] md:max-w-[85%] transition-all duration-500 shadow-2xl group/bubble",
          isMe 
            ? "bg-primary text-primary-foreground rounded-br-none shadow-primary/10" 
            : "bg-white/5 border border-white/5 rounded-bl-none shadow-black/60 backdrop-blur-md",
          (isJumbo || isMedia) && "bg-transparent border-none shadow-none p-0"
        )}>
          {msg.reply_to && (
             <div className="mb-2 p-2 bg-black/20 rounded-xl border-l-2 border-primary text-xs opacity-60">
                <div className="font-bold mb-1">{msg.reply_to.sender_id === user.id ? 'You' : (activeChat.display_name || activeChat.username)}</div>
                <div className="truncate">{msg.reply_to.content}</div>
             </div>
          )}
          
          <div className="whitespace-pre-wrap break-words">
            {renderMessageContent(msg.content, msg.type || 'text')}
          </div>

          <div className={cn(
            "flex items-center gap-2 mt-2 opacity-40 text-[9px] font-mono font-bold uppercase tracking-widest",
            isMe ? "justify-end" : "justify-start",
            (isJumbo || isMedia) && "opacity-60 drop-shadow-md"
          )}>
            {msg.is_edited && <Pen className="w-2.5 h-2.5 mr-1" />}
            <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {isMe && (msg.status === 'read' ? <CheckCheck className="w-3 h-3 text-primary-foreground" /> : <Check className="w-3 h-3" />)}
          </div>
          
          {/* Hover Actions */}
          <div className={cn(
            "absolute top-0 opacity-0 group-hover/bubble:opacity-100 transition-opacity flex items-center gap-1 p-1 bg-card border border-white/10 rounded-full shadow-2xl z-20",
            isMe ? "right-full mr-3" : "left-full ml-3"
          )}>
             <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full hover:bg-white/10" onClick={() => onReply(msg)}>
                <Reply className="w-4 h-4" />
             </Button>
             <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full hover:bg-white/10">
                <Heart className="w-4 h-4 hover:text-red-500" />
             </Button>
             {isMe && (
               <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full hover:bg-white/10" onClick={() => onEdit(msg)}>
                  <Pen className="w-4 h-4" />
               </Button>
             )}
             <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full hover:bg-white/10">
                <MoreVertical className="w-4 h-4" />
             </Button>
          </div>
        </div>
      </div>
    </div>
  );
});
MessageBubble.displayName = "MessageBubble";
