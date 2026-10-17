"use client";

import { motion } from "framer-motion";
import {
  TbMessageCircle as AllChatsIcon,
  TbFolderPlus as AddFolderIcon,
  TbFolder as FolderIcon,
  TbAdjustmentsHorizontal as FoldersSettingsIcon,
} from "react-icons/tb";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface ChatFolder {
  id: string;
  name: string;
}

interface AppNavRailProps {
  activeFolderId?: string;
  folders?: ChatFolder[];
  onSelectFolder?: (folderId: string) => void;
  onCreateFolder?: (folderName: string) => void;
  onOpenFolderSettings?: () => void;
}

export function AppNavRail({
  activeFolderId = "all",
  folders = [],
  onSelectFolder,
  onCreateFolder,
  onOpenFolderSettings,
}: AppNavRailProps) {
  const handleAddFolderClick = () => {
    if (onCreateFolder) {
      // Если проп передан извне
      onCreateFolder("Новая папка");
    } else {
      // Пока функционал в разработке:
      toast.info("Создание папок скоро");
    }
  };

  return (
    <aside className="hidden md:flex w-20 h-full flex-col items-center justify-between py-5 border-r border-white/5 bg-zinc-950/80 backdrop-blur-2xl shrink-0 z-30 select-none relative">
      {/* ── 1. Верхняя часть: Логотип + Папки ── */}
{/* ── 1. Верхняя часть: Логотип + Папки ── */}
<div className="flex flex-col items-center gap-5 w-full">
  {/* Увеличенный логотип (44x44px) */}
  <div className="group cursor-pointer p-1 flex items-center justify-center hover:scale-105 transition-transform duration-300">
    <img
      src="/logo.png"
      alt="Echo"
      className="w-11 h-11 object-contain brightness-125 opacity-90 group-hover:opacity-100 transition-all duration-300 drop-shadow-[0_0_12px_rgba(255,255,255,0.15)]"
    />
  </div>

  <div className="w-9 h-[1px] bg-white/10 my-0.5" />

        {/* Список папок чатов */}
        <div className="flex flex-col items-center gap-3 w-full px-2 overflow-y-auto max-h-[calc(100vh-180px)] scrollbar-hide">
          {/* Главная папка: Все чаты */}
          <button
            title="Все чаты"
            onClick={() => onSelectFolder?.("all")}
            className={cn(
              "relative rounded-2xl flex items-center justify-center transition-all duration-200 group shrink-0",
              activeFolderId === "all"
                ? "bg-primary/15 text-primary border border-primary/25 shadow-lg shadow-primary/10"
                : "text-white/40 hover:text-white hover:bg-white/5"
            )}
            style={{ width: "52px", height: "52px" }}
          >
            <AllChatsIcon className="w-6 h-6 transition-transform group-hover:scale-110" />

            {activeFolderId === "all" && (
              <motion.div
                layoutId="activeFolderPill"
                className="absolute -left-3.5 w-1.5 h-6 bg-primary rounded-r-full"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
          </button>

          {/* Кастомные папки */}
          {folders.map((folder) => {
            const isActive = activeFolderId === folder.id;
            return (
              <button
                key={folder.id}
                title={folder.name}
                onClick={() => onSelectFolder?.(folder.id)}
                className={cn(
                  "relative rounded-2xl flex items-center justify-center transition-all duration-200 group shrink-0",
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/25 shadow-lg shadow-primary/10"
                    : "text-white/40 hover:text-white hover:bg-white/5"
                )}
                style={{ width: "52px", height: "52px" }}
              >
                <FolderIcon className="w-6 h-6 transition-transform group-hover:scale-110" />

                {isActive && (
                  <motion.div
                    layoutId="activeFolderPill"
                    className="absolute -left-3.5 w-1.5 h-6 bg-primary rounded-r-full"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
              </button>
            );
          })}

          {/* Кнопка создания новой папки */}
          <button
            title="Создать папку"
            onClick={handleAddFolderClick}
            className="rounded-2xl border border-dashed border-white/10 hover:border-primary/40 text-white/30 hover:text-primary flex items-center justify-center transition-all duration-200 hover:bg-primary/5 shrink-0"
            style={{ width: "52px", height: "52px" }}
          >
            <AddFolderIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── 2. Нижняя часть: Кнопка настройки папок ── */}
      <div className="flex flex-col items-center w-full px-2">
        <button
          title="Настройка папок"
          onClick={() => {
            if (onOpenFolderSettings) {
              onOpenFolderSettings();
            } else {
              toast.info("Настройки папок скоро");
            }
          }}
          className="rounded-2xl text-white/40 hover:text-white hover:bg-white/5 flex items-center justify-center transition-all duration-200 shrink-0"
          style={{ width: "52px", height: "52px" }}
        >
          <FoldersSettingsIcon className="w-6 h-6 transition-transform hover:scale-110" />
        </button>
      </div>
    </aside>
  );
}