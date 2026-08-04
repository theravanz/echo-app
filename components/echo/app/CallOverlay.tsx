"use client";

/**
 * CallOverlay — полноэкранный оверлей аудио/видеозвонка поверх мессенджера.
 *
 * Отвечает за:
 *  • Подписку на Tauri-событие `background-call-received` (FCM data-пуш
 *    `type: "incoming_call"` от Rust-бэкенда) — пробуждение из сна, авто-
 *    разворот на весь экран, стейт "Ringing", рингтон и вибрация.
 *  • Исходящие звонки, запускаемые через проп `outgoingCall` (кнопки
 *    "Звонок"/"Видео" в профиле).
 *  • Весь WebRTC-цикл через хук `useWebRtcCall` (сигналинг Supabase
 *    Broadcast, SDP-munging, SVC, ICE Restart).
 *  • Адаптивные тосты качества сети по `status` (производный от
 *    `iceConnectionState`: connected→connected, disconnected→reconnecting,
 *    failed→failed).
 *
 * Иконки: react-icons/tb (Tabler) — единый набор с кодовой базой Echo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  TbPhone,
  TbPhoneOff,
  TbVideo,
  TbVideoOff,
  TbMicrophone,
  TbMicrophoneOff,
  TbSignal4G,
  TbRotateClockwise,
} from "react-icons/tb";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useWebRtcCall, type CallStatus, type SdpPayload, SIGNAL_EVENT } from "@/hooks/echo/use-webrtc-call";

/* ═══════════════════════════════════════════════════════════════════ */
/*  Типы                                                               */
/* ═══════════════════════════════════════════════════════════════════ */

export interface CallPeerInfo {
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  peerAccent?: string | null;
}

/** Запрос на исходящий звонок (из кнопок профиля). */
export interface OutgoingCallRequest extends CallPeerInfo {
  withVideo: boolean;
}

/** Лог завершённого звонка для вставки в историю чата. */
export interface CallLogData {
  roomId: string;
  peerId: string;
  status: "outgoing" | "incoming" | "missed";
  duration: number;
  timestamp: number;
  isMe: boolean;
  withVideo: boolean;
}

/** Payload FCM data-пуша входящего звонка (шлёт Rust-бэкенд). */
export interface BackgroundCallPayload {
  type?: string;
  room_id?: string;
  caller_id?: string;
  caller_name?: string;
  caller_avatar?: string | null;
  peer_id?: string;
  [key: string]: unknown;
}

interface ActiveCall {
  roomId: string;
  peer: CallPeerInfo;
  direction: "outgoing" | "incoming";
  withVideo: boolean;
}

