"use client";

/**
 * useWebRtcCall — изолированный хук для аудио-/видеозвонков через WebRTC
 * в Tauri-приложении Echo.
 *
 * Архитектура:
 *  1. Сигналинг — ТОЛЬКО Supabase Realtime Broadcast (эфемерный канал
 *     `call_<room_id>`), без записи SDP/ICE в БД. Метаданные связей не
 *     покидают память realtime-сервера дольше жизни канала.
 *  2. ICE — независимые публичные STUN (Google, Stunman). Российские
 *     серверы КАТЕГОРИЧЕСКИ запрещены (защита IP/метаданных от СОРМ).
 *  3. Кодеки — SDP-munging: AV1 > VP9 > H.264; на слабых девайсах откат
 *     на H.264. SVC (L3T3_KEY) + minBitrate 500 kbps для устойчивости
 *     на VPN / мобильных сетях.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════════
// КОНСТАНТЫ
// ═══════════════════════════════════════════════════════════════════

/**
 * ICE-серверы.
 *
 * ⚠️ ЗАЩИТА ОТ СОРМ: КАТЕГОРИЧЕСКИ запрещены российские STUN/TURN-серверы
 * (Яндекс, Mail.ru и т.д.) — они раскрывают IP-адреса и метаданные связей
 * пользователей госорганам. Используются независимые публичные STUN:
 *  • Google  — stun.l.google.com:19302
 *  • Stunman — stun.stunprotocol.org:3478
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.stunprotocol.org:3478" },
  // ┌──────────────────────────────────────────────────────────────────┐
  // │ TURN — заглушка. Сюда позже встанут приватные coturn-релеи.     │
  // │ ВАЖНО: релеи на НЕ-российской инфраструктуре (EU: Амстердам /   │
  // │ Хельсинки) для защиты метаданных от СОРМ.                        │
  // │ { urls: "turn:coturn.echo.example:3478",                        │
  // │   username: "...", credential: "...", credentialType: "password" }│
  // │ { urls: "turns:coturn.echo.example:5349", // TURN-over-TLS      │
  // │   username: "...", credential: "..." }                            │
  // └──────────────────────────────────────────────────────────────────┘
];

const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  // max-bundle: всё медиа по одному ICE-транспорту → меньше соединений,
  // меньше утечек метаданных.
  bundlePolicy: "max-bundle",
  // 'all' по умолчанию. Когда встанут TURN-релеи — можно переключить
  // на 'relay' для принудительного проксирования всего трафика.
  iceTransportPolicy: "all",
};

/** Приоритет кодеков для способных устройств (с аппаратным AV1/VP9). */
const CODEC_PRIORITY_HIGH: readonly string[] = ["av1", "vp9", "h264"];
/** Приоритет для слабых / старых девайсов (избегаем перегрева AV1/VP9). */
const CODEC_PRIORITY_LOW: readonly string[] = ["h264", "vp9", "av1"];

/** Минимальный битрейт видео — пол, ниже которого видео не падает. */
const MIN_VIDEO_BITRATE_BPS = 500_000;
/** Максимальный битрейт (верхняя граница SVC-слоёв). */
const MAX_VIDEO_BITRATE_BPS = 2_500_000;
const MAX_VIDEO_FRAMERATE = 30;
/** SVC: 3 пространственных + 3 временных слоя (VP9 / AV1). */
const SVC_MODE = "L3T3_KEY";
/** При деградации: жертвуем разрешением, держим FPS. */
const DEGRADATION_PREFERENCE: RTCDegradationPreference =
  "maintain-framerate";

/** getUserMedia-ограничения для звонка. */
const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: MAX_VIDEO_FRAMERATE, max: MAX_VIDEO_FRAMERATE },
    facingMode: "user",
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

/** События Supabase Broadcast (сигналинг). */
const SIGNAL_EVENT = {
  OFFER: "sdp-offer",
  ANSWER: "sdp-answer",
  ICE: "ice-candidate",
  END: "call-end",
} as const;

/** Задержка перед ICE-restart при disconnected. */
const ICE_DISCONNECT_RESTART_DELAY_MS = 8_000;

