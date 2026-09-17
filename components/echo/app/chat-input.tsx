"use client";

import React, { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MediaPicker } from "./media-picker";
import {
  TbSend as Send,
  TbPaperclip as Paperclip,
  TbMoodSmile as Smile,
  TbArrowBackUp as Reply,
  TbEdit as Edit,
  TbX as X,
  TbCheck as Check,
  TbBold as Bold,
  TbItalic as Italic,
  TbCode as Code,
  TbEyeOff as EyeOff,
  TbKeyboard as Keyboard,
  TbMicrophone as Mic,
  TbVideo as Camera,
  TbLock,
  TbLockFilled,
  TbChevronUp,
  TbChevronLeft,
  TbChevronDown,
  TbTrash,
} from "react-icons/tb";

import { toast } from "sonner";
import { pickRecorderMime, MAX_VOICE_SECONDS } from "@/lib/voice";

const HOLD_MS = 220;           // удержание до старта записи
const LOCK_THRESHOLD = 70;     // свайп вверх для закрепления
const CANCEL_THRESHOLD = 60;   // свайп влево для отмены
const MIN_VOICE_DURATION = 0.7; // короче — выбрасываем молча

const fmtTime = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

interface ChatInputProps {
  newMessage: string;
  setNewMessage: (val: string | ((prev: string) => string)) => void;
  replyingTo: any;
  setReplyingTo: (msg: any) => void;
  editingMessage: any;
  setEditingMessage: (msg: any) => void;
  onSend: () => void;
  selectedChat: any;
  user: any;
  isMobile: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  isFullPickerOpen: boolean;
  onToggleFullPicker: () => void;
  onSendVoice?: (blob: Blob, durationSec: number) => void;
}

