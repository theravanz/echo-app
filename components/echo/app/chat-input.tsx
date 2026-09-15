"use client";

import React, { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MediaPicker } from "./media-picker";
import {
  TbSend as Send,
  TbPaperclip as Paperclip,
  TbMoodSmile as Smile,
  TbArrowBackUp as Reply,
  TbEdit as Edit,
  TbX as X,
  TbCheck as Check,
  TbBold as Bold,
  TbItalic as Italic,
  TbCode as Code,
  TbEyeOff as EyeOff,
  TbKeyboard as Keyboard,
  TbChevronDown as ChevronDown,
} from "react-icons/tb";

interface ChatInputProps {
  newMessage: string;
  setNewMessage: (val: string | ((prev: string) => string)) => void;
  replyingTo: any;
  setReplyingTo: (msg: any) => void;
  editingMessage: any;
  setEditingMessage: (msg: any) => void;
  onSend: () => void;
  selectedChat: any;
  user: any;
  isMobile: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  isFullPickerOpen: boolean;
  onToggleFullPicker: () => void;
}

export function ChatInput({
  newMessage, setNewMessage, replyingTo, setReplyingTo, editingMessage, setEditingMessage,
  onSend, selectedChat, user, isMobile, textareaRef, isFullPickerOpen, onToggleFullPicker,
}: ChatInputProps) {
  const localTextareaRef = useRef<HTMLTextAreaElement>(null);
  const taRef = textareaRef || localTextareaRef;
  const dragControls = useDragControls();

  const [isHovering, setIsHovering] = useState(false);
  const [isMobilePickerOpen, setIsMobilePickerOpen] = useState(false);
  const [isMobilePickerExpanded, setIsMobilePickerExpanded] = useState(false);

  useEffect(() => {
    if (editingMessage && taRef.current) taRef.current.focus();
  }, [editingMessage]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (!newMessage || newMessage.trim() === "") {
      el.style.height = "auto";
    } else {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [newMessage]);

  const adjustHeight = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    adjustHeight();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      onSend();
    }
  };

  const cancelAction = () => {
    setReplyingTo(null);
    setEditingMessage(null);
    setNewMessage("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const wrapSelection = (before: string, after: string) => {
    const el = taRef.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const val = typeof newMessage === "string" ? newMessage : "";
    setNewMessage(val.substring(0, start) + before + val.substring(start, end) + after + val.substring(end));
    setTimeout(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = end + before.length;
    }, 0);
  };

  const handleEmojiToggle = () => {
    if (isMobile) {
      if (isMobilePickerOpen) {
        setIsMobilePickerOpen(false);
        setIsMobilePickerExpanded(false);
        taRef.current?.focus();
      } else {
        taRef.current?.blur();
        setIsMobilePickerOpen(true);
      }
    } else {
      onToggleFullPicker();
      setIsHovering(false);
    }
  };

  const hasText = typeof newMessage === "string" && newMessage.trim().length > 0;
  const canSend = hasText || !!editingMessage;

  const handleSendOrCollapse = () => {
    if (isMobile && isMobilePickerOpen && isMobilePickerExpanded) {
      setIsMobilePickerExpanded(false);
    } else {
      onSend();
    }
  };

  const isEmojiActive = isMobile ? isMobilePickerOpen : isFullPickerOpen;

  return (
    <footer
      className={cn(
        "flex flex-col shrink-0 px-2 pb-2 md:px-6 lg:px-10 md:pb-4 relative z-30",
        isMobile && "safe-bottom"
      )}
    >
      <AnimatePresence>
        {(replyingTo || editingMessage) && (
          <motion.div
            key={replyingTo ? `reply-${replyingTo.id}` : `edit-${editingMessage.id}`}
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: 8, height: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 400 }}
            className="overflow-hidden mb-2.5"
          >
            <div className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-2xl border backdrop-blur-xl",
              replyingTo ? "bg-zinc-900/70 border-white/[0.08]" : "bg-primary/[0.08] border-primary/20"
            )}>
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", replyingTo ? "bg-white/[0.06]" : "bg-primary/15")}>
                {replyingTo ? <Reply className="w-4 h-4 text-primary" /> : <Edit className="w-4 h-4 text-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary mb-0.5">
                  {replyingTo ? `Ответ: ${replyingTo.sender_id === user?.id ? "Себе" : selectedChat?.display_name || selectedChat?.username}` : "Редактирование"}
                </div>
                <div className="text-[13px] text-zinc-400 truncate leading-snug">
                  {replyingTo ? replyingTo.content : editingMessage?.content}
                </div>
              </div>
              <button onClick={cancelAction} className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "flex items-end gap-1.5 md:gap-2 rounded-[22px] md:rounded-[26px] border backdrop-blur-xl transition-all duration-300",
          "bg-zinc-900/60 border-white/[0.08]",
          "focus-within:border-primary/40 focus-within:bg-zinc-900/80 focus-within:shadow-lg focus-within:shadow-primary/[0.03]",
          "px-1.5 py-1.5 md:px-2.5 md:py-2"
        )}
      >
        <div className="flex items-center shrink-0 gap-0.5 mb-0.5">
          <Button variant="ghost" size="icon" className="w-9 h-9 md:w-10 md:h-10 rounded-xl text-zinc-500 hover:text-primary hover:bg-primary/10 transition-colors">
            <Paperclip className="w-[18px] h-[18px]" />
          </Button>

          <div
            className="relative"
            onMouseEnter={() => !isMobile && !isFullPickerOpen && setIsHovering(true)}
            onMouseLeave={() => !isMobile && setIsHovering(false)}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={handleEmojiToggle}
              className={cn(
                "w-9 h-9 md:w-10 md:h-10 rounded-xl transition-all duration-300",
                isEmojiActive
                  ? "bg-primary/15 text-primary scale-95"
                  : "text-zinc-500 hover:text-primary hover:bg-primary/10"
              )}
            >
              {isMobile && isMobilePickerOpen ? <Keyboard className="w-[18px] h-[18px]" /> : <Smile className="w-[18px] h-[18px]" />}
            </Button>

            <AnimatePresence>
              {!isMobile && !isFullPickerOpen && isHovering && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute bottom-full left-0 mb-2 w-[340px] h-[420px] z-50 shadow-2xl"
                >
                  <MediaPicker onEmojiSelect={(e) => setNewMessage(prev => prev + e)} onStickerSelect={() => {}} onGifSelect={() => {}} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex-1 min-w-0 relative">
          <AnimatePresence>
            {hasText && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.9 }}
                transition={{ duration: 0.15 }}
                className="absolute -top-11 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-1 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-xl z-50"
              >
                <FmtBtn title="Bold" onClick={() => wrapSelection("**", "**")}><Bold className="w-3.5 h-3.5" /></FmtBtn>
                <FmtBtn title="Italic" onClick={() => wrapSelection("*", "*")}><Italic className="w-3.5 h-3.5" /></FmtBtn>
                <FmtBtn title="Code" onClick={() => wrapSelection("`", "`")}><Code className="w-3.5 h-3.5" /></FmtBtn>
                <div className="w-px h-3.5 bg-white/10 mx-0.5" />
                <FmtBtn title="Spoiler" onClick={() => wrapSelection("||", "||")}><EyeOff className="w-3.5 h-3.5" /></FmtBtn>
              </motion.div>
            )}
          </AnimatePresence>

          <textarea
            ref={taRef}
            rows={1}
            placeholder={editingMessage ? "Изменить сообщение..." : "Написать сообщение..."}
            value={typeof newMessage === "string" ? newMessage : ""}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (isMobile) setIsMobilePickerOpen(false); }}
            className="w-full bg-transparent border-none py-2 px-2 text-[15px] font-medium resize-none outline-none focus:ring-0 placeholder:text-zinc-600 leading-relaxed scrollbar-hide text-foreground max-h-[160px]"
          />
        </div>

        <button
          onClick={handleSendOrCollapse}
          disabled={!canSend && !(isMobile && isMobilePickerOpen && isMobilePickerExpanded)}
          className={cn(
            "shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center transition-all duration-300 mb-0.5",
            (isMobile && isMobilePickerOpen && isMobilePickerExpanded)
              ? "bg-white/[0.08] text-white hover:bg-white/[0.15] scale-95"
              : canSend
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:scale-105 active:scale-95"
                : "bg-white/[0.04] text-zinc-700 cursor-default"
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {isMobile && isMobilePickerOpen && isMobilePickerExpanded ? (
              <motion.div key="down" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}>
                <ChevronDown className="w-[18px] h-[18px]" />
              </motion.div>
            ) : editingMessage ? (
              <motion.div key="check" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}>
                <Check className="w-[18px] h-[18px]" />
              </motion.div>
            ) : (
              <motion.div key="send" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}>
                <Send className="w-[18px] h-[18px]" />
              </motion.div>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* РАСПОРКА: чтобы пикер в компактном режиме толкал инпут вверх */}
      {isMobile && isMobilePickerOpen && !isMobilePickerExpanded && (
        <div style={{ height: '42dvh' }} className="shrink-0" />
      )}

      {/* САМ ПИКЕР (Плавно следует за пальцем и отскакивает) */}
      <AnimatePresence>
        {isMobile && isMobilePickerOpen && (
          <motion.div
            drag="y"
            dragControls={dragControls}
            dragListener={false} // Отключаем дефолтный слушатель, чтобы скролл внутри не сворачивал меню
            dragSnapToOrigin // МАГИЯ: Всегда плавно возвращает на исходную позицию после отпускания
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.2, bottom: 0.5 }}
            onDragEnd={(e, info) => {
              if (info.offset.y < -50 || info.velocity.y < -300) {
                setIsMobilePickerExpanded(true);
              } else if (info.offset.y > 50 || info.velocity.y > 300) {
                if (isMobilePickerExpanded) {
                  setIsMobilePickerExpanded(false);
                } else {
                  setIsMobilePickerOpen(false);
                  taRef.current?.focus();
                }
              }
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0, height: isMobilePickerExpanded ? '92dvh' : '42dvh' }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-900 border-t border-white/10 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Ручка для свайпа. Событие старта перетаскивания вешается ТОЛЬКО на неё */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="w-full pt-3 pb-2 flex justify-center cursor-grab active:cursor-grabbing shrink-0 touch-none"
            >
              <div className="w-12 h-1.5 bg-white/20 rounded-full" />
            </div>

            <div className="flex-1 overflow-hidden p-2">
              <MediaPicker onEmojiSelect={(e) => setNewMessage(prev => prev + e)} onStickerSelect={() => {}} onGifSelect={() => {}} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </footer>
  );
}

function FmtBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void; }) {
  return (
    <button onClick={onClick} title={title} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
      {children}
    </button>
  );
}