// ═══════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════

export type CallRole = "caller" | "callee";

export type CallStatus =
  | "idle"
  | "init"
  | "ringing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "failed";

/**
 * Расширение RTCRtpEncodingParameters для Chrome-only свойств
 * (не входят в стандарт W3C lib.dom.d.ts, но поддерживаются
 * Chromium-вебвью Tauri): minBitrate/maxBitrate и SVC scalabilityMode.
 */
interface VideoEncodingParameters extends RTCRtpEncodingParameters {
  minBitrate?: number;
  maxBitrate?: number;
  scalabilityMode?: string;
}

/** Сообщения сигналинга через Supabase Broadcast. */
interface SdpPayload {
  type: RTCSdpType;
  sdp: string;
}

interface IcePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface UseWebRtcCallOptions {
  /** Идентификатор комнаты звонка. Оба пира используют одинаковый ID. */
  roomId: string;
  /** Роль: caller инициирует offer, callee отвечает answer. */
  role: CallRole;
  /** Включить видеотрек (по умолчанию true). */
  enableVideo?: boolean;
  /** Включить аудиотрек (по умолчанию true). */
  enableAudio?: boolean;
}

export interface UseWebRtcCallReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  status: CallStatus;
  isMuted: boolean;
  isVideoOff: boolean;
  /** Caller: инициирует звонок (создаёт + отправляет SDP-offer). */
  startCall: () => Promise<void>;
  /** Callee: принимает входящий offer (создаёт + отправляет answer). */
  acceptCall: () => Promise<void>;
  /** Завершить звонок, закрыть соединение, освободить медиа. */
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// УТИЛИТЫ: детекция кодеков, оценка девайса, SDP-munging
// ═══════════════════════════════════════════════════════════════════

/**
 * Возвращает список видео-кодеков, доступных платформе для энкода,
 * через RTCRtpSender.getCapabilities('video'). Нижний регистр имён:
 * ['av1', 'vp9', 'vp8', 'h264', ...].
 */
function getAvailableVideoCodecs(): string[] {
  if (
    typeof RTCRtpSender === "undefined" ||
    typeof RTCRtpSender.getCapabilities !== "function"
  ) {
    // Вебвью без getCapabilities — безопасный фолбэк на H.264.
    return ["h264"];
  }
  const caps = RTCRtpSender.getCapabilities("video");
  if (!caps?.codecs) return [];
  return caps.codecs.map((c) => {
    // mimeType: 'video/AV1', 'video/VP9', 'video/H264'
    const name = c.mimeType.split("/")[1];
    return name.toLowerCase();
  });
}

/**
 * Эвристическая оценка мощности устройства.
 *  navigator.hardwareConcurrency — логические ядра CPU
 *  navigator.deviceMemory — ОЗУ в ГБ (только Chromium; иначе 4)
 *
 * 'high' — 8+ ядер / 8+ ГБ: безопасно для AV1/VP9.
 * 'mid'  — 4+ ядра / 4+ ГБ: VP9 предпочтительнее, AV1 приемлемо.
 * 'low'  — слабый: откат на H.264, чтобы избежать перегрева.
 */
function assessDeviceTier(): "high" | "mid" | "low" {
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (
    navigator as Navigator & { deviceMemory?: number }
  ).deviceMemory ?? 4;

  if (cores >= 8 && memory >= 8) return "high";
  if (cores >= 4 && memory >= 4) return "mid";
  return "low";
}

/**
 * Динамически формирует приоритетный список видео-кодеков на основе
 * возможностей платформы (getCapabilities) и класса устройства.
 * Возвращает только кодеки, которые реально доступны для энкода.
 */
function resolveCodecPriority(): string[] {
  const available = getAvailableVideoCodecs();
  const tier = assessDeviceTier();
  const desired =
    tier === "low" ? CODEC_PRIORITY_LOW : CODEC_PRIORITY_HIGH;
  return desired.filter((codec) => available.includes(codec));
}

