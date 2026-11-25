"use client";

/**
 * UpdateManager — фоновые OTA-обновления интерфейса.
 *
 * Монтируется один раз в корневом layout. Логика:
 *  1. При старте подтверждаем текущий бандл (`notifyReady`) — это heartbeat
 *     tauri-plugin-hotswap: если новый бандл «сломался», следующий запуск
 *     автоматически откатится на предыдущую версию.
 *  2. Раз в N часов (и при возврате в приложение) проверяем manifest.json
 *     в Supabase Storage с `?t=Date.now()` — CDN не должен отдавать старый
 *     манифест.
 *  3. Если нативная версия ниже min_binary_version — OTA не ставим, показываем
 *     уведомление «обновите приложение».
 *  4. Иначе тихо скачиваем и распаковываем бандл в фоне (`downloadUpdate`).
 *  5. После загрузки показываем ненавязчивый баннер. По клику — `activateUpdate`
 *     + reload WebView, без перезапуска процесса.
 *
 * В браузере (next dev / обычный web) компонент ничего не делает: isTauri()
 * == false.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import {
  activateUpdate,
  checkUpdate,
  downloadUpdate,
  notifyReady,
  onDownloadProgress,
  type DownloadProgress,
} from "tauri-plugin-hotswap-api";
import { toast } from "sonner";
import { TbRefresh } from "react-icons/tb";
import {
  OTA_ENABLED,
  OTA_NATIVE_DOWNLOAD_URL,
  compareVersions,
  fetchOtaManifest,
  getMinNativeVersion,
  type OtaManifest,
} from "@/lib/ota";
import { cn } from "@/lib/utils";

/** Период фоновой проверки. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 часов
/** Не дёргаем сеть в первые секунды запуска — приложение и так грузится. */
const STARTUP_DELAY_MS = 5_000;

