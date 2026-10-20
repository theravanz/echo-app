"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  TbDeviceMobile as DeviceMobile,
  TbDeviceDesktop as DeviceDesktop,
  TbShieldCheck as ShieldCheck,
  TbCheck as Check,
  TbLoader2 as Loader,
  TbAlertTriangle as AlertTriangle,
  TbX as X,
} from "react-icons/tb";

function QrLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<"loading" | "ready" | "approved" | "error">("loading");
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const [userName, setUserName] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");

  // Label устройства (для отображения)
  useEffect(() => {
    const ua = navigator.userAgent;
    let label = "Web";
    if (/Android/i.test(ua)) label = "Android";
    else if (/iPhone|iPad/i.test(ua)) label = "iOS";
    else if (/Windows/i.test(ua)) label = "Windows";
    else if (/Macintosh|Mac OS/i.test(ua)) label = "macOS";
    else if (/Linux/i.test(ua)) label = "Linux";
    setDeviceLabel(`${label} • App`);
  }, []);

  // Проверяем: пользователь залогинен?
  const checkSession = useCallback(async () => {
    if (!token) {
      setStatus("error");
      setError("Отсутствует код авторизации. Отсканируйте QR-код заново.");
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserName(session.user.user_metadata?.display_name || session.user.email?.split("@")[0] || "пользователь");
        setStatus("ready");
      } else {
        // Нет сессии — редирект на обычный вход с возвратом на эту страницу
        router.replace(`/auth?returnTo=${encodeURIComponent(`/auth/qr?token=${token}`)}&addingAccount=true`);
      }
    } catch {
      setStatus("error");
      setError("Не удалось проверить авторизацию. Попробуйте ещё раз.");
    }
  }, [token, router]);

  useEffect(() => {
    const timer = setTimeout(() => checkSession(), 300);
    return () => clearTimeout(timer);
  }, [checkSession]);

  const handleApprove = async () => {
    if (!token) return;
    setApproving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Нет авторизации");

      // НЕЗАВИСИМАЯ сессия для нового устройства (фикс Already Used):
      // выпускаем одноразовый magiclink-тикет и кладём в challenge ЕГО,
      // а не текущие токены этого устройства. Второе устройство погасит
      // тикет через verifyOtp({ token_hash, type: 'email' }) и получит
      // СВОЮ пару access/refresh. Плюс не храним refresh-токен в таблице,
      // читаемой по токену (RLS "Anyone with token can read challenge").
      const { data: issued, error: issueErr } = await supabase.functions.invoke('qr-issue-session');
      if (issueErr || !issued?.token_hash) {
        throw new Error(issueErr?.message || "Не удалось выпустить сессию для нового устройства");
      }

      const { error } = await supabase
        .from("login_challenges")
        .update({
          status: "approved",
          user_id: session.user.id,
          session_data: { ticket: { token_hash: issued.token_hash, email: issued.email } },
          device_info: { label: deviceLabel, approved_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq("token", token)
        .eq("status", "pending");

      if (error) throw error;
      setStatus("approved");
    } catch (err: any) {
      console.error("[QR] Approve error:", err);
      setStatus("error");
      setError(err?.message || "Не удалось подтвердить вход");
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 py-10 relative overflow-hidden">
      <div className="absolute inset-0 noise-overlay pointer-events-none" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70vw] h-[70vw] max-w-md bg-primary/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-sm space-y-6">
        {/* Логотип */}
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-[20px] bg-primary/10 border border-primary/20 flex items-center justify-center shadow-2xl">
            <DeviceDesktop className="w-7 h-7 text-primary" />
          </div>
        </div>

        {status === "loading" && (
          <div className="text-center space-y-4 py-16">
            <Loader className="w-8 h-8 text-primary animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Проверяем авторизацию...</p>
          </div>
        )}

        {status === "error" && (
          <div className="text-center space-y-5">
            <div className="w-16 h-16 rounded-[24px] bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-display font-bold">Ошибка</h1>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <button
              onClick={() => { setStatus("loading"); checkSession(); }}
              className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              <DeviceMobile className="w-5 h-5" /> Попробовать снова
            </button>
            <button
              onClick={() => router.push("/")}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              На главную
            </button>
          </div>
        )}

        {status === "ready" && (
          <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <div className="relative inline-flex items-center justify-center">
              <div className="absolute inset-0 bg-primary/20 blur-[40px] rounded-full animate-pulse" />
              <div className="relative w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                <DeviceMobile className="w-8 h-8 text-primary" />
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-display font-bold">Войти на компьютере?</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Вы вошли как <span className="text-foreground font-semibold">{userName}</span>.
                Разрешите вход на устройстве <span className="text-foreground font-semibold">{deviceLabel}</span>?
              </p>
            </div>

            <div className="rounded-2xl bg-card border border-border p-4 flex items-center gap-3 text-left">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-primary" />
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Сессия будет привязана к вашему аккаунту. Код действителен 5 минут.
              </p>
            </div>

            <button
              onClick={handleApprove}
              disabled={approving}
              className={cn(
                "w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-3 shadow-xl shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-50",
                approving && "opacity-60"
              )}
            >
              {approving ? (
                <Loader className="w-5 h-5 animate-spin" />
              ) : (
                <Check className="w-5 h-5" />
              )}
              {approving ? "Подтверждаю..." : "Да, это я — войти"}
            </button>

            <button
              onClick={() => router.push("/")}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" /> Отмена
            </button>
          </div>
        )}

        {status === "approved" && (
          <div className="text-center space-y-6 animate-in fade-in duration-700">
            <div className="relative inline-flex items-center justify-center">
              <div className="absolute inset-0 bg-green-500/20 blur-[40px] rounded-full animate-pulse" />
              <div className="relative w-20 h-20 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center">
                <Check className="w-10 h-10 text-green-500" />
              </div>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-display font-bold">Вход подтверждён!</h1>
              <p className="text-sm text-muted-foreground">
                Компьютер {deviceLabel} теперь авторизован. Можете закрыть эту страницу.
              </p>
            </div>
            <button
              onClick={() => router.push("/")}
              className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold active:scale-[0.98] transition-all"
            >
              Готово
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function QrLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader className="w-8 h-8 text-primary animate-spin" />
      </div>
    }>
      <QrLoginContent />
    </Suspense>
  );
}