/**
 * ── SDP-MUNGING ──
 *
 * Динамически переставляет payload types в m=video-строке SDP так, чтобы
 * предпочтительные кодеки шли первыми. Порядок PT в m=-строке определяет
 * приоритет кодеков (RFC 4566): первый PT — наиболее предпочтительный.
 *
 * RTX-записи (ретрансляция) переставляются вслед за своим базовым кодеком
 * (связь через a=fmtp:<rtx-pt> apt=<base-pt>).
 *
 * Вызывается ПЕРЕД setLocalDescription (для оффера/ансера) и ПЕРЕД
 * setRemoteDescription — как страховка поверх setCodecPreferences().
 */
function mungeSdpCodecPriority(
  sdp: string,
  preferredCodecs: string[],
): string {
  if (preferredCodecs.length === 0) return sdp;

  // Детектируем разделитель строк (RFC 4566 — CRLF, но WebRTC иногда \n).
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(eol);
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.startsWith("m=video")) {
      out.push(line);
      i++;
      continue;
    }

    // ── m=video секция: разбираем PT, rtpmap, fmtp ──────────────
    const mParts = line.split(" ");
    const header = mParts.slice(0, 3); // ['m=video', port, proto]
    const originalPts = mParts.slice(3);

    const rtpmap = new Map<string, string>(); // pt → codecName (lower)
    const rtxToBase = new Map<string, string>(); // rtx-pt → base-pt
    const sectionLines: string[] = [];

    i++; // следующая строка после m=
    while (i < lines.length && !lines[i].startsWith("m=")) {
      const sl = lines[i];
      sectionLines.push(sl);

      // a=rtpmap:<pt> <codec>/<clockrate>
      const rtpmapMatch = sl.match(/^a=rtpmap:(\d+) ([^/\s]+)/);
      if (rtpmapMatch) {
        rtpmap.set(rtpmapMatch[1], rtpmapMatch[2].toLowerCase());
      }

      // a=fmtp:<rtx-pt> apt=<base-pt>
      const fmtpMatch = sl.match(/^a=fmtp:(\d+).*apt=(\d+)/);
      if (fmtpMatch) {
        rtxToBase.set(fmtpMatch[1], fmtpMatch[2]);
      }
      i++;
    }

    // ── Перестановка PT по приоритету кодеков ───────────────────
    const ordered: string[] = [];
    const used = new Set<string>();

    const pushPt = (pt: string): void => {
      if (used.has(pt)) return;
      ordered.push(pt);
      used.add(pt);
      // RTX-запись тянется за своим базовым кодеком
      for (const [rtxPt, basePt] of rtxToBase) {
        if (basePt === pt && !used.has(rtxPt)) {
          ordered.push(rtxPt);
          used.add(rtxPt);
        }
      }
    };

    // Сначала — предпочтительные кодеки в заданном порядке
    for (const codecName of preferredCodecs) {
      for (const pt of originalPts) {
        if (rtpmap.get(pt) === codecName) pushPt(pt);
      }
    }
    // Затем — остальные в исходном порядке
    for (const pt of originalPts) {
      if (!used.has(pt)) pushPt(pt);
    }

    // ── Пересобираем m=video + секционные строки как есть ───────
    out.push([...header, ...ordered].join(" "));
    for (const sl of sectionLines) out.push(sl);
  }

  return out.join(eol);
}

/**
 * Применяет приоритет кодеков через стандартный API
 * RTCRtpTransceiver.setCodecPreferences() — вызывается ДО createOffer /
 * createAnswer. Это первичный, стандартный механизм; SDP-munging —
 * резервный (поверх).
 */