interface CallOverlayProps {
  /** ID текущего пользователя. */
  currentUserId: string;
  /** Исходящий звонок из профиля (null — нет активного исходящего). */
  outgoingCall: OutgoingCallRequest | null;
  /** Вызывается, когда оверлей «схватил» outgoingCall (сброс в родителе). */
  onOutgoingConsumed?: () => void;
  /** Эмитит лог завершённого звонка (вставка в чат). */
  onCallLog?: (data: CallLogData) => void;
  /** Текущий чат — используется для прослушивания входящих звонков без FCM. */
  selectedChatId?: string | null;
  selectedChatPeerName?: string | null;
  selectedChatPeerAvatar?: string | null;
  /** Данные текущего пользователя — для передачи caller metadata. */
  currentUserName?: string | null;
  currentUserAvatar?: string | null;
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Хелперы                                                            */
/* ═══════════════════════════════════════════════════════════════════ */

const isTauriRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Управляет полноэкранным режимом + поверх всего (для Tauri-окна). */
async function setCallWindow(fullscreen: boolean): Promise<void> {
  if (!isTauriRuntime) return;
  try {
    const win = getCurrentWindow();
    await win.setFullscreen(fullscreen);
    await win.setAlwaysOnTop(fullscreen);
  } catch (err) {
    console.warn("[CallOverlay] window control failed:", err);
  }
}

/**
 * Детерминированный room_id для пары пиров — стабильный канал
 * `call_<roomId>` для сигналинга (без утечки ID в имени канала).
 */
export function deriveRoomId(...ids: string[]): string {
  const joined = [...ids].sort().join("|");
  let h = 0;
  for (let i = 0; i < joined.length; i++) {
    h = (h * 31 + joined.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  VideoStream — привязка MediaStream к <video>                       */
/* ═══════════════════════════════════════════════════════════════════ */

function VideoStream({
  stream,
  muted,
  mirror,
  className,
}: {
  stream: MediaStream | null;
  muted: boolean;
  mirror?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    if (stream) {
      el.play().catch(() => {});
    }
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={cn(className, mirror && "-scale-x-100")}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Сетевые тосты                                                      */
/* ═══════════════════════════════════════════════════════════════════ */

type ToastTone = "warning" | "error" | "success";

interface NetworkToast {
  id: number;
  tone: ToastTone;
  title: string;
  sub?: string;
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Рингтон (Web Audio) + вибрация                                     */
/* ═══════════════════════════════════════════════════════════════════ */

/**
 * Программно эмулирует рингтон через Web Audio API (классический ringback
 * 440+480 Гц, повторяющийся) — без внешних аудиофайлов.
 */
function useRingtone(active: boolean): void {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      return;
    }

    const Ctor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    ctxRef.current = ctx;

    const ring = () => {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const start = ctx.currentTime + 0.05;
      const beep = (delay: number) => {
        const gain = ctx.createGain();
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        o1.type = "sine";
        o2.type = "sine";
        o1.frequency.value = 440;
        o2.frequency.value = 480;
        const t = start + delay;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o1.connect(gain);
        o2.connect(gain);
        gain.connect(ctx.destination);
        o1.start(t);
        o2.start(t);
        o1.stop(t + 0.45);
        o2.stop(t + 0.45);
      };
      beep(0);
      beep(0.6);
    };

    ring();
    intervalRef.current = window.setInterval(ring, 2200);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, [active]);
}

/** Повторяющаяся вибрация (только мобильные платформы). */
function useIncomingVibration(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.vibrate) return;
    const pattern = [300, 150, 300, 150, 600] as number[];
    const loop = () => navigator.vibrate(pattern);
    loop();
    const iv = window.setInterval(loop, 3600);
    return () => {
      window.clearInterval(iv);
      navigator.vibrate?.(0);
    };
  }, [active]);
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  PeerAvatar                                                         */
/* ═══════════════════════════════════════════════════════════════════ */

function PeerAvatar({
  peer,
  size = "lg",
}: {
  peer: CallPeerInfo;
  size?: "lg" | "xl";
}) {
  const dim = size === "xl" ? "w-36 h-36" : "w-24 h-24";
  const radius = size === "xl" ? "rounded-[2rem]" : "rounded-3xl";
  return (
    <div
      className={cn(
        dim,
        radius,
        "relative overflow-hidden ring-4 ring-white/10 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] shrink-0",
      )}
      style={
        peer.peerAccent
          ? { background: `linear-gradient(135deg, ${peer.peerAccent}, #0a0a0d)` }
          : undefined
      }
    >
      {peer.peerAvatar ? (
        <img
          src={peer.peerAvatar}
          alt={peer.peerName}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-6xl font-bold text-white/90">
          {peer.peerName.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

export function CallOverlay({
  currentUserId,
  outgoingCall,
  onOutgoingConsumed,
  onCallLog,
  selectedChatId,
  selectedChatPeerName,
  selectedChatPeerAvatar,
  currentUserName,
  currentUserAvatar,
}: CallOverlayProps) {
  /* ── Активный звонок (исходящий + входящий в одном состоянии) ── */
  const [call, setCall] = useState<ActiveCall | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  callRef.current = call;

  const connectTimeRef = useRef<number | null>(null);
  const logEmittedRef = useRef(false);
  const toastIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingIncomingOfferRef = useRef<SdpPayload | null>(null);

  /* ── WebRTC-цикл (сигналинг / кодеки / SVC / ICE Restart) ── */
  const webrtc = useWebRtcCall({
    roomId: call?.roomId ?? "",
    role: call?.direction === "outgoing" ? "caller" : "callee",
    enableVideo: call?.withVideo ?? true,
    enableAudio: true,
    ...(call?.direction === "outgoing"
      ? {
          callerId: currentUserId,
          callerName: currentUserName ?? undefined,
          callerAvatar: currentUserAvatar ?? null,
          calleeId: call.peer.peerId,
        }
      : {}),
    pendingOfferRef: pendingIncomingOfferRef,
  });

  /* ── 1. Исходящий звонок из пропа (кнопки профиля) ── */
  useEffect(() => {
    if (!outgoingCall) return;
    setCall({
      roomId: deriveRoomId(currentUserId, outgoingCall.peerId),
      peer: {
        peerId: outgoingCall.peerId,
        peerName: outgoingCall.peerName,
        peerAvatar: outgoingCall.peerAvatar,
        peerAccent: outgoingCall.peerAccent,
      },
      direction: "outgoing",
      withVideo: outgoingCall.withVideo,
    });
    connectTimeRef.current = null;
    logEmittedRef.current = false;
    onOutgoingConsumed?.();
  }, [outgoingCall, currentUserId, onOutgoingConsumed]);

  /* ── 1.5 Входящий звонок через Supabase Broadcast (без FCM) ── */
  // Подписка на персональный канал пользователя echo_calls_<userId> —
  // работает всегда при логине, независимо от того, какой чат выбран.
  // Caller отправляет OFFER на этот канал дополнительно к call_<roomId>,
  // поэтому callee получит звонок даже если не открыл чат с caller.
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase.channel(`echo_calls_${currentUserId}`, {
      config: { broadcast: { self: false } },
    });

    const handleOffer = (msg: { payload: any }) => {
      if (callRef.current) return;
      const payload = msg.payload;
      const callerId = String(payload.caller_id || "");
      if (!callerId) return;
      const roomId = deriveRoomId(currentUserId, callerId);
      // Сохраняем offer в ref ДО setCall, чтобы useWebRtcCall при монтировании
      // сразу его обработал (обход гонки: broadcast-слушатель срабатывает раньше,
      // чем поднимется WebRTC-стек).
      pendingIncomingOfferRef.current = payload;
      console.log("[CallOverlay] Incoming offer via personal channel:", callerId, payload.caller_name);
      setCall({
        roomId,
        peer: {
          peerId: callerId,
          peerName: String(payload.caller_name || "Входящий звонок"),
          peerAvatar: typeof payload.caller_avatar === "string" ? payload.caller_avatar : null,
        },
        direction: "incoming",
        withVideo: payload.with_video !== false,
      });
    };

    channel.on("broadcast", { event: SIGNAL_EVENT.OFFER }, handleOffer);
    channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        console.log("[CallOverlay] Listening for incoming calls on personal channel");
      }
    });

    return () => {
      supabase.removeChannel(channel);
      pendingIncomingOfferRef.current = null;
    };
  }, [currentUserId]);

  /* ── 1.6 Входящий звонок из нативного wake (Android: fullScreenIntent) ── */
  // MainActivity инжектит JS: window.dispatchEvent(new CustomEvent(
  // 'echo-native-incoming-call', { detail: { room_id, caller_id, ... } }))
  // когда FCM-пуш incoming_call будит приложение из фона.
  useEffect(() => {
    const handleNativeCall = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const roomId = String(detail.room_id || "");
      const callerId = String(detail.caller_id || "");
      if (!roomId || !callerId) return;
      if (callRef.current) return; // уже в звонке — игнорим
      console.log("[CallOverlay] Native wake incoming call:", callerId, detail.caller_name);
      setCall({
        roomId,
        peer: {
          peerId: callerId,
          peerName: String(detail.caller_name || "Входящий звонок"),
          peerAvatar: typeof detail.caller_avatar === "string" && detail.caller_avatar ? detail.caller_avatar : null,
        },
        direction: "incoming",
        withVideo: false,
      });
      connectTimeRef.current = null;
      logEmittedRef.current = false;
      void setCallWindow(true);
    };
    window.addEventListener("echo-native-incoming-call", handleNativeCall);
    return () => window.removeEventListener("echo-native-incoming-call", handleNativeCall);
  }, []);

  /* ── 2. Входящий звонок из FCM (background-call-received) ── */
  useEffect(() => {
    if (!isTauriRuntime) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;

    (async () => {
      try {
        const appWindow = getCurrentWindow();
        unlisten = await appWindow.listen<BackgroundCallPayload>(
          "background-call-received",
          (event) => {
            if (disposed) return;
            const p = event.payload ?? {};
            const roomId = String(p.room_id ?? "");
            const callerId = String(p.caller_id ?? p.peer_id ?? "");
            if (!roomId || !callerId) return;
            setCall({
              roomId,
              peer: {
                peerId: callerId,
                peerName: String(p.caller_name ?? "Входящий звонок"),
                peerAvatar:
                  typeof p.caller_avatar === "string" ? p.caller_avatar : null,
              },
              direction: "incoming",
              withVideo: false,
            });
            connectTimeRef.current = null;
            logEmittedRef.current = false;
            void setCallWindow(true);
          },
        );
      } catch (err) {
        console.warn("[CallOverlay] background listener failed:", err);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  /* ── 3. Разворот на весь экран, пока звонок активен ── */
  const hasCall = !!call;
  useEffect(() => {
    void setCallWindow(hasCall);
  }, [hasCall]);

  useEffect(() => {
    return () => {
      void setCallWindow(false);
    };
  }, []);

  /* ── 4. Автодозвон для исходящего (как только WebRTC готов) ── */
  useEffect(() => {
    if (call?.direction === "outgoing" && webrtc.status === "init") {
      void webrtc.startCall();
    }
  }, [call?.direction, webrtc.status, webrtc.startCall]);

  /* ── 5. Рингтон + вибрация для входящего (стейт Ringing) ── */
  const ringingActive =
    call?.direction === "incoming" && webrtc.status === "ringing";
  useRingtone(!!ringingActive);
  useIncomingVibration(!!ringingActive);

  /* ── 6. Таймер разговора (длительность + лог) ── */
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (webrtc.status === "connected") {
      connectTimeRef.current ??= Date.now();
    }
  }, [webrtc.status]);

  useEffect(() => {
    if (webrtc.status !== "connected") {
      setElapsed(0);
      return;
    }
    const iv = window.setInterval(() => {
      if (connectTimeRef.current != null) {
        setElapsed(Math.floor((Date.now() - connectTimeRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(iv);
  }, [webrtc.status]);

  /* ── 7. Адаптивные тосты качества сети ── */
  const [toasts, setToasts] = useState<NetworkToast[]>([]);
  const prevStatusRef = useRef<CallStatus>("idle");

  const pushToast = useCallback(
    (tone: ToastTone, title: string, sub?: string, ttl = 4000) => {
      toastIdRef.current += 1;
      const id = toastIdRef.current;
      setToasts((prev) => [...prev, { id, tone, title, sub }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
    },
    [],
  );

  useEffect(() => {
    const prev = prevStatusRef.current;
    const cur = webrtc.status;

    if (cur === "reconnecting" && prev !== "reconnecting") {
      pushToast(
        "warning",
        "Слабый сигнал. Снижаем качество видео...",
        "Включен SVC",
        6500,
      );
    } else if (cur === "failed") {
      pushToast(
        "error",
        "Связь потеряна. Попытка переподключения...",
        "ICE Restart",
        9000,
      );
    } else if (
      cur === "connected" &&
      (prev === "reconnecting" || prev === "failed")
    ) {
      pushToast("success", "Соединение восстановлено. Качество повышенно");
    }

    prevStatusRef.current = cur;
  }, [webrtc.status, pushToast]);

  /* ── 8. Завершение звонка + эмит лога ── */
  const finishCall = useCallback(
    (result: "manual" | "remote" | "declined" | "failed") => {
      if (logEmittedRef.current) return;
      const active = callRef.current;
      if (!active) return;

      const duration = connectTimeRef.current
        ? Math.max(0, Math.floor((Date.now() - connectTimeRef.current) / 1000))
        : 0;
      const wasConnected = webrtc.status === "connected";

      webrtc.endCall();

      let logStatus: CallLogData["status"];
      if (active.direction === "outgoing") {
        logStatus = "outgoing";
      } else {
        logStatus = wasConnected ? "incoming" : "missed";
      }

      logEmittedRef.current = true;
      onCallLog?.({
        roomId: active.roomId,
        peerId: active.peer.peerId,
        status: logStatus,
        duration,
        timestamp: Date.now(),
        isMe: true,
        withVideo: active.withVideo,
      });

      connectTimeRef.current = null;
      setCall(null);
      void setCallWindow(false);
    },
    [webrtc, onCallLog],
  );

  // Держим актуальный finishCall в рефе для подписчиков
  const finishCallRef = useRef(finishCall);
  finishCallRef.current = finishCall;

  // Звонок завершён на удалённой стороне / сам (status → "ended")
  useEffect(() => {
    if (webrtc.status === "ended" && callRef.current) {
      finishCallRef.current("remote");
    }
  }, [webrtc.status]);

  /* ── 9. Обработчики действий ── */
  const handleAccept = useCallback(() => {
    void webrtc.acceptCall();
  }, [webrtc.acceptCall]);

  const handleDecline = useCallback(() => {
    finishCallRef.current("declined");
  }, []);

  const handleEnd = useCallback(() => {
    finishCallRef.current("manual");
  }, []);

  const handleToggleMute = useCallback(() => {
    webrtc.toggleMute();
  }, [webrtc.toggleMute]);

  const handleToggleVideo = useCallback(() => {
    webrtc.toggleVideo();
  }, [webrtc.toggleVideo]);

  /* ── 10. Рендер ── */
  if (!call) return null;

  const { peer, direction, withVideo } = call;
  const isConnected = webrtc.status === "connected";
  const isRinging = webrtc.status === "ringing" && direction === "incoming";
  const showRemoteVideo = withVideo && !!webrtc.remoteStream;

  let stateText = "";
  if (direction === "outgoing") {
    stateText = withVideo ? "Видеозвонок..." : "Вызов...";
  } else if (isRinging) {
    stateText = "Входящий звонок...";
  } else if (webrtc.status === "reconnecting") {
    stateText = "Переподключение...";
  } else {
    stateText = "Соединение...";
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[200] bg-black overflow-hidden safe-top safe-bottom"
    >
      {/* ── Фон: видео собеседника или размытый градиент ── */}
      <div className="absolute inset-0">
        {showRemoteVideo && webrtc.remoteStream ? (
          <VideoStream
            stream={webrtc.remoteStream}
            muted={false}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background: peer.peerAccent
                ? `radial-gradient(circle at 30% 20%, ${peer.peerAccent}55, transparent 60%), linear-gradient(160deg,#0e0e16,#000)`
                : "linear-gradient(160deg,#14141c,#000)",
            }}
          />
        )}
        {!showRemoteVideo && <div className="absolute inset-0 backdrop-blur-2xl" />}
        <div className="absolute inset-0 bg-black/30" />
      </div>

      {/* ── Содержимое ── */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6">
        <AnimatePresence mode="wait">
          {isConnected ? (
            <motion.div
              key="connected"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center"
            >
              {/* Шапка: имя + таймер */}
              <div className="absolute top-8 inset-x-0 flex flex-col items-center pointer-events-none">
                <div className="text-lg font-bold text-white/90">{peer.peerName}</div>
                <div className="text-[13px] text-white/60 tabular-nums mt-0.5">
                  {formatCallDuration(elapsed)}
                </div>
              </div>

              {/* Окно собственной камеры (draggable PiP) */}
              {withVideo && webrtc.localStream && (
                <motion.div
                  drag
                  dragMomentum={false}
                  dragConstraints={containerRef}
                  dragElastic={0.1}
                  whileTap={{ scale: 0.96 }}
                  className="absolute top-20 right-5 z-20 w-28 h-40 rounded-2xl overflow-hidden bg-black/60 border border-white/10 shadow-2xl cursor-grab active:cursor-grabbing"
                >
                  <VideoStream
                    stream={webrtc.localStream}
                    muted
                    mirror
                    className="w-full h-full object-cover"
                  />
                </motion.div>
              )}

              {/* Нижняя панель управления */}
              <div className="absolute bottom-12 inset-x-0 flex items-center justify-center gap-7">
                <button
                  onClick={handleToggleMute}
                  aria-label={webrtc.isMuted ? "Включить микрофон" : "Выключить микрофон"}
                  className="w-14 h-14 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-xl border border-white/10 text-white active:scale-95 transition-transform"
                >
                  {webrtc.isMuted ? (
                    <TbMicrophoneOff className="w-6 h-6 text-red-300" />
                  ) : (
                    <TbMicrophone className="w-6 h-6" />
                  )}
                </button>

                {withVideo && (
                  <button
                    onClick={handleToggleVideo}
                    aria-label={webrtc.isVideoOff ? "Включить камеру" : "Выключить камеру"}
                    className="w-14 h-14 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-xl border border-white/10 text-white active:scale-95 transition-transform"
                  >
                    {webrtc.isVideoOff ? (
                      <TbVideoOff className="w-6 h-6 text-red-300" />
                    ) : (
                      <TbVideo className="w-6 h-6" />
                    )}
                  </button>
                )}

                <button
                  onClick={handleEnd}
                  aria-label="Завершить звонок"
                  className="w-16 h-16 rounded-full flex items-center justify-center bg-red-500 text-white shadow-[0_12px_40px_-8px_rgba(239,68,68,0.6)] active:scale-95 transition-transform"
                >
                  <TbPhoneOff className="w-7 h-7 rotate-[135deg]" />
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="caller"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="flex flex-col items-center gap-9"
            >
              {/* Пульсирующий аватар (для исходящего) */}
              <div className={cn("relative", direction === "outgoing" && "animate-pulse")}>
                <PeerAvatar peer={peer} size="xl" />
              </div>

              <div className="text-center">
                <div className="text-2xl font-bold text-white/95">{peer.peerName}</div>
                <div className="text-sm text-white/60 mt-1.5">{stateText}</div>
              </div>

              {/* Кнопки действий */}
              {isRinging ? (
                <div className="flex items-center gap-12">
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={handleDecline}
                      aria-label="Сбросить вызов"
                      className="w-16 h-16 rounded-full flex items-center justify-center bg-red-500 text-white shadow-[0_12px_40px_-8px_rgba(239,68,68,0.6)] active:scale-95 transition-transform"
                    >
                      <TbPhoneOff className="w-7 h-7" />
                    </button>
                    <span className="text-[11px] text-white/50">Сбросить</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={handleAccept}
                      aria-label="Принять вызов"
                      className="w-16 h-16 rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-[0_12px_40px_-8px_rgba(16,185,129,0.6)] active:scale-95 transition-transform"
                    >
                      <TbPhone className="w-7 h-7" />
                    </button>
                    <span className="text-[11px] text-white/50">Принять</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={handleEnd}
                    aria-label="Отменить"
                    className="w-16 h-16 rounded-full flex items-center justify-center bg-red-500 text-white shadow-[0_12px_40px_-8px_rgba(239,68,68,0.6)] active:scale-95 transition-transform"
                  >
                    <TbPhoneOff className="w-7 h-7" />
                  </button>
                  <span className="text-[11px] text-white/50">
                    {webrtc.status === "reconnecting" ? "Завершить" : "Отмена"}
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Тосты качества сети ── */}
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className={cn(
              "absolute z-30 max-w-[86%] px-4 py-2.5 rounded-2xl backdrop-blur-xl border flex items-start gap-2.5 shadow-2xl",
              t.tone === "warning" &&
                "top-6 left-1/2 -translate-x-1/2 bg-amber-500/15 border-amber-400/30",
              t.tone === "success" &&
                "top-6 left-1/2 -translate-x-1/2 bg-emerald-500/15 border-emerald-400/30",
              t.tone === "error" &&
                "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-500/15 border-red-400/30",
            )}
          >
            {t.tone === "warning" && (
              <TbSignal4G className="w-5 h-5 text-amber-300 shrink-0" />
            )}
            {t.tone === "success" && (
              <TbSignal4G className="w-5 h-5 text-emerald-300 shrink-0" />
            )}
            {t.tone === "error" && (
              <TbRotateClockwise className="w-5 h-5 text-red-300 shrink-0 animate-spin" />
            )}
            <div>
              <div className="text-[13px] font-semibold text-foreground">{t.title}</div>
              {t.sub && (
                <div className="text-[11px] text-foreground/60 mt-0.5">{t.sub}</div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}