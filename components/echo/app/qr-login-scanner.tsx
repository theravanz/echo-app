"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";
import { migratePrivateKeyToVault, loadPrivateKey } from "@/lib/db";
// @ts-ignore
import jsQR from "jsqr";
import {
  TbX as X,
  TbLoader2 as Loader,
  TbCheck as Check,
  TbAlertTriangle as AlertTriangle,
} from "react-icons/tb";

type ScanStatus = "scanning" | "sending" | "success" | "error";

/**
 * Встроенный QR-сканер для авторизации нового устройства (ПК).
 * Поток: камера → jsQR → парсинг app://auth?… → invoke('qr_send_e2ee_key')
 * (Rust: vault → эфемерная X25519 → SalsaBox → Supabase RPC).
 */
export function QrLoginScanner({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<ScanStatus>("scanning");
  const [error, setError] = useState("");

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

const handleQrFound = useCallback(async (raw: string) => {
    if (!raw.startsWith("app://auth?")) { setError("Неверный QR-код"); setStatus("error"); return; }
    const params = new URLSearchParams(raw.split("?")[1]);
    const sessionId = params.get("s") || params.get("session_id");
    const kB64Url = params.get("k") || params.get("web_pub_key");
    if (!sessionId || !kB64Url) { setError("QR не содержит session_id или web_pub_key"); setStatus("error"); return; }
    const b64 = kB64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const keyBytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const webPubKeyHex = Array.from(keyBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    setStatus("sending");
    stopCamera();
    try {
      // Гарантируем, что ключ реально в vault (миграция из localStorage при необходимости).
      const migrated = await migratePrivateKeyToVault();
      if (!migrated) {
        setError("E2EE-ключ не найден. Войдите в аккаунт на этом устройстве.");
        setStatus("error");
        return;
      }

      const { data: { session: mobileSession } } = await supabase.auth.getSession();
      if (!mobileSession) {
        setError("Не авторизован на этом устройстве");
        setStatus("error");
        return;
      }

      const { data: issued, error: issueErr } = await supabase.functions.invoke('qr-issue-session');
      if (issueErr || !issued?.token_hash) {
        setError("Не удалось выпустить сессию для нового устройства");
        setStatus("error");
        return;
      }

      const sessionData = { token_hash: issued.token_hash, type: "magiclink" as const };

      // Загружаем E2EE-ключ из vault (или localStorage-фолбэк) и передаём
      // в Rust-команду — Rust НЕ загружает ключ сам, фронтенд обязан его передать.
      const e2eeKey = await loadPrivateKey();
      if (!e2eeKey) {
        setError("E2EE-ключ не найден. Войдите в аккаунт на этом устройстве.");
        setStatus("error");
        return;
      }

      await invoke("qr_send_e2ee_key", { sessionId, webPubKey: webPubKeyHex, e2eeKey, sessionData });

      setStatus("success");
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      console.error("[QR Scanner] Failed:", err);
      setError(err?.message || String(err));
      setStatus("error");
    }
  }, [stopCamera, onClose]);

  useEffect(() => {
    let mounted = true;
    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Камера недоступна");
        // ideal:environment + разрешение 1280×720 — предпочитает основную
        // заднюю камеру, а не ultra-wide (0.6×), которая не фокусируется вблизи.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const canvas = canvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) return;
        const scanLoop = () => {
          if (!mounted) return;
          const video = videoRef.current;
          if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
            if (code && code.data) { handleQrFound(code.data); return; }
          }
          rafRef.current = requestAnimationFrame(scanLoop);
        };
        scanLoop();
      } catch (err: any) {
        console.error("[QR Scanner] Camera error:", err);
        setError(err?.message || "Не удалось получить доступ к камере");
        setStatus("error");
      }
    };
    startCamera();
    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [handleQrFound]);

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => { stopCamera(); onClose(); }} className="absolute top-6 right-6 w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all z-10">
        <X className="w-5 h-5" />
      </button>
      {status === "scanning" && (
        <>
          <div className="relative w-[280px] h-[280px] sm:w-[320px] sm:h-[320px]">
            <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover rounded-3xl" />
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-xl pointer-events-none" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-xl pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-xl pointer-events-none" />
            <div className="absolute left-4 right-4 h-0.5 bg-primary shadow-[0_0_10px_rgba(var(--primary),0.8)]" style={{ animation: "qrScanLine 2s ease-in-out infinite" }} />
          </div>
          <p className="text-white/50 text-sm font-mono uppercase tracking-widest mt-8">Наведите камеру на QR-код</p>
        </>
      )}
      {status === "sending" && (
        <div className="text-center space-y-6">
          <div className="relative inline-flex items-center justify-center">
            <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full animate-pulse" />
            <div className="relative w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"><Loader className="w-10 h-10 text-primary animate-spin" /></div>
          </div>
          <p className="text-white/70 text-sm font-mono uppercase tracking-widest">Отправка ключа…</p>
        </div>
      )}
      {status === "success" && (
        <div className="text-center space-y-6 animate-in fade-in duration-500">
          <div className="relative inline-flex items-center justify-center">
            <div className="absolute inset-0 bg-green-500/20 blur-3xl rounded-full animate-pulse" />
            <div className="relative w-20 h-20 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center"><Check className="w-10 h-10 text-green-500" /></div>
          </div>
          <p className="text-white text-lg font-display font-bold">Ключ отправлен!</p>
          <p className="text-white/40 text-xs font-mono uppercase tracking-widest">ПК авторизован. Можете закрыть окно.</p>
        </div>
      )}
      {status === "error" && (
        <div className="text-center space-y-6 px-8 max-w-sm">
          <div className="relative inline-flex items-center justify-center">
            <div className="absolute inset-0 bg-red-500/20 blur-3xl rounded-full" />
            <div className="relative w-20 h-20 rounded-full bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center"><AlertTriangle className="w-10 h-10 text-red-500" /></div>
          </div>
          <p className="text-white text-lg font-display font-bold">Ошибка</p>
          <p className="text-white/50 text-sm">{error}</p>
          <button onClick={() => { setStatus("scanning"); setError(""); window.location.reload(); }} className="px-6 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-sm font-bold uppercase tracking-widest transition-all">Повторить</button>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
      <style>{`@keyframes qrScanLine { 0% { top: 8%; } 50% { top: 92%; } 100% { top: 8%; } }`}</style>
    </div>
  );
}
