"use client";

/**
 * Диалог подтверждения с вводом названия группы.
 *  • expectedName = null → простое подтверждение (выход обычного участника)
 *  • expectedName = строка → кнопка активна только после точного ввода
 *    (выход админа, удаление группы владельцем)
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ConfirmNameDialogProps {
  title: string;
  description?: string;
  /** null — подтверждение без ввода названия */
  expectedName: string | null;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmNameDialog({
  title,
  description,
  expectedName,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmNameDialogProps) {
  const [text, setText] = useState("");
  const matched = !expectedName || text.trim() === expectedName;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[60] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-background/95 p-5 backdrop-blur-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[16px] font-bold">{title}</h3>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        )}

        {expectedName && (
          <>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Название группы"
              className="mt-4 w-full rounded-2xl bg-muted px-4 py-3 text-[15px] outline-none placeholder:text-muted-foreground/60"
            />
            {text && !matched && (
              <p className="mt-2 text-[11px] text-red-400">Название не совпадает — попробуй ещё раз</p>
            )}
          </>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-2xl bg-white/5 py-3 text-[14px] font-semibold transition hover:bg-white/10"
          >
            Отмена
          </button>
          <button
            disabled={!matched}
            onClick={onConfirm}
            className={cn(
              "flex-1 rounded-2xl py-3 text-[14px] font-bold transition disabled:opacity-40",
              danger ? "bg-red-500 text-white hover:bg-red-500/90" : "bg-primary text-primary-foreground hover:opacity-90",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