function applyCodecPreferences(
  transceiver: RTCRtpTransceiver,
  priority: string[],
): void {
  if (priority.length === 0) return;
  if (
    typeof RTCRtpSender === "undefined" ||
    typeof RTCRtpSender.getCapabilities !== "function"
  ) {
    return;
  }

  const caps = RTCRtpSender.getCapabilities("video");
  if (!caps?.codecs) return;

  // Фильтруем и сортируем доступные кодеки по нашему приоритету.
  const preferred = caps.codecs
    .filter((c) => {
      const name = c.mimeType.split("/")[1].toLowerCase();
      return priority.includes(name);
    })
    .sort((a, b) => {
      const an = a.mimeType.split("/")[1].toLowerCase();
      const bn = b.mimeType.split("/")[1].toLowerCase();
      return priority.indexOf(an) - priority.indexOf(bn);
    });

  // Добиваем оставшимися кодеками — setCodecPreferences требует полный
  // список, иначе удалённые кодеки станут недоступными для renegotiation.
  const remaining = caps.codecs.filter((c) => {
    const name = c.mimeType.split("/")[1].toLowerCase();
    return !priority.includes(name);
  });

  try {
    transceiver.setCodecPreferences([...preferred, ...remaining]);
  } catch (err) {
    console.warn(
      "[WebRTC] setCodecPreferences не удался — fallback на SDP-munging:",
      err,
    );
  }
}

/**
 * Жёстко фиксирует параметры видео-сендера через setParameters():
 *  • minBitrate ≥ 500 кбит/с — пол, ниже которого видео не падает
 *  • maxBitrate — верхняя граница SVC-слоёв
 *  • maxFramerate — 30 FPS
 *  • scalabilityMode = L3T3_KEY — SVC: 3 пространственных + 3 временных
 *    слоя. При деградации VPN-туннеля браузер сбрасывает верхние слои
 *    (снижает разрешение), сохраняя звонок без обрыва.
 *  • degradationPreference = maintain-framerate — жертвуем разрешением,
 *    держим FPS для плавного видео.
 */
