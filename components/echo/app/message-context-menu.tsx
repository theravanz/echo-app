"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  TbArrowBackUp as Reply,
  TbCopy as Copy,
  TbPin as Pin,
  TbTrash as Trash2,
  TbEdit as Edit,
  TbClockX as CancelSend,
} from "react-icons/tb";

const QUICK_REACTIONS = ["❤️", "😂", "👍", "🔥", "😮", "😢"];

/** Локальный (не подтверждённый сервером) id — отменять можно только его. */
function isPendingTempId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith("local_");
}

export interface ContextMenuTarget {
  message: any;
  isMine: boolean;
  anchorRect: DOMRect;
}

export function MessageContextMenu({
  target,
  onClose,
  onReply,
  onCopy,
  onPin,
  onEdit,
  onDelete,
  onReact,
  onCancelSend,
}: {
  target: ContextMenuTarget | null;
  onClose: () => void;
  onReply: (msg: any) => void;
  onCopy: (msg: any) => void;
  onPin: (msg: any) => void;
  onEdit?: (msg: any) => void;
  onDelete: (msg: any, scope: "me" | "all") => void;
  onReact: (msg: any, emoji: string) => void;
  /** «Отменить отправку» — только для pending-сообщения с temp-id. */
  onCancelSend?: (msg: any) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [reactPosition, setReactPosition] = useState({ x: 0, y: 0 });
  const [showDeleteSubmenu, setShowDeleteSubmenu] = useState(false);

  useEffect(() => {
    if (!target) return;

    const menuWidth = 200;
    const menuHeight = 260;
    const reactWidth = 280;
    const reactHeight = 50;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let rX = target.anchorRect.left + (target.anchorRect.width / 2) - (reactWidth / 2);
    let rY = target.anchorRect.top - reactHeight - 12;

    let mX = target.isMine
      ? target.anchorRect.right - menuWidth
      : target.anchorRect.left;
    let mY = target.anchorRect.bottom + 12;

    if (rY < 16) {
      rY = target.anchorRect.bottom + 12;
      mY = rY + reactHeight + 12;
    }

    if (mY + menuHeight > viewportHeight - 16) {
      mY = target.anchorRect.top - menuHeight - 12;
      rY = mY - reactHeight - 12;
    }

    rX = Math.max(16, Math.min(rX, viewportWidth - reactWidth - 16));
    mX = Math.max(16, Math.min(mX, viewportWidth - menuWidth - 16));

    rY = Math.max(16, rY);
    mY = Math.max(16, mY);

    setPosition({ x: mX, y: mY });
    setReactPosition({ x: rX, y: rY });
  }, [target]);

  useEffect(() => {
    if (!target) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [target, onClose]);

  if (!target) return null;

  return createPortal(
    <AnimatePresence>
      {/* Оверлей для закрытия и приватности фона (ТЯЖЕЛЫЙ БЛЮР ТОЛЬКО ЗДЕСЬ, это 1 элемент, лагов не будет) */}
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Быстрые реакции */}
      <motion.div
        key="reactions"
        initial={{ opacity: 0, scale: 0.8, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 8 }}
        transition={{ type: "spring", damping: 25, stiffness: 400 }}
        style={{ position: "fixed", left: reactPosition.x, top: reactPosition.y }}
        className="z-[9999] flex gap-1 px-2.5 py-2 rounded-full ..."
      >
        {QUICK_REACTIONS.map((emoji, idx) => (
          <motion.button
            key={emoji}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.03 }}
            onClick={() => {
              onReact(target.message, emoji);
              onClose();
            }}
            className="text-xl leading-none hover:scale-125 active:scale-95 transition-transform p-1"
          >
            {emoji}
          </motion.button>
        ))}
      </motion.div>

      {/* Основное меню */}
      <motion.div
        key="menu"
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.9, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -8 }}
        transition={{ type: "spring", damping: 25, stiffness: 400 }}
        style={{ position: "fixed", left: position.x, top: position.y }}
        className="z-[9999] min-w-[200px] rounded-2xl ..."
      >
        <div className="p-1.5">
          <MenuItem
            icon={Reply}
            label="Ответить"
            onClick={() => {
              onReply(target.message);
              onClose();
            }}
          />
          <MenuItem
            icon={Copy}
            label="Копировать"
            onClick={() => {
              onCopy(target.message);
              onClose();
            }}
          />
          {target.isMine && onEdit && !isPendingTempId(target.message?.id) && (
            <MenuItem
              icon={Edit}
              label="Изменить"
              onClick={() => {
                onEdit(target.message);
                onClose();
              }}
            />
          )}
          {onCancelSend && isPendingTempId(target.message?.id) && (
            <MenuItem
              icon={CancelSend}
              label="Отменить отправку"
              onClick={() => {
                onCancelSend(target.message);
                onClose();
              }}
            />
          )}
          <MenuItem
            icon={Pin}
            label="Закрепить"
            onClick={() => {
              onPin(target.message);
              onClose();
            }}
          />

          {/* Удаление с подменю */}
          {target.isMine && (
            <div className="relative">
              <button
                onClick={() => setShowDeleteSubmenu(!showDeleteSubmenu)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left",
                  "hover:bg-destructive/10 text-destructive"
                )}
              >
                <Trash2 className="w-4 h-4" />
                <span>Удалить</span>
              </button>

              {/* Подменю удаления */}
              <AnimatePresence>
                {showDeleteSubmenu && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      "absolute left-0 top-full mt-1 min-w-[180px] rounded-2xl border backdrop-blur-xl shadow-2xl p-1.5 z-[10000]",
                      "bg-muted/90 dark:bg-zinc-900/90 border-border/50 dark:border-white/10"
                    )}
                  >
                    <button
                      onClick={() => {
                        onDelete(target.message, "me");
                        onClose();
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left",
                        "hover:bg-destructive/10 text-destructive"
                      )}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Удалить у меня</span>
                    </button>
                    <button
                      onClick={() => {
                        onDelete(target.message, "all");
                        onClose();
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left",
                        "hover:bg-destructive/10 text-destructive"
                      )}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Удалить у всех</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: any;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left",
        "hover:bg-primary/10 dark:hover:bg-white/10 text-foreground"
      )}
    >
      <Icon className="w-4 h-4 text-muted-foreground dark:text-zinc-400" />
      <span>{label}</span>
    </button>
  );
}