"use client";

/**
 * CallLogMessage — премиальная, адаптивная плашка звонка.
 * Использует семантические цвета для идеальной работы в светлой и темной теме.
 */

import { memo } from "react";
import {
  TbPhoneOutgoing,
  TbPhoneIncoming,
  TbPhoneOff,
} from "react-icons/tb";
import { cn } from "@/lib/utils";

export type CallLogStatus = "outgoing" | "incoming" | "missed";

export interface CallLogMessageProps {
  status: CallLogStatus;
  duration: number;
  timestamp: string | number;
  isMe: boolean;
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatTimestamp(timestamp: string | number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<CallLogStatus, string> = {
  missed: "Пропущенный звонок",
  outgoing: "Исходящий звонок",
  incoming: "Входящий звонок",
};

export const CallLogMessage = memo(function CallLogMessage({
  status,
  duration,
  timestamp,
  isMe,
}: CallLogMessageProps) {
  const isMissed = status === "missed";
  const Icon = isMissed ? TbPhoneOff : (status === "outgoing" ? TbPhoneOutgoing : TbPhoneIncoming);
  const timeLabel = formatTimestamp(timestamp);
  const successful = !isMissed && duration > 0;

  return (
    <div className={cn("flex w-full", isMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "group flex items-center gap-3 px-4 py-2.5 rounded-2xl transition-all duration-200",
          "max-w-[85%] md:max-w-[70%]",
          "mx-3", // Отступы слева и справа от плашки

          // Премиальный адаптивный фон: работает идеально и в светлой, и в темной теме
          "bg-muted/40 dark:bg-white/5 backdrop-blur-md",
          "border border-border/40 dark:border-white/5",
          "hover:bg-muted/60 dark:hover:bg-white/10"
        )}
      >
        {/* Иконка: использует семантические цвета (primary/destructive), которые адаптируются к теме */}
        <div
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-colors",
            isMissed
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary"
          )}
        >
          <Icon className="w-4 h-4" />
        </div>

        {/* Текстовая часть */}
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "text-sm font-medium",
              isMissed ? "text-destructive" : "text-foreground"
            )}>
              {STATUS_LABEL[status]}
            </span>

            {successful && (
              <span className="text-xs text-muted-foreground tabular-nums font-medium">
                {formatDuration(duration)}
              </span>
            )}
          </div>

          <span className="text-[11px] text-muted-foreground tabular-nums font-medium">
            {timeLabel}
          </span>
        </div>
      </div>
    </div>
  );
});