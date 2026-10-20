"use client";

/**
 * Общая оболочка всех экранов панели группы:
 * шапка (назад / заголовок / правая кнопка) + скроллящееся тело.
 * Направление выезда (push/pop) берётся из ScreenDirectionContext.
 *
 * Здесь же лежат общие строительные блоки: SectionTitle и ScreenRow
 * («34px иконка + 15px bold + 12px muted» — как в ProfileViewPanel).
 */
import { createContext, useContext, type ReactNode } from "react";
import { motion } from "framer-motion";
import { TbArrowLeft, TbChevronRight } from "react-icons/tb";
import { cn } from "@/lib/utils";

/** 1 = открыли новый экран (push), -1 = вернулись назад (pop). */
export const ScreenDirectionContext = createContext<number>(1);

const screenVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-24%" }),
  center: { x: 0 },
  exit: (dir: number) => ({ x: dir > 0 ? "-24%" : "100%" }),
};

interface ScreenShellProps {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ScreenShell({ title, onBack, right, children, className }: ScreenShellProps) {
  const dir = useContext(ScreenDirectionContext);
  return (
    <motion.div
      custom={dir}
      variants={screenVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      className={cn("absolute inset-0 z-30 flex flex-col bg-background", className)}
    >
      <header className="flex items-center gap-3 px-4 pb-2 pt-4">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-full bg-white/5 transition hover:bg-white/10"
        >
          <TbArrowLeft size={18} />
        </motion.button>
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-bold">{title}</h2>
        {right}
      </header>
      <div className="scrollbar-hide flex-1 overflow-y-auto pb-10">{children}</div>
    </motion.div>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h4 className={cn("px-5 pb-2 pt-6 text-[13px] font-bold", className)}>{children}</h4>;
}

interface ScreenRowProps {
  icon: ReactNode;
  title: string;
  sub?: string;
  /** пометка «Скоро» вместо шеврона */
  dev?: boolean;
  danger?: boolean;
  onClick?: () => void;
  right?: ReactNode;
}

export function ScreenRow({ icon, title, sub, dev, danger, onClick, right }: ScreenRowProps) {
  return (
    <motion.button
      type="button"
      whileTap={onClick ? { scale: 0.99 } : undefined}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
    >
      <span
        className={cn(
          "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl",
          danger ? "bg-red-500/10 text-red-400" : "bg-white/5 text-foreground/90",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px] font-semibold", danger && "text-red-400")}>
          {title}
        </span>
        {sub && <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{sub}</span>}
      </span>
      {right}
      {!right && dev && (
        <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Скоро
        </span>
      )}
      {!right && !dev && onClick && (
        <TbChevronRight size={16} className="shrink-0 text-muted-foreground/50" />
      )}
    </motion.button>
  );
}
