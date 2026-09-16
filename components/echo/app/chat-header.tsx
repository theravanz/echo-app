"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  TbArrowLeft,
  TbDotsVertical,
  TbUser,
  TbPalette,
  TbTrash,
} from "react-icons/tb";
import type { Chat, UserProfile, NetworkMode } from "@/hooks/echo/types";
import { SecureAvatar } from "./secure-avatar";

interface ChatHeaderProps {
  selectedChat: Chat | null;
  isMobile: boolean;
  activeMode: NetworkMode;
  user: UserProfile | null;
  isOnline: boolean;
  lastSeenLabel?: string | null;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenBgPicker: () => void;
  onClearChat: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  selectedChat,
  isMobile,
  onBack,
  onOpenProfile,
  onOpenBgPicker,
  onClearChat,
  isOnline,
  lastSeenLabel,
}: ChatHeaderProps) {
  if (!selectedChat) return null;

  const statusText = isOnline
    ? "в сети"
    : (lastSeenLabel ? `был(а) ${lastSeenLabel}` : "не в сети");

  return (
    <header
      className={cn(
        "flex items-center bg-black/10 backdrop-blur-2xl border-b border-white/5 relative z-20 w-full overflow-hidden shrink-0",
        isMobile ? "h-auto pb-3 safe-pt-header px-3" : "h-20 px-6"
      )}
    >
      {/* Кнопка "Назад" */}
      {isMobile && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="rounded-xl text-zinc-400 shrink-0 mr-3 hover:bg-white/5"
        >
          <TbArrowLeft style={{ width: 20, height: 20 }} />
        </Button>
      )}

      {/* Аватар */}
      <div
        onClick={onOpenProfile}
        className="rounded-full border border-white/10 flex items-center justify-center text-sm font-bold shadow-md shrink-0 mr-3 cursor-pointer overflow-hidden"
        style={{
          width: isMobile ? 40 : 44,
          height: isMobile ? 40 : 44,
          backgroundColor: selectedChat.avatar_color || "#27272a",
          color: selectedChat.avatar_color ? "white" : "#a1a1aa",
        }}
      >
        {selectedChat.avatar_url || selectedChat.avatar_storage_path ? (
          <SecureAvatar
            src={selectedChat.avatar_url}
            bucket="avatars"
            path={selectedChat.avatar_storage_path || undefined}
            nonce={selectedChat.avatar_nonce}
            mime={selectedChat.avatar_mime}
            className="w-full h-full object-cover"
          />
        ) : (
          (selectedChat.display_name?.[0] || selectedChat.username?.[0] || "U").toUpperCase()
        )}
      </div>

      {/* Текст: Имя + Статус */}
      <div
        onClick={onOpenProfile}
        className="flex-1 min-w-0 max-w-full overflow-hidden mr-3 cursor-pointer"
      >
        <div className="block max-w-full text-white whitespace-nowrap overflow-hidden text-ellipsis font-semibold" style={{ fontSize: isMobile ? 15 : 17 }}>
          {selectedChat.display_name || selectedChat.username}
        </div>
        <div
          className="block max-w-full whitespace-nowrap overflow-hidden text-ellipsis transition-colors"
          style={{
            fontSize: isMobile ? 11 : 12,
            fontFamily: "monospace",
            color: isOnline ? "#22c55e" : "rgba(161,161,170,0.8)",
          }}
        >
          {statusText}
        </div>
      </div>

      {/* Правая часть */}
      <div className="flex items-center shrink-0" style={{ gap: isMobile ? 8 : 16 }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-xl text-zinc-400 shrink-0 hover:bg-white/5"
            >
              <TbDotsVertical style={{ width: 20, height: 20 }} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-52 bg-zinc-950/90 backdrop-blur-2xl border border-white/10 rounded-2xl p-1.5 shadow-2xl"
          >
            <DropdownMenuItem onClick={onOpenProfile} className="rounded-xl p-2.5 text-sm cursor-pointer">
              <TbUser className="w-4 h-4 mr-3 text-zinc-400" /> Профиль
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenBgPicker} className="rounded-xl p-2.5 text-sm cursor-pointer">
              <TbPalette className="w-4 h-4 mr-3 text-zinc-400" /> Сменить фон
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/5 my-1" />
            <DropdownMenuItem
              onClick={() => { if (window.confirm("Удалить переписку?")) onClearChat(); }}
              className="rounded-xl p-2.5 text-sm cursor-pointer text-red-500"
            >
              <TbTrash className="w-4 h-4 mr-3" /> Очистить чат
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
});