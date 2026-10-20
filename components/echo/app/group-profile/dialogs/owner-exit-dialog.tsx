"use client";

/**
 * Диалог выхода для ВЛАДЕЛЬЦА: просто выйти нельзя —
 *  1) «Передать владельца» → выбор участника → подтверждение вводом названия
 *  2) «Удалить группу» → подтверждение вводом названия
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TbArrowLeft, TbChevronRight, TbTrash, TbUserCheck } from "react-icons/tb";
import { cn } from "@/lib/utils";
import type { GroupMember } from "@/hooks/echo/types";
import { MemberAvatar } from "../group-avatar";
import { getMemberName } from "../lib/group-profile-utils";

interface OwnerExitDialogProps {
  groupName: string;
  /** кандидаты на передачу прав (без владельца) */
  members: GroupMember[];
  onConfirm: (mode: "transfer" | "delete", memberId?: string) => void;
  onCancel: () => void;
}

type Step = "choose" | "transfer" | "confirm";

export function OwnerExitDialog({ groupName, members, onConfirm, onCancel }: OwnerExitDialogProps) {
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<"transfer" | "delete" | null>(null);
  const [selected, setSelected] = useState<GroupMember | null>(null);
  const [text, setText] = useState("");
  const matched = text.trim() === groupName;

  const goBack = () => {
    if (step === "confirm") {
      setText("");
      setStep(mode === "transfer" ? "transfer" : "choose");
    } else if (step === "transfer") {
      setMode(null);
      setStep("choose");
    } else {
      onCancel();
    }
  };

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
        {step !== "choose" && (
          <button
            onClick={goBack}
            className="mb-3 grid h-8 w-8 place-items-center rounded-full bg-white/5 transition hover:bg-white/10"
          >
            <TbArrowLeft size={15} />
          </button>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {/* Шаг 1: выбор действия */}
          {step === "choose" && (
            <motion.div
              key="choose"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
            >
              <h3 className="text-[16px] font-bold">Ты владелец группы</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Просто выйти не получится — сначала передай права другому участнику или удали группу.
              </p>
              <button
                onClick={() => {
                  setMode("transfer");
                  setStep("transfer");
                }}
                className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-muted p-3.5 text-left transition hover:bg-white/[0.06]"
              >
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl bg-white/5">
                  <TbUserCheck size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">Передать владельца</span>
                  <span className="block text-[12px] text-muted-foreground">
                    Выбери участника из списка
                  </span>
                </span>
                <TbChevronRight size={16} className="shrink-0 text-muted-foreground/60" />
              </button>
              <button
                onClick={() => {
                  setMode("delete");
                  setStep("confirm");
                }}
                className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-red-500/10 p-3.5 text-left transition hover:bg-red-500/15"
              >
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-400">
                  <TbTrash size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-red-400">Удалить группу</span>
                  <span className="block text-[12px] text-red-400/70">
                    История исчезнет для всех
                  </span>
                </span>
                <TbChevronRight size={16} className="shrink-0 text-red-400/60" />
              </button>
            </motion.div>
          )}

          {/* Шаг 2а: выбор преемника */}
          {step === "transfer" && (
            <motion.div
              key="transfer"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
            >
              <h3 className="text-[16px] font-bold">Кому передать?</h3>
              <div className="scrollbar-hide mt-3 max-h-64 space-y-1 overflow-y-auto">
                {members.map((m) => (
                  <button
                    key={m.user_id}
                    onClick={() => {
                      setSelected(m);
                      setStep("confirm");
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-white/5"
                  >
                    <MemberAvatar member={m} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                      {getMemberName(m)}
                    </span>
                    <TbChevronRight size={15} className="shrink-0 text-muted-foreground/60" />
                  </button>
                ))}
                {members.length === 0 && (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">
                    Кроме тебя в группе никого нет.
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {/* Шаг 2б/3: подтверждение вводом названия */}
          {step === "confirm" && mode && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
            >
              <h3 className="text-[16px] font-bold">
                {mode === "delete" ? "Удалить группу?" : "Передать владельца?"}
              </h3>
              {mode === "transfer" && selected && (
                <div className="mt-3 flex items-center gap-3 rounded-2xl bg-muted p-3">
                  <MemberAvatar member={selected} size={38} />
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {getMemberName(selected)}
                  </p>
                </div>
              )}
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                {mode === "delete"
                  ? "Группа, история и участники будут удалены для всех. Отменить это нельзя."
                  : "Этот участник станет владельцем, а ты — обычным участником."}
              </p>
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
              <div className="mt-4 flex gap-2">
                <button
                  onClick={onCancel}
                  className="flex-1 rounded-2xl bg-white/5 py-3 text-[14px] font-semibold transition hover:bg-white/10"
                >
                  Отмена
                </button>
                <button
                  disabled={!matched}
                  onClick={() =>
                    onConfirm(mode, mode === "transfer" ? selected?.user_id : undefined)
                  }
                  className={cn(
                    "flex-1 rounded-2xl py-3 text-[14px] font-bold transition disabled:opacity-40",
                    mode === "delete"
                      ? "bg-red-500 text-white hover:bg-red-500/90"
                      : "bg-primary text-primary-foreground hover:opacity-90",
                  )}
                >
                  {mode === "delete" ? "Удалить" : "Передать"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