export function ChatInput({
  newMessage, setNewMessage, replyingTo, setReplyingTo, editingMessage, setEditingMessage,
  onSend, selectedChat, user, isMobile, textareaRef, isFullPickerOpen, onToggleFullPicker, onSendVoice,
}: ChatInputProps) {
  const localTextareaRef = useRef<HTMLTextAreaElement>(null);
  const taRef = textareaRef || localTextareaRef;
  const dragControls = useDragControls();

  const [isHovering, setIsHovering] = useState(false);
  const [isMobilePickerOpen, setIsMobilePickerOpen] = useState(false);
  const [isMobilePickerExpanded, setIsMobilePickerExpanded] = useState(false);
  const [voiceMode, setVoiceMode] = useState<"mic" | "camera">("mic");

  useEffect(() => {
    if (editingMessage && taRef.current) taRef.current.focus();
  }, [editingMessage]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (!newMessage || newMessage.trim() === "") {
      el.style.height = "auto";
    } else {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [newMessage]);

  const adjustHeight = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    adjustHeight();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      onSend();
    }
  };

  const cancelAction = () => {
    setReplyingTo(null);
    setEditingMessage(null);
    setNewMessage("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const wrapSelection = (before: string, after: string) => {
    const el = taRef.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const val = typeof newMessage === "string" ? newMessage : "";
    setNewMessage(val.substring(0, start) + before + val.substring(start, end) + after + val.substring(end));
    setTimeout(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = end + before.length;
    }, 0);
  };

  const handleEmojiToggle = () => {
    if (isMobile) {
      if (isMobilePickerOpen) {
        setIsMobilePickerOpen(false);
        setIsMobilePickerExpanded(false);
        taRef.current?.focus();
      } else {
        taRef.current?.blur();
        setIsMobilePickerOpen(true);
      }
    } else {
      onToggleFullPicker();
      setIsHovering(false);
    }
  };

  const hasText = typeof newMessage === "string" && newMessage.trim().length > 0;
  const canSend = hasText || !!editingMessage;

  // ─────────────────────────────────────────────────────────────
  // ГОЛОСОВЫЕ: удержание → запись, свайп вверх → закрепить,
  // свайп влево → отмена. Работает и с мышью, и с тачем.
  // ─────────────────────────────────────────────────────────────
  type RecState = "idle" | "rec" | "locked";
  const [rec, setRec] = useState<RecState>("idle");
  const [recSec, setRecSec] = useState(0);
  const [willLock, setWillLock] = useState(false);
  const [willCancel, setWillCancel] = useState(false);

  // ВАЖНО: ref синхронизируем синхронно, не через useEffect —
  // иначе pointerup успевает прочитать устаревшее состояние.
  const recRef = useRef<RecState>("idle");
  const setRecState = (s: RecState) => { recRef.current = s; setRec(s); };

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const cancelRef = useRef(false);
  const startingRef = useRef(false);
  const suppressClickRef = useRef(false); // глушим клик, который идёт после записи
  const willLockRef = useRef(false);
  const willCancelRef = useRef(false);
  const ring1Ref = useRef<HTMLSpanElement>(null);
  const ring2Ref = useRef<HTMLSpanElement>(null);
  const onSendVoiceRef = useRef(onSendVoice);
  const movedRef = useRef(false);
  useEffect(() => { onSendVoiceRef.current = onSendVoice; }, [onSendVoice]);

  const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch {} };

  const cleanupRecordingDom = () => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    analyserRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (ring1Ref.current) { ring1Ref.current.style.transform = ""; ring1Ref.current.style.opacity = ""; }
    if (ring2Ref.current) { ring2Ref.current.style.transform = ""; ring2Ref.current.style.opacity = ""; }
  };

  // Живая визуализация громкости: два круга за кнопкой, обновляем стили
  // напрямую из rAF — никаких ререндеров на каждый кадр.
  const setupAnalyser = (stream: MediaStream) => {
    try {
      const Ctx: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      ctx.resume?.().catch(() => {});
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      let level = 0;
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        const a = analyserRef.current;
        if (!a) return;
        a.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length) / 255;
        // тихий «дыхательный» пульс, чтобы круги жили даже в тишине
        const breath = 0.1 + 0.05 * Math.sin(Date.now() / 280);
        const target = Math.max(breath, Math.min(1, rms * 2.6));
        level += (target - level) * 0.25;
        if (ring1Ref.current) {
          ring1Ref.current.style.transform = `scale(${1 + level * 0.65})`;
          ring1Ref.current.style.opacity = `${0.3 + level * 0.45}`;
        }
        if (ring2Ref.current) {
          ring2Ref.current.style.transform = `scale(${1 + level * 1.25})`;
          ring2Ref.current.style.opacity = `${0.15 + level * 0.3}`;
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {}
  };

    // Страховка на десктопе: отпускание вне кнопки / потеря capture
  useEffect(() => {
    const onWinUp = () => {
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      if (startingRef.current) cancelRef.current = true;
      if (recRef.current === "rec") stopVoiceRecording(true);
    };
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
    return () => {
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinUp);
    };
  }, []);

  const startVoiceRecording = async () => {
    console.log("[VOICE] холд сработал");
    if (recRef.current !== "idle" || startingRef.current) {
      console.log("[VOICE] выход, стейт:", recRef.current, "starting:", startingRef.current);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      console.error("[VOICE] mediaDevices нет — нужен HTTPS или localhost");
      toast.error("Микрофон недоступен: нужен HTTPS или localhost");
      return;
    }
    startingRef.current = true;
    try {
      const gp = navigator.mediaDevices.getUserMedia({ audio: true });
      const stream = await Promise.race([
        gp,
        new Promise<null>((res) => setTimeout(() => res(null), 8000)),
      ]);
      if (!stream) {
        gp.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
        throw new Error("mic-timeout");
      }
      console.log("[VOICE] доступ к микрофону получен");
      if (cancelRef.current || recRef.current !== "idle") {
        // Отпустил кнопку, пока висел промпт доступа
        toast("Доступ получен — зажми микрофон ещё раз");
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      taRef.current?.blur();
      streamRef.current = stream;

      const mime = pickRecorderMime();
      console.log("[VOICE] mime:", mime);
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      cancelRef.current = false;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        const cancelled = cancelRef.current;
        const dur = (Date.now() - startedAtRef.current) / 1000;
        cleanupRecordingDom();
        setRecState("idle");
        setRecSec(0);
        willLockRef.current = false; setWillLock(false);
        willCancelRef.current = false; setWillCancel(false);
        console.log("[VOICE] стоп, отменена:", cancelled, "длительность:", dur);
        if (!cancelled && chunks.length && dur >= MIN_VOICE_DURATION) {
          const blob = new Blob(chunks, { type: mime || "audio/webm" });
          onSendVoiceRef.current?.(blob, Math.min(dur, MAX_VOICE_SECONDS));
        }
      };
      mr.onerror = () => { cancelRef.current = true; try { mr.stop(); } catch {} };

      mr.start(250);
      startedAtRef.current = Date.now();
      setRecState("rec");
      setRecSec(0);
      recTimerRef.current = setInterval(() => setRecSec((s) => s + 1), 1000);
      setupAnalyser(stream);
      console.log("[VOICE] запись пошла");
    } catch (err: any) {
      console.error("[VOICE] ошибка старта:", err?.name, err?.message);
      if (err?.name === "NotAllowedError")
        toast.error("Микрофон заблокирован в браузере — иконка в адресной строке → разрешить");
      else if (err?.name === "NotFoundError") toast.error("Микрофон не найден");
      else if (err?.name === "NotReadableError") toast.error("Микрофон занят другим приложением");
      else toast.error("Не удалось начать запись");
      cleanupRecordingDom();
      setRecState("idle");
    } finally {
      startingRef.current = false;
    }
  };

  const stopVoiceRecording = (send = true) => {
    if (recRef.current === "idle") return;
    if (!send) cancelRef.current = true;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") {
      try { mr.stop(); } catch { cleanupRecordingDom(); setRecState("idle"); }
    } else {
      cleanupRecordingDom();
      setRecState("idle");
    }
  };

  const onVoiceBtnDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    console.log("[VOICE] pointerdown", e.pointerType, "recRef:", recRef.current, "canSend:", canSend);
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault(); // запрет выделения текста при drag мышью
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    suppressClickRef.current = false;
    willLockRef.current = false; setWillLock(false);
    willCancelRef.current = false; setWillCancel(false);
    pressRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    cancelRef.current = false;
    if (recRef.current !== "idle") return;        // в locked режиме стоп делает клик
    if (canSend) return;                          // есть текст — это кнопка отправки
    if (voiceMode !== "mic") return;              // режим камеры пока ничего не пишет
    // Работает и с мышью, и с тачем: hold-таймер не сбрасывается от микродвижений.
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      suppressClickRef.current = true; // началась запись — последующий клик глушим
      startVoiceRecording();
    }, HOLD_MS);
  };

  const onVoiceBtnMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = pressRef.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) movedRef.current = true;
    if (recRef.current === "idle") return; // мышь всегда дрожит — движение НЕ отменяет hold
    if (recRef.current !== "rec") return;
    const lockZone = dy < -LOCK_THRESHOLD && Math.abs(dy) >= Math.abs(dx);
    const cancelZone = dx < -CANCEL_THRESHOLD && Math.abs(dx) > Math.abs(dy);
    if (lockZone !== willLockRef.current) {
      willLockRef.current = lockZone;
      setWillLock(lockZone);
      if (lockZone) buzz(15);
    }
    if (cancelZone !== willCancelRef.current) {
      willCancelRef.current = cancelZone;
      setWillCancel(cancelZone);
      if (cancelZone) buzz(15);
    }
  };

  const onVoiceBtnUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    console.log("[VOICE] pointerup, recRef:", recRef.current);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    const st = recRef.current;
    pressRef.current = null;
    if (st === "idle") {
      // Отпустили, пока запись ещё стартует (запрос доступа) — отменяем старт.
      if (startingRef.current) cancelRef.current = true;
      return;
    }
    if (st === "locked") return; // стоп — по onClick
    if (willCancelRef.current) {
      willCancelRef.current = false; setWillCancel(false);
      buzz(25);
      cancelRef.current = true;
      stopVoiceRecording(false);
      return;
    }
    if (willLockRef.current) {
      willLockRef.current = false; setWillLock(false);
      buzz(20);
      setRecState("locked"); // рекордер НЕ останавливаем — пишем дальше без пальца
      return;
    }
    stopVoiceRecording(true);
  };

  const onVoiceBtnCancel = () => {
    // Системная отмена жеста (входящий звонок, жест браузера) — не зависаем.
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    willLockRef.current = false; setWillLock(false);
    willCancelRef.current = false; setWillCancel(false);
    pressRef.current = null;
    if (recRef.current === "rec") stopVoiceRecording(true);
  };

  const onVoiceBtnLeave = () => {
    if (holdTimerRef.current && recRef.current === "idle") {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const cancelLockedRecording = () => {
    buzz(20);
    cancelRef.current = true;
    stopVoiceRecording(false);
  };

  // Клик по главной кнопке: приоритеты — глушим клик после записи,
  // тап в locked = стоп и отправка, иначе отправка/сворачивание/смена режима.
  const onMainClick = () => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (recRef.current === "locked") { stopVoiceRecording(true); return; }
    if (recRef.current !== "idle") return;
    if (isMobile && isMobilePickerOpen && isMobilePickerExpanded) {
      setIsMobilePickerExpanded(false);
      return;
    }
    if (canSend) { onSend(); return; }
    if (movedRef.current) return; // сорванный холд — НЕ переключаем режим
    setVoiceMode((m) => (m === "mic" ? "camera" : "mic")); // микрофон ↔ камера
  };

  // Автостоп по максимальной длительности.
  useEffect(() => {
    if (rec !== "idle" && recSec >= MAX_VOICE_SECONDS) stopVoiceRecording(true);
  }, [rec, recSec]);

  // Esc — отменить запись (десктоп).
  useEffect(() => {
    if (rec === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { cancelRef.current = true; stopVoiceRecording(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rec]);

  // Размонтирование во время записи — прибираем за собой.
  useEffect(() => () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (recRef.current !== "idle") {
      cancelRef.current = true;
      try { mediaRecorderRef.current?.stop(); } catch {}
    }
    cleanupRecordingDom();
  }, []);

  const handleSendOrCollapse = () => {
    if (isMobile && isMobilePickerOpen && isMobilePickerExpanded) {
      setIsMobilePickerExpanded(false);
    } else {
      onSend();
    }
  };

  const isEmojiActive = isMobile ? isMobilePickerOpen : isFullPickerOpen;

  return (
    <footer
      className={cn(
        "flex flex-col shrink-0 px-2 pb-2 md:px-6 lg:px-10 md:pb-4 relative z-30",
        isMobile && "safe-bottom"
      )}
    >
      <AnimatePresence>
        {(replyingTo || editingMessage) && (
          <motion.div
            key={replyingTo ? `reply-${replyingTo.id}` : `edit-${editingMessage.id}`}
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: 8, height: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 400 }}
            className="overflow-hidden mb-2.5"
          >
            <div className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-2xl border backdrop-blur-xl",
              replyingTo ? "bg-zinc-900/70 border-white/[0.08]" : "bg-primary/[0.08] border-primary/20"
            )}>
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", replyingTo ? "bg-white/[0.06]" : "bg-primary/15")}>
                {replyingTo ? <Reply className="w-4 h-4 text-primary" /> : <Edit className="w-4 h-4 text-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary mb-0.5">
                  {replyingTo ? `Ответ: ${replyingTo.sender_id === user?.id ? "Себе" : selectedChat?.display_name || selectedChat?.username}` : "Редактирование"}
                </div>
                <div className="text-[13px] text-zinc-400 truncate leading-snug">
                  {replyingTo ? replyingTo.content : editingMessage?.content}
                </div>
              </div>
              <button onClick={cancelAction} className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "flex items-end gap-1.5 md:gap-2 rounded-[22px] md:rounded-[26px] border backdrop-blur-xl transition-all duration-300",
          rec === "idle"
            ? "bg-zinc-900/60 border-white/[0.08] focus-within:border-primary/40 focus-within:bg-zinc-900/80 focus-within:shadow-lg focus-within:shadow-primary/[0.03]"
            : willCancel
              ? "bg-red-950/30 border-red-500/50"
              : "bg-zinc-900/70 border-red-500/25",
          "px-1.5 py-1.5 md:px-2.5 md:py-2"
        )}
      >
        {/* ЛЕВЫЙ СЛОТ: инструменты / корзина в закреплённом режиме */}
        <div className="flex items-center shrink-0 gap-0.5 mb-0.5">
          <AnimatePresence mode="wait" initial={false}>
            {rec === "idle" ? (
              <motion.div
                key="tools"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-0.5"
              >
                <Button variant="ghost" size="icon" className="w-9 h-9 md:w-10 md:h-10 rounded-xl text-zinc-500 hover:text-primary hover:bg-primary/10 transition-colors">
                  <Paperclip className="w-[18px] h-[18px]" />
                </Button>

                <div
                  className="relative"
                  onMouseEnter={() => !isMobile && !isFullPickerOpen && setIsHovering(true)}
                  onMouseLeave={() => !isMobile && setIsHovering(false)}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleEmojiToggle}
                    className={cn(
                      "w-9 h-9 md:w-10 md:h-10 rounded-xl transition-all duration-300",
                      isEmojiActive
                        ? "bg-primary/15 text-primary scale-95"
                        : "text-zinc-500 hover:text-primary hover:bg-primary/10"
                    )}
                  >
                    {isMobile && isMobilePickerOpen ? <Keyboard className="w-[18px] h-[18px]" /> : <Smile className="w-[18px] h-[18px]" />}
                  </Button>

                  <AnimatePresence>
                    {!isMobile && !isFullPickerOpen && isHovering && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute bottom-full left-0 mb-2 w-[340px] h-[420px] z-50 shadow-2xl"
                      >
                        <MediaPicker onEmojiSelect={(e) => setNewMessage(prev => prev + e)} onStickerSelect={() => {}} onGifSelect={() => {}} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="rec-tools"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="flex items-center"
              >
                <AnimatePresence>
                  {rec === "locked" && (
                    <motion.button
                      type="button"
                      onClick={cancelLockedRecording}
                      title="Отменить запись"
                      initial={{ opacity: 0, scale: 0.5, x: -8 }}
                      animate={{ opacity: 1, scale: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.5, x: -8 }}
                      transition={{ type: "spring", stiffness: 500, damping: 28 }}
                      className="w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <TbTrash className="w-[18px] h-[18px]" />
                    </motion.button>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ЦЕНТРАЛЬНЫЙ СЛОТ: инпут / индикатор записи */}
        <div className="flex-1 min-w-0 relative">
          <AnimatePresence mode="wait" initial={false}>
            {rec === "idle" ? (
              <motion.div
                key="compose"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="relative min-w-0"
              >
                <AnimatePresence>
                  {hasText && (
                    <motion.div
                      initial={{ opacity: 0, y: 4, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                      className="absolute -top-11 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-1 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-xl z-50"
                    >
                      <FmtBtn title="Bold" onClick={() => wrapSelection("**", "**")}><Bold className="w-3.5 h-3.5" /></FmtBtn>
                      <FmtBtn title="Italic" onClick={() => wrapSelection("*", "*")}><Italic className="w-3.5 h-3.5" /></FmtBtn>
                      <FmtBtn title="Code" onClick={() => wrapSelection("`", "`")}><Code className="w-3.5 h-3.5" /></FmtBtn>
                      <div className="w-px h-3.5 bg-white/10 mx-0.5" />
                      <FmtBtn title="Spoiler" onClick={() => wrapSelection("||", "||")}><EyeOff className="w-3.5 h-3.5" /></FmtBtn>
                    </motion.div>
                  )}
                </AnimatePresence>

                <textarea
                  ref={taRef}
                  rows={1}
                  placeholder={editingMessage ? "Изменить сообщение..." : "Написать сообщение..."}
                  value={typeof newMessage === "string" ? newMessage : ""}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => { if (isMobile) setIsMobilePickerOpen(false); }}
                  className="w-full bg-transparent border-none py-2 px-2 text-[15px] font-medium resize-none outline-none focus:ring-0 placeholder:text-zinc-600 leading-relaxed scrollbar-hide text-foreground max-h-[160px]"
                />
              </motion.div>
            ) : (
              <motion.div
                key="recording"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-3 h-10 px-1 min-w-0"
              >
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span className="text-sm font-mono tabular-nums text-zinc-100 shrink-0">{fmtTime(recSec)}</span>

                {rec === "rec" ? (
                  <div className="flex items-center min-w-0 overflow-hidden">
                    <AnimatePresence mode="wait" initial={false}>
                      {willCancel ? (
                        <motion.span
                          key="cancel-hint"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.15 }}
                          className="flex items-center gap-1.5 text-red-400 text-[13px] font-bold whitespace-nowrap"
                        >
                          <X className="w-4 h-4" />
                          Отпустите для отмены
                        </motion.span>
                      ) : (
                        <motion.span
                          key="slide-hint"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="flex items-center gap-0.5 text-zinc-500 text-[13px] font-medium whitespace-nowrap"
                        >
                          <motion.span
                            animate={{ x: [0, -5, 0], opacity: [0.35, 1, 0.35] }}
                            transition={{ repeat: Infinity, duration: 1.1, ease: "easeInOut" }}
                            className="text-red-400"
                          >
                            <TbChevronLeft className="w-4 h-4" />
                          </motion.span>
                          <motion.span
                            animate={{ x: [0, -5, 0], opacity: [0.15, 0.6, 0.15] }}
                            transition={{ repeat: Infinity, duration: 1.1, ease: "easeInOut", delay: 0.18 }}
                            className="text-red-400"
                          >
                            <TbChevronLeft className="w-4 h-4" />
                          </motion.span>
                          <span className="ml-1">Проведите влево для отмены</span>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px] text-zinc-400 font-medium truncate">
                    Запись закреплена — нажмите <span className="text-amber-400 font-bold">стоп</span> для отправки
                  </motion.span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ПРАВЫЙ СЛОТ: микрофон / запись / отправка */}
        <div className="relative shrink-0 mb-0.5">
          {/* Пилл «ЗАКРЕПЛЕНО» над кнопкой */}
          <AnimatePresence>
            {rec === "locked" && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 400, damping: 26 }}
                className="absolute bottom-full right-0 mb-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400 text-zinc-950 text-[11px] font-extrabold uppercase tracking-wide shadow-lg shadow-amber-500/30 z-50 pointer-events-none whitespace-nowrap"
              >
                <TbLockFilled className="w-3 h-3" />
                Закреплено
              </motion.div>
            )}
          </AnimatePresence>

          {/* Замок + стрелка вверх (свайп вверх → закрепить) */}
          <AnimatePresence>
            {rec === "rec" && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.9 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="absolute bottom-full right-0 md:right-0.5 mb-4 flex flex-col items-center gap-1.5 z-50 pointer-events-none"
              >
                <motion.div
                  animate={{
                    scale: willLock ? 1.3 : 1,
                    backgroundColor: willLock ? "#ef4444" : "#27272a",
                    borderColor: willLock ? "#ef4444" : "rgba(255,255,255,0.12)",
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className="w-9 h-9 rounded-full border shadow-xl flex items-center justify-center"
                >
                  {willLock
                    ? <TbLockFilled className="w-4 h-4 text-white" />
                    : <TbLock className="w-4 h-4 text-zinc-300" />}
                </motion.div>
                <motion.div
                  animate={{ opacity: willLock ? 0 : 1, y: willLock ? -6 : 0 }}
                  className="text-zinc-500"
                >
                  <TbChevronUp className="w-4 h-4" />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            type="button"
            title={canSend ? "Отправить (Enter)" : rec !== "idle" ? "Идёт запись" : "Клик — камера/микрофон · Удерживайте — голосовое"}
            onPointerDown={onVoiceBtnDown}
            onPointerMove={onVoiceBtnMove}
            onPointerUp={onVoiceBtnUp}
            onPointerCancel={onVoiceBtnCancel}
            onContextMenu={(e) => e.preventDefault()}
            onClick={onMainClick}
            animate={{ scale: rec !== "idle" ? 1.22 : 1, borderRadius: rec !== "idle" ? 9999 : 12 }}
            whileHover={rec === "idle" ? { scale: 1.05 } : undefined}
            whileTap={rec === "idle" ? { scale: 0.92 } : undefined}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
            className={cn(
              "relative w-9 h-9 md:w-10 md:h-10 flex items-center justify-center select-none touch-none transition-colors duration-300",
              rec !== "idle"
                ? "bg-red-500 text-white shadow-lg shadow-red-500/40"
                : (isMobile && isMobilePickerOpen && isMobilePickerExpanded)
                  ? "bg-white/[0.08] text-white hover:bg-white/[0.15]"
                  : canSend
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "bg-primary/10 text-primary hover:bg-primary/20"
            )}
          >
            {/* Живые круги, реагирующие на громкость */}
            {rec !== "idle" && (
              <>
                <span ref={ring2Ref} className="absolute inset-0 rounded-full bg-red-500/25 pointer-events-none" style={{ willChange: "transform, opacity" }} />
                <span ref={ring1Ref} className="absolute inset-0 rounded-full bg-red-500/45 pointer-events-none" style={{ willChange: "transform, opacity" }} />
              </>
            )}

            <span className="relative z-10 flex items-center justify-center">
              <AnimatePresence mode="wait" initial={false}>
                {rec === "rec" ? (
                  <motion.span key="rec-mic" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.15 }}>
                    <Mic className="w-[19px] h-[19px]" />
                  </motion.span>
                ) : rec === "locked" ? (
                  <motion.span key="stop" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.15 }}>
                    <span className="block w-3 h-3 rounded-[2px] bg-white" />
                  </motion.span>
                ) : (isMobile && isMobilePickerOpen && isMobilePickerExpanded) ? (
                  <motion.span key="down" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <TbChevronDown className="w-[18px] h-[18px]" />
                  </motion.span>
                ) : editingMessage ? (
                  <motion.span key="check" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <Check className="w-[18px] h-[18px]" />
                  </motion.span>
                ) : canSend ? (
                  <motion.span key="send" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <Send className="w-[18px] h-[18px]" />
                  </motion.span>
                ) : voiceMode === "camera" ? (
                  <motion.span key="camera" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.15 }}>
                    <Camera className="w-[19px] h-[19px]" />
                  </motion.span>
                ) : (
                  <motion.span key="mic" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <Mic className="w-[19px] h-[19px]" />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </motion.button>
        </div>
      </div>

      {/* РАСПОРКА: чтобы пикер в компактном режиме толкал инпут вверх */}
      {isMobile && isMobilePickerOpen && !isMobilePickerExpanded && (
        <div style={{ height: '42dvh' }} className="shrink-0" />
      )}

      {/* САМ ПИКЕР (Плавно следует за пальцем и отскакивает) */}
      <AnimatePresence>
        {isMobile && isMobilePickerOpen && (
          <motion.div
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragSnapToOrigin
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.2, bottom: 0.5 }}
            onDragEnd={(e, info) => {
              if (info.offset.y < -50 || info.velocity.y < -300) {
                setIsMobilePickerExpanded(true);
              } else if (info.offset.y > 50 || info.velocity.y > 300) {
                if (isMobilePickerExpanded) {
                  setIsMobilePickerExpanded(false);
                } else {
                  setIsMobilePickerOpen(false);
                  taRef.current?.focus();
                }
              }
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0, height: isMobilePickerExpanded ? '92dvh' : '42dvh' }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-900 border-t border-white/10 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="w-full pt-3 pb-2 flex justify-center cursor-grab active:cursor-grabbing shrink-0 touch-none"
            >
              <div className="w-12 h-1.5 bg-white/20 rounded-full" />
            </div>

            <div className="flex-1 overflow-hidden p-2">
              <MediaPicker onEmojiSelect={(e) => setNewMessage(prev => prev + e)} onStickerSelect={() => {}} onGifSelect={() => {}} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </footer>
  );
}

function FmtBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void; }) {
  return (
    <button onClick={onClick} title={title} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
      {children}
    </button>
  );
}