"use client";

/**
 * CallLogMessage — компактная системная плашка звонка в истории чата.
 * Рендерится в ленте сообщений, когда `message.type === "call_log"`.
 *
 * Дизайн: тёмный футуристичный минимализм, размытие (backdrop-blur),
 * закруглённые углы, микро-анимация появления.
 */

import { memo } from "react";
import {
  TbPhoneOutgoing,
  TbPhoneIncoming,
} from "react-icons/tb";
import { cn } from "@/lib/utils";

export type CallLogStatus = "outgoing" | "incoming" | "missed";

export interface CallLogMessageProps {
  /** Направление/результат вызова. */
  status: CallLogStatus;
  /** Длительность разговора в секундах (0 — звонок не состоялся). */
  duration: number;
  /** Время вызова (ISO-строка или Unix ms). */
  timestamp: string | number;
  /** Принадлежит ли лог текущему пользователю. */
  isMe: boolean;
}

/** Форматирование длительности: 314 → "05:14". */
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
  // Для пропущенного используем TbPhoneIncoming (трубка со стрелкой),
  // окрашенную в красный; для успешных — зелёный входящий/исходящий.
  const Icon = status === "outgoing" ? TbPhoneOutgoing : TbPhoneIncoming;

  const timeLabel = formatTimestamp(timestamp);
  const successful = !isMissed && duration > 0;

  return (
    <div className="flex justify-center my-1.5 animate-in fade-in slide-in-from-bottom-4 duration-500 select-none">
      <div
        className={cn(
          "flex items-center gap-2.5 px-4 py-2 rounded-full border backdrop-blur-md max-w-[92%]",
          "bg-white/[0.05] border-white/[0.07]",
          isMissed && "border-red-500/20 bg-red-500/[0.06]",
          isMe && "flex-row-reverse",
        )}
      >
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
            isMissed
              ? "bg-red-500/15 text-red-400"
              : "bg-emerald-500/15 text-emerald-400",
          )}
        >
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex flex-col leading-tight">
          <span
            className={cn(
              "text-[13px] font-medium",
              isMissed ? "text-red-300/90" : "text-foreground/90",
            )}
          >
            {STATUS_LABEL[status]}
            {successful && (
              <span className="ml-2 text-muted-foreground/80 tabular-nums">
                • {formatDuration(duration)}
              </span>
            )}
          </span>
          {timeLabel && (
            <span className="text-[11px] text-muted-foreground/60 tabular-nums">
              {timeLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
