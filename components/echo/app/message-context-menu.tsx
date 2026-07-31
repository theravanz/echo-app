"use client";

import { motion, AnimatePresence } from "framer-motion";
import { TbArrowBackUp as Reply, TbCopy as Copy, TbPin as Pin, TbTrash as Trash2 } from "react-icons/tb";
import { cn } from "@/lib/utils";

const QUICK_REACTIONS = ["❤️", "😂", "👍", "🔥"];

export interface ContextMenuTarget {
  message: any;
  isMine: boolean;
  anchorRect: DOMRect;
}

export function MessageContextMenu({
  target,
  containerRect,
  onClose,
  onReply,
  onCopy,
  onPin,
  onDelete,
  onReact,
}: {
  target: ContextMenuTarget | null;
  containerRect: DOMRect | null;
  onClose: () => void;
  onReply: (msg: any) => void;
  onCopy: (msg: any) => void;
  onPin: (msg: any) => void;
  onDelete: (msg: any) => void;
  onReact: (msg: any, emoji: string) => void;
}) {
  const open = !!target && !!containerRect;

  let menuTop = 0, menuLeft = 0, reactTop = 0;
  if (target && containerRect) {
    menuTop = target.anchorRect.bottom - containerRect.top + 6;
    reactTop = target.anchorRect.top - containerRect.top - 44;
    menuLeft = target.isMine
      ? target.anchorRect.right - containerRect.left - 180
      : target.anchorRect.left - containerRect.left;
    menuLeft = Math.max(10, Math.min(menuLeft, containerRect.width - 190));
  }

  return (
    <AnimatePresence>
      {open && target && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/35 z-40"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 6 }}
            transition={{ type: "spring", damping: 22, stiffness: 320 }}
            style={{ position: "absolute", top: reactTop, left: menuLeft }}
            className="z-50 flex gap-1.5 bg-background border border-border rounded-full px-2.5 py-1.5 shadow-2xl"
          >
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                onClick={() => { onReact(target.message, e); onClose(); }}
                className="text-lg leading-none hover:scale-125 transition-transform"
              >
                {e}
              </button>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: -6 }}
            transition={{ type: "spring", damping: 22, stiffness: 320 }}
            style={{ position: "absolute", top: menuTop, left: menuLeft }}
            className="z-50 min-w-[170px] bg-background border border-border rounded-2xl overflow-hidden shadow-2xl"
          >
            <MenuItem icon={Reply} label="Ответить" onClick={() => { onReply(target.message); onClose(); }} />
            <MenuItem icon={Copy} label="Копировать" onClick={() => { onCopy(target.message); onClose(); }} />
            <MenuItem icon={Pin} label="Закрепить" onClick={() => { onPin(target.message); onClose(); }} />
            {target.isMine && (
              <MenuItem icon={Trash2} label="Удалить" danger onClick={() => { onDelete(target.message); onClose(); }} />
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: any;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] transition-colors hover:bg-accent/40",
        danger ? "text-destructive" : "text-foreground"
      )}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}