async function applySvcAndBitrate(pc: RTCPeerConnection): Promise<void> {
  const priority = resolveCodecPriority();
  const supportsSvc =
    priority.includes("av1") || priority.includes("vp9");

  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;

    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }

    const enc = params.encodings[0] as VideoEncodingParameters;
    enc.minBitrate = MIN_VIDEO_BITRATE_BPS;
    enc.maxBitrate = MAX_VIDEO_BITRATE_BPS;
    enc.maxFramerate = MAX_VIDEO_FRAMERATE;

    if (supportsSvc) {
      enc.scalabilityMode = SVC_MODE;
    }

    params.degradationPreference = DEGRADATION_PREFERENCE;

    try {
      await sender.setParameters(params);
    } catch (err) {
      console.warn("[WebRTC] setParameters не удался для video-sender:", err);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// ХУК useWebRtcCall
// ═══════════════════════════════════════════════════════════════════

export function useWebRtcCall({
  roomId,
  role,
  enableVideo = true,
  enableAudio = true,
}: UseWebRtcCallOptions): UseWebRtcCallReturn {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(!enableVideo);

  // ── Refs (актуальные значения внутри коллбэков без ре-рендера) ────
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const roleRef = useRef(role);
  const statusRef = useRef<CallStatus>(status);
  const pendingOfferRef = useRef<SdpPayload | null>(null);
  const codecPriorityRef = useRef<string[]>([]);
  const iceRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isMountedRef = useRef(true);
  const enableVideoRef = useRef(enableVideo);
  const enableAudioRef = useRef(enableAudio);

  roleRef.current = role;
  enableVideoRef.current = enableVideo;
  enableAudioRef.current = enableAudio;

  // ── setStatusSafe: обновляет state + ref синхронно ─────────────────
  const setStatusSafe = useCallback((s: CallStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // ── sendSignal: отправка через Supabase Broadcast ──────────────────
  const sendSignal = useCallback(
    async (event: string, payload: Record<string, unknown>): Promise<void> => {
      const ch = channelRef.current;
      if (!ch) return;
      try {
        const result = await ch.send({
          type: "broadcast",
          event,
          payload,
        });
        if (result !== "ok") {
          console.warn(`[WebRTC] signal "${event}" → ${result}`);
        }
      } catch (err) {
        console.error(`[WebRTC] signal "${event}" failed:`, err);
      }
    },
    [],
  );

  // ── acquireLocalStream: getUserMedia (камера + микрофон) ──────────
  const acquireLocalStream = useCallback(async (): Promise<MediaStream> => {
    const constraints: MediaStreamConstraints = {
      video: enableVideoRef.current ? MEDIA_CONSTRAINTS.video : false,
      audio: enableAudioRef.current ? MEDIA_CONSTRAINTS.audio : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  // ── handleRemoteOffer: callee обрабатывает входящий offer ──────────
  const handleRemoteOffer = useCallback(
    async (payload: SdpPayload, isRestart: boolean): Promise<void> => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const munged = mungeSdpCodecPriority(
          payload.sdp,
          codecPriorityRef.current,
        );
        await pc.setRemoteDescription({ type: "offer", sdp: munged });

        const answer = await pc.createAnswer();
        const mungedAnswer = mungeSdpCodecPriority(
          answer.sdp ?? "",
          codecPriorityRef.current,
        );
        await pc.setLocalDescription({ type: "answer", sdp: mungedAnswer });

        await sendSignal(SIGNAL_EVENT.ANSWER, {
          type: "answer",
          sdp: pc.localDescription!.sdp,
        });
        await applySvcAndBitrate(pc);
        setStatusSafe(isRestart ? "reconnecting" : "connecting");
      } catch (err) {
        console.error("[WebRTC] handleRemoteOffer failed:", err);
        setStatusSafe("failed");
      }
    },
    [sendSignal, setStatusSafe],
  );

  // ── handleRemoteAnswer: caller обрабатывает входящий answer ────────
  const handleRemoteAnswer = useCallback(
    async (payload: SdpPayload): Promise<void> => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const munged = mungeSdpCodecPriority(
          payload.sdp,
          codecPriorityRef.current,
        );
        await pc.setRemoteDescription({ type: "answer", sdp: munged });
        await applySvcAndBitrate(pc);
      } catch (err) {
        console.error("[WebRTC] handleRemoteAnswer failed:", err);
        setStatusSafe("failed");
      }
    },
    [setStatusSafe],
  );

  // ── addRemoteIceCandidate ──────────────────────────────────────────
  const addRemoteIceCandidate = useCallback(
    async (payload: IcePayload): Promise<void> => {
      const pc = pcRef.current;
      if (!pc || pc.remoteDescription == null) return;
      try {
        await pc.addIceCandidate(
          new RTCIceCandidate({
            candidate: payload.candidate,
            sdpMid: payload.sdpMid,
            sdpMLineIndex: payload.sdpMLineIndex,
          }),
        );
      } catch (err) {
        // Часто бывает при гонке ICE vs SDP — логируем, не валимся
        console.warn("[WebRTC] addIceCandidate error:", err);
      }
    },
    [],
  );

  // ── restartIce: caller перевыставляет offer с iceRestart:true ─────
  const restartIce = useCallback(async (): Promise<void> => {
    const pc = pcRef.current;
    if (!pc || roleRef.current !== "caller") return;
    if (statusRef.current === "ended" || statusRef.current === "idle") return;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      const munged = mungeSdpCodecPriority(offer.sdp ?? "", codecPriorityRef.current);
      await pc.setLocalDescription({ type: "offer", sdp: munged });
      await sendSignal(SIGNAL_EVENT.OFFER, {
        type: "offer",
        sdp: pc.localDescription!.sdp,
      });
      console.info("[WebRTC] ICE restart initiated");
    } catch (err) {
      console.error("[WebRTC] ICE restart failed:", err);
      setStatusSafe("failed");
    }
  }, [sendSignal, setStatusSafe]);

    // ── startCall: caller создаёт + отправляет SDP-offer ──────────────
  const startCall = useCallback(async (): Promise<void> => {
    const pc = pcRef.current;
    if (!pc || roleRef.current !== "caller") return;
    if (statusRef.current !== "init" && statusRef.current !== "connected") {
      return;
    }
    try {
      setStatusSafe("connecting");
      const offer = await pc.createOffer();
      const munged = mungeSdpCodecPriority(offer.sdp ?? "", codecPriorityRef.current);
      await pc.setLocalDescription({ type: "offer", sdp: munged });
      await sendSignal(SIGNAL_EVENT.OFFER, {
        type: "offer",
        sdp: pc.localDescription!.sdp,
      });
    } catch (err) {
      console.error("[WebRTC] startCall failed:", err);
      setStatusSafe("failed");
    }
  }, [sendSignal, setStatusSafe]);

  // ── acceptCall: callee принимает входящий offer ───────────────────
  const acceptCall = useCallback(async (): Promise<void> => {
    if (roleRef.current !== "callee") return;
    const offer = pendingOfferRef.current;
    if (!offer) return;
    pendingOfferRef.current = null;
    await handleRemoteOffer(offer, false);
  }, [handleRemoteOffer]);

  // ── endCallInternal: очистка PC, медиа, канала ────────────────────
  const endCallInternal = useCallback(
    (reason: "user" | "remote" | "cleanup"): void => {
      // Уведомляем пира только при инициации пользователем
      if (reason === "user") {
        void sendSignal(SIGNAL_EVENT.END, {});
      }

      if (iceRestartTimerRef.current) {
        clearTimeout(iceRestartTimerRef.current);
        iceRestartTimerRef.current = null;
      }

      const pc = pcRef.current;
      if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;
        pc.close();
        pcRef.current = null;
      }

      const ls = localStreamRef.current;
      if (ls) {
        ls.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      setLocalStream(null);

      remoteStreamRef.current = null;
      setRemoteStream(null);

      const ch = channelRef.current;
      if (ch) {
        supabase.removeChannel(ch);
        channelRef.current = null;
      }

      pendingOfferRef.current = null;
      setStatusSafe(reason === "cleanup" ? "idle" : "ended");
    },
    [sendSignal, setStatusSafe],
  );

  // ── endCall: публичная функция завершения звонка ──────────────────
  const endCall = useCallback(() => {
    endCallInternal("user");
  }, [endCallInternal]);

  // ── toggleMute: микрофон вкл/выкл без renegotiation ───────────────
  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;
    const newEnabled = !audioTracks[0].enabled;
    audioTracks.forEach((t) => {
      t.enabled = newEnabled;
    });
    setIsMuted(!newEnabled);
  }, []);

  // ── toggleVideo: камера вкл/выкл без renegotiation ────────────────
  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) return;
    const newEnabled = !videoTracks[0].enabled;
    videoTracks.forEach((t) => {
      t.enabled = newEnabled;
    });
    setIsVideoOff(!newEnabled);
  }, []);

  // ── Инициализация: PC + медиа + Broadcast-сигналинг ──────────────
  useEffect(() => {
    if (!roomId) return;
    isMountedRef.current = true;
    let cancelled = false;

    const init = async () => {
      try {
        // 1. Локальный медиапоток (камера + микрофон)
        const stream = await acquireLocalStream();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        // 2. RTCPeerConnection
        codecPriorityRef.current = resolveCodecPriority();
        const pc = new RTCPeerConnection(RTC_CONFIG);
        pcRef.current = pc;

        // Входящий удалённый трек → формируем remoteStream
        pc.ontrack = (ev: RTCTrackEvent) => {
          if (!isMountedRef.current) return;
          const existing = remoteStreamRef.current;
          if (existing && existing.getTracks().some((t) => t.id === ev.track.id)) {
            return;
          }
          const tracks = existing
            ? [...existing.getTracks(), ev.track]
            : [ev.track];
          const rs = new MediaStream(tracks);
          remoteStreamRef.current = rs;
          setRemoteStream(rs);
        };

        // Trickle ICE → отправляем кандидатов через broadcast
        pc.onicecandidate = (ev: RTCPeerConnectionIceEvent) => {
          if (!ev.candidate) return; // gathering complete
          void sendSignal(SIGNAL_EVENT.ICE, {
            candidate: ev.candidate.candidate,
            sdpMid: ev.candidate.sdpMid,
            sdpMLineIndex: ev.candidate.sdpMLineIndex,
          });
        };

        // Мониторинг ICE-состояния → авто-рестарт при просадках VPN
        pc.oniceconnectionstatechange = () => {
          const state = pc.iceConnectionState;
          if (state === "connected") {
            setStatusSafe("connected");
          } else if (state === "disconnected") {
            setStatusSafe("reconnecting");
            if (iceRestartTimerRef.current) {
              clearTimeout(iceRestartTimerRef.current);
            }
            iceRestartTimerRef.current = setTimeout(() => {
              if (
                pc.iceConnectionState === "disconnected" ||
                pc.iceConnectionState === "failed"
              ) {
                void restartIce();
              }
            }, ICE_DISCONNECT_RESTART_DELAY_MS);
          } else if (state === "failed") {
            if (iceRestartTimerRef.current) {
              clearTimeout(iceRestartTimerRef.current);
            }
            void restartIce();
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed") {
            setStatusSafe("failed");
          }
        };

        // 3. Добавляем треки + применяем приоритет кодеков к video-трансиверу
        for (const track of stream.getTracks()) {
          const sender = pc.addTrack(track, stream);
          if (track.kind === "video") {
            const transceiver = pc
              .getTransceivers()
              .find((t) => t.sender === sender);
            if (transceiver) {
              applyCodecPreferences(transceiver, codecPriorityRef.current);
            }
          }
        }

        // 4. SVC + битрейт (minBitrate 500 kbps, L3T3_KEY)
        await applySvcAndBitrate(pc);

        // 5. Подписка на Supabase Broadcast-канал звонка
        const channel = supabase.channel(`call_${roomId}`, {
          config: {
            // self:false — не получать собственные broadcast-сообщения
            // (критично: caller не должен получить свой же оффер)
            broadcast: { self: false },
          },
        });

        // ─ Входящие SDP-offer (callee или ICE-restart) ──
        channel.on<SdpPayload>(
          "broadcast",
          { event: SIGNAL_EVENT.OFFER },
          (msg) => {
            if (!isMountedRef.current) return;
            const payload = msg.payload;
            if (roleRef.current !== "callee") return;
            if (
              statusRef.current === "connected" ||
              statusRef.current === "reconnecting"
            ) {
              void handleRemoteOffer(payload, true);
            } else if (
              statusRef.current === "idle" ||
              statusRef.current === "init"
            ) {
              pendingOfferRef.current = payload;
              setStatusSafe("ringing");
            }
          },
        );

        // ─ Входящие SDP-answer (caller) ──
        channel.on<SdpPayload>(
          "broadcast",
          { event: SIGNAL_EVENT.ANSWER },
          (msg) => {
            if (!isMountedRef.current) return;
            if (roleRef.current !== "caller") return;
            if (
              statusRef.current === "connecting" ||
              statusRef.current === "reconnecting"
            ) {
              void handleRemoteAnswer(msg.payload);
            }
          },
        );

        // ─ Входящие ICE-кандидаты ──
        channel.on<IcePayload>(
          "broadcast",
          { event: SIGNAL_EVENT.ICE },
          (msg) => {
            if (!isMountedRef.current) return;
            void addRemoteIceCandidate(msg.payload);
          },
        );

        // ─ Входящее завершение звонка ──
        channel.on("broadcast", { event: SIGNAL_EVENT.END }, () => {
          if (!isMountedRef.current) return;
          endCallInternal("remote");
        });

        channelRef.current = channel;

        channel.subscribe((status: string, err?: Error) => {
          if (!isMountedRef.current) return;
          if (status === "SUBSCRIBED") {
            if (statusRef.current === "idle") {
              setStatusSafe("init");
            }
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            console.error("[WebRTC] channel error:", err);
          }
        });

        if (!cancelled) {
          setStatusSafe("init");
        }
      } catch (err) {
        console.error("[WebRTC] init failed:", err);
        if (!cancelled) {
          setStatusSafe("failed");
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      endCallInternal("cleanup");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  return {
    localStream,
    remoteStream,
    status,
    isMuted,
    isVideoOff,
    startCall,
    acceptCall,
    endCall,
    toggleMute,
    toggleVideo,
  };
}