"use client";

/**
 * Мини-плеер для файлов с mime `audio/*` прямо в баббле (как mp3 в Telegram).
 *
 * Зачем ОТДЕЛЬНЫЙ компонент, а не ветка внутри FileBubble:
 *  • у плеера своё состояние (audio-элемент, blob URL, позиция, длительность),
 *    которое FileBubble знать не нужно;
 *  • FileBubble остаётся «иконка + имя + размер + системное открытие» — плеер
 *    не переписывает и не может сломать загрузку/открытие файлов;
 *  • message-bubble.tsx и так держит 5 подкомпонентов, отдельный файл
 *    повторяет структуру проекта (CallLogMessage.tsx, secure-avatar.tsx…).
 *
 * Отличие от VoiceBubble (её НЕ трогаем): прогресс ЛИНЕЙНЫЙ, а не волна —
 * аудио-файл и голосовое визуально не спутать.
 *
 * Ленивая загрузка: сеть/расшифровка — ТОЛЬКО при первом Play
 * (ensureCachedFile → readFile → blob: URL). До этого при рендере и скролле
 * чата не уходит ни одного сетевого запроса.
 */

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BaseDirectory, readFile } from "@tauri-apps/plugin-fs";
import { ensureCachedFile, type FileMeta } from "@/lib/files";
import {
  TbPlayerPlayFilled as Play,
  TbPlayerPauseFilled as Pause,
} from "react-icons/tb";

const TAG = "[AUDIO-FILE]";

const formatBytes = (n: number) =>
  n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`;

/** Позиция/длительность в стиле VoiceBubble ("3:42"); без метаданных — "—:—". */
const formatClock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—:—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export interface AudioFileBubbleProps {
  meta: FileMeta;
  isMe: boolean;
  /** Вторая сторона DH: свои сообщения → meta.to, входящие → sender_id. */
  keyUserId: string;
  /** Групповой ключ (msg_key_0) — для v=3 файлов. */
  groupKeyB64?: string | null;
}

export function AudioFileBubble({ meta, isMe, keyUserId, groupKeyB64 }: AudioFileBubbleProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // Защита от двойного тапа: state обновляется асинхронно, ref — сразу.
  const loadingRef = useRef(false);

  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [duration, setDuration] = useState(0);

  // Blob живёт только внутри компонента и освобождается при размонтировании
  // чата: глобальный кэш (как voiceUrlCache у голосовых) для mp3 недопустим —
  // 20 файлов по 8 МБ удержат ~160 МБ расшифрованных байт в памяти.
  useEffect(() => {
    const ref = blobUrlRef; // читаем ref в cleanup: blob создаётся позже, при Play
    return () => {
      if (ref.current) {
        URL.revokeObjectURL(ref.current);
        ref.current = null;
      }
    };
  }, []);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const el = audioRef.current;
    if (!el) return;

    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }

    if (!url) {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!keyUserId) {
        loadingRef.current = false;
        console.error(TAG, "нет ключа второй стороны (meta.to / sender_id)");
        toast.error("Не удалось воспроизвести файл");
        return;
      }
      setLoading(true);
      try {
        // Единственный сетевой путь: скачать+расшифровать в AppCache
        // (тот же кэш, что и у системного открытия), затем прочитать байты.
        const rel = await ensureCachedFile(meta, keyUserId, groupKeyB64);
        const bytes = await readFile(rel, { baseDir: BaseDirectory.AppCache });
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: meta.mime || "audio/mpeg" }));
        blobUrlRef.current = objectUrl;
        setUrl(objectUrl);
        setLoading(false);
        loadingRef.current = false;
        requestAnimationFrame(() => {
          const a = audioRef.current;
          if (!a) return;
          a.play()
            .then(() => setPlaying(true))
            .catch((err) => {
              console.error(`${TAG} play failed:`, err);
              toast.error("Не удалось воспроизвести файл");
            });
        });
        return;
      } catch (err) {
        console.error(`${TAG} load/decrypt failed (mime ${meta.mime}, size ${meta.size}):`, err);
        toast.error("Не удалось воспроизвести файл");
        loadingRef.current = false;
        setLoading(false);
        return;
      }
    }

    // Повторный Play после полного прослушивания — с начала.
    const total = duration || el.duration || 0;
    if (el.ended || (total > 0 && el.currentTime >= total - 0.05)) el.currentTime = 0;
    el.play()
      .then(() => setPlaying(true))
      .catch((err) => {
        console.error(`${TAG} resume failed:`, err);
        toast.error("Не удалось воспроизвести файл");
      });
  }

  /** Seek клика/тапа по линейному прогресс-бару. */
  function seek(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    const el = audioRef.current;
    const bar = barRef.current;
    // До загрузки blob искать не по чему — бар работает как индикатор.
    if (!el || !bar || !url) return;
    const rect = bar.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const total = duration || el.duration || 0;
    if (total > 0) el.currentTime = ratio * total;
    setProgress(ratio);
  }

  // Свои сообщения — светлый пузырь (primary-foreground), поэтому заливка
  // прогресса тёмная, а у входящих (тёмный пузырь) — светлая/primary.
  const fill = isMe ? "var(--primary-foreground)" : "var(--primary)";
  const track = isMe ? "color-mix(in oklch, var(--primary-foreground) 25%, transparent)" : "rgba(255,255,255,0.25)";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl px-3 py-2.5 select-none",
        "w-[min(300px,calc(100vw-110px))] min-w-[220px]",
        isMe
          ? "bg-primary/90 text-primary-foreground"
          : "bg-zinc-800/90 border border-white/10 text-white backdrop-blur-md"
      )}
    >
      {/* Плеер невидим: источник — blob: URL, собранный из расшифрованных байт. */}
      <audio
        ref={audioRef}
        src={url ?? undefined}
        hidden
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          const total = duration || el.duration || 0;
          setProgress(total > 0 ? Math.min(1, el.currentTime / total) : 0);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onPause={() => setPlaying(false)}
      />

      {/* Круглая кнопка Play/Pause — как у VoiceBubble (единый язык бабблов). */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        className={cn(
          "h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-all",
          "hover:scale-105 active:scale-95",
          isMe
            ? "bg-primary-foreground text-primary hover:bg-primary-foreground/85"
            : "bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:bg-primary/90",
          loading && "opacity-70"
        )}
      >
        {loading ? (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold truncate">{meta.name}</span>
          <span className="ml-auto text-[11px] font-medium opacity-70 tabular-nums shrink-0">
            {formatClock(duration)}
          </span>
        </div>

        {/* Тонкий ЛИНЕЙНЫЙ прогресс (волна — только у голосовых). */}
        <div
          ref={barRef}
          onPointerDown={seek}
          className={cn("relative mt-1.5 h-1 w-full rounded-full", url && "cursor-pointer")}
          style={{ background: track }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150 ease-linear"
            style={{ width: `${Math.round(progress * 100)}%`, background: fill }}
          />
        </div>

        <div className="mt-1 text-[11px] opacity-70 tabular-nums">
          {loading ? "Загрузка…" : formatBytes(meta.size)}
        </div>
      </div>
    </div>
  );
}