export function UpdateManager() {
  const [readyVersion, setReadyVersion] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  const mountedRef = useRef(true);
  const checkingRef = useRef(false);
  const downloadedRef = useRef<string | null>(null);
  const lastCheckRef = useRef(0);
  const nativeNoticeVersionRef = useRef<string | null>(null);

  const openNativeDownload = useCallback(async () => {
    if (!OTA_NATIVE_DOWNLOAD_URL) return;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(OTA_NATIVE_DOWNLOAD_URL);
    } catch {
      window.open(OTA_NATIVE_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
    }
  }, []);

  const showNativeOutdated = useCallback(
    (minNativeVersion: string) => {
      if (nativeNoticeVersionRef.current === minNativeVersion) return;
      nativeNoticeVersionRef.current = minNativeVersion;

      toast.error("Нужно обновить приложение", {
        id: "ota-native-outdated",
        description: `Новая версия интерфейса требует Echo ${minNativeVersion} или новее. Скачайте свежий установщик.`,
        duration: Infinity,
        action: OTA_NATIVE_DOWNLOAD_URL
          ? { label: "Скачать", onClick: () => void openNativeDownload() }
          : undefined,
      });
    },
    [openNativeDownload],
  );

  const checkForUpdate = useCallback(async () => {
    if (!OTA_ENABLED || !isTauri()) return;
    // Уже скачали — ждём решения пользователя (перезапуск).
    if (checkingRef.current || downloadedRef.current) return;

    checkingRef.current = true;
    lastCheckRef.current = Date.now();

    try {
      // Preflight-манифест: нужен для проверки нативной совместимости и
      // человекочитаемых данных (размер, notes). Основную проверку всё равно
      // делает Rust-плагин — он же проверяет подпись и sequence.
      let manifest: OtaManifest | null = null;
      try {
        manifest = await fetchOtaManifest();
      } catch (error) {
        console.warn("[OTA] manifest preflight failed:", error);
      }

      if (manifest) {
        const minNative = getMinNativeVersion(manifest);
        if (minNative) {
          const nativeVersion = await getVersion();
          if (compareVersions(nativeVersion, minNative) < 0) {
            console.info(
              `[OTA] native ${nativeVersion} < required ${minNative}; skip OTA bundle`,
            );
            showNativeOutdated(minNative);
            return;
          }
        }
      }

      const result = await checkUpdate();
      if (!result.available) return;

      if (mountedRef.current) setDownloading(true);
      try {
        // downloadUpdate() скачивает, проверяет minisign-подпись и
        // распаковывает бандл, но НЕ активирует его. Приложение продолжает
        // работать на текущей версии, пока пользователь не нажмёт «Перезапустить».
        const version = await downloadUpdate();
        downloadedRef.current = version;
        if (mountedRef.current) {
          setReadyVersion(version);
          setProgress(null);
        }
        console.info(`[OTA] bundle ${version} downloaded and verified`);
      } finally {
        if (mountedRef.current) setDownloading(false);
      }
    } catch (error) {
      // Фоновая проверка не должна ломать приложение и шуметь в UI.
      console.warn("[OTA] update check failed:", error);
    } finally {
      checkingRef.current = false;
    }
  }, [showNativeOutdated]);

  const handleRestart = useCallback(async () => {
    if (!readyVersion || activating) return;
    setActivating(true);
    try {
      await activateUpdate();
    } catch (error) {
      // Если активация не удалась (например, кэш уже подхвачен), всё равно
      // перезагружаем WebView — embedded-ассеты останутся рабочими.
      console.warn("[OTA] activate failed, reloading anyway:", error);
    } finally {
      window.location.reload();
    }
  }, [activating, readyVersion]);

  useEffect(() => {
    if (!OTA_ENABLED || !isTauri()) return;

    mountedRef.current = true;
    // Чтобы visibilitychange в первые секунды не запустил вторую проверку
    // параллельно со startup-таймером.
    lastCheckRef.current = Date.now();
    let cancelled = false;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let unlistenProgress: (() => void) | undefined;

    // Прогресс скачивания: только для логов/диагностики. Пользователю
    // показываем баннер уже после успешной загрузки — «тихий» фон.
    void onDownloadProgress((p) => {
      if (!mountedRef.current) return;
      setProgress(p);
      const pct = p.total ? Math.round((p.downloaded / p.total) * 100) : null;
      if (pct !== null && pct % 25 === 0) {
        console.info(`[OTA] downloading: ${pct}%`);
      }
    })
      .then((unlisten) => {
        if (mountedRef.current) unlistenProgress = unlisten;
        else unlisten();
      })
      .catch(() => {});

    const bootstrap = async () => {
      // Heartbeat: подтверждаем, что текущий (в т.ч. OTA) бандл работает.
      try {
        await notifyReady();
      } catch (error) {
        console.warn("[OTA] notifyReady failed:", error);
      }

      if (cancelled) return;
      startupTimer = setTimeout(() => {
        void checkForUpdate();
      }, STARTUP_DELAY_MS);
    };

    void bootstrap();

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void checkForUpdate();
    }, CHECK_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // При возврате в приложение проверяем не чаще раза в 30 минут.
      if (Date.now() - lastCheckRef.current < 30 * 60 * 1000) return;
      void checkForUpdate();
    };

    const onOnline = () => {
      if (Date.now() - lastCheckRef.current < 5 * 60 * 1000) return;
      void checkForUpdate();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (startupTimer) clearTimeout(startupTimer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      unlistenProgress?.();
    };
  }, [checkForUpdate]);

  const percent =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <AnimatePresence>
      {readyVersion ? (
        <motion.div
          key="ota-ready"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="pointer-events-none fixed inset-x-0 bottom-24 z-[120] flex justify-center px-3 md:bottom-6"
        >
          <div className="pointer-events-auto flex max-w-[min(92vw,26rem)] items-center gap-3 rounded-full border border-border/70 bg-background/95 py-2 pl-2 pr-2.5 shadow-lg shadow-black/10 backdrop-blur-md">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <TbRefresh className={cn("h-5 w-5", activating && "animate-spin")} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight">
                Доступно обновление интерфейса
              </p>
              <p className="truncate text-[11px] leading-tight text-muted-foreground">
                {activating ? "Применяем…" : `Версия ${readyVersion}`}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleRestart()}
              disabled={activating}
              className="shrink-0 rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
            >
              {activating ? "…" : "Перезапустить"}
            </button>
          </div>
        </motion.div>
      ) : downloading && percent !== null ? (
        // Необязательный деликатный индикатор: только проценты, без модалок.
        <motion.div
          key="ota-downloading"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="pointer-events-none fixed inset-x-0 bottom-24 z-[120] flex justify-center px-3 md:bottom-6"
        >
          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-md backdrop-blur">
            <TbRefresh className="h-3.5 w-3.5 animate-spin" />
            Загрузка обновления… {percent}%
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
