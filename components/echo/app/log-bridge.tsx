"use client";

import { useEffect } from "react";
import { info, warn as logWarn, error as logError } from "@tauri-apps/plugin-log";

/**
 * Мост JS-консоли → нативные логи (logcat на Android, Console/os_log на iOS).
 *
 * Зачем: console.* из WebView в logcat НЕ попадает никогда, а отлаживать
 * мобильные фичи ([OPEN-MOBILE] и т.п.) нужно по `adb logcat`. Плагин-log
 * (Rust-сторона, инициализируется в lib.rs) на Android пишет через
 * android_logger — значит, любое console.* достаточно переслать командой
 * `plugin:log|log`, и оно появится в logcat.
 *
 * Почему без attachConsole/ретрансляции Rust→JS→Rust: Rust-логи и так видны
 * в logcat; встречное прокидывание создало бы цикл console→плагин→событие
 * `log://log`→console→плагин→…
 *
 * Подмена только на клиенте (SSR не исполняет effect), восстановление в
 * cleanup — чтобы StrictMode-двойной монтаж не навесил два форвардера.
 */
export function LogBridge() {
  useEffect(() => {
    const fmt = (args: unknown[]): string =>
      args
        .map((a) => {
          if (typeof a === "string") return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" ");

    const forward = (send: (msg: string) => Promise<void>) =>
      (...args: unknown[]) => {
        // Сам invoke внутри плагина console.* не вызывает — рекурсии нет;
        // ошибки доставки молча глотаем: лог-мост не должен ломать приложение.
        void send(fmt(args)).catch(() => {});
      };

    const orig = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    console.log = forward(info);
    console.info = forward(info);
    // Уровень Debug фильтруется (логгер настроен на Info) — несём как info.
    console.debug = forward((msg) => info(`[debug] ${msg}`));
    console.warn = forward(logWarn);
    console.error = forward(logError);

    return () => {
      console.log = orig.log;
      console.info = orig.info;
      console.warn = orig.warn;
      console.error = orig.error;
      console.debug = orig.debug;
    };
  }, []);

  return null;
}