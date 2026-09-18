"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";

export interface DragState {
  active: boolean;
  overChatArea: boolean;
  overChatId: string | null;
}

// Один слушатель на процесс: повторные подписки (HMR/StrictMode) гасим
let globalUnlisten: (() => void) | null = null;

interface Options {
  enabled: boolean;
  selectedChatId: string | null;
  onSendFiles: (files: File[], targetChatId: string) => void;
  onOpenChat: (chatId: string) => void;
}

const OPEN_DELAY_MS = 600;   // подержал файл на чате → открыли
const HIT_INTERVAL_MS = 40;  // троттлинг hit-test (~25 Гц)

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", pdf: "application/pdf", zip: "application/zip",
  txt: "text/plain", md: "text/markdown", mp4: "video/mp4",
  mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav",
};

export function useFileDragDrop({ enabled, selectedChatId, onSendFiles, onOpenChat }: Options): DragState {
  const [state, setState] = useState<DragState>({ active: false, overChatArea: false, overChatId: null });
  const stateRef = useRef(state);
  const optsRef = useRef({ selectedChatId, onSendFiles, onOpenChat });
  optsRef.current = { selectedChatId, onSendFiles, onOpenChat };
  const lastChatElRef = useRef<Element | null>(null);

  const setFull = (s: DragState) => { stateRef.current = s; setState(s); };

  // ГЕОМЕТРИЧЕСКИЙ hit-test. document.elementFromPoint во время нативной
  // drag-сессии WKWebView возвращает мусор — считаем по rect'ам напрямую.
  const hitTest = (cssX: number, cssY: number) => {
    const els = document.querySelectorAll<HTMLElement>("[data-dropchat]");
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (cssX >= r.left && cssX <= r.right && cssY >= r.top && cssY <= r.bottom) {
        return { chatId: el.getAttribute("data-dropchat"), inArea: false, chatEl: el };
      }
    }
    const ar = document.querySelector("[data-chatarea]")?.getBoundingClientRect();
    const inArea = !!ar && cssX >= ar.left && cssX <= ar.right && cssY >= ar.top && cssY <= ar.bottom;
    return { chatId: null, inArea, chatEl: null };
  };

  // Подсветка чата — императивно: сайдбар не знает про drag-state
const markChat = useCallback((chatEl: Element | null) => {
    if (lastChatElRef.current === chatEl) return;
    lastChatElRef.current?.classList.remove("drag-target");
    chatEl?.classList.add("drag-target");
    lastChatElRef.current = chatEl;
}, []);

  const applyHit = useCallback((cssX: number, cssY: number) => {
    const { chatId, inArea, chatEl } = hitTest(cssX, cssY);
    markChat(chatId ? chatEl : null);
    console.warn("[HIT]", Math.round(cssX), Math.round(cssY), "→",
      chatId ?? (inArea ? "AREA" : "∅"),
      "| live:", chatEl?.isConnected,
      "| class:", (lastChatElRef.current as HTMLElement | null)?.classList.contains("drag-target"));
    const prev = stateRef.current;
    if (prev.overChatId !== chatId || prev.overChatArea !== inArea) {
      setFull({ ...prev, overChatId: chatId, overChatArea: inArea });
    }
  }, [markChat]);

  // Задержка открытия чата под файлом
  useEffect(() => {
    const oc = state.overChatId;
    if (!oc || oc === optsRef.current.selectedChatId) return;
    const t = setTimeout(() => optsRef.current.onOpenChat(oc), OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [state.overChatId]);

  useEffect(() => {
    if (!enabled) return;
    if (!("__TAURI_INTERNALS__" in window)) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    let lastHitAt = 0;
    let lastDropAt = 0;

    const reset = () => {
      markChat(null);
      setFull({ active: false, overChatArea: false, overChatId: null });
    };

    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          const p: any = event.payload;
          if (p.type === "enter" || p.type === "over") {
            if (!stateRef.current.active) {
              setFull({ active: true, overChatArea: false, overChatId: null });
            }
            // ВАЖНО: у over-событий в Tauri v2 НЕТ поля paths (paths только
            // у enter/drop). Гард p.paths?.length отсекал все over —
            // подсветка жила только до первого движения.
            const now = performance.now();
            if (now - lastHitAt >= HIT_INTERVAL_MS) {
              lastHitAt = now;
              applyHit(p.position.x / window.devicePixelRatio, p.position.y / window.devicePixelRatio);
            }
          } else if (p.type === "leave") {
            reset();
          } else if (p.type === "drop") {
            const now = Date.now();
            if (now - lastDropAt < 300) return;
            lastDropAt = now;

            const { chatId, inArea } = hitTest(
              p.position.x / window.devicePixelRatio,
              p.position.y / window.devicePixelRatio,
            );
            reset();
            if (!p.paths?.length) return;
            const targetChatId = chatId ?? (inArea ? optsRef.current.selectedChatId : null);
            if (!targetChatId) return;
            void (async () => {
              const files: File[] = [];
              for (const abs of p.paths as string[]) {
                try {
                  const bytes = await readFile(abs);
                  const name = abs.split(/[\\/]/).pop() || "file";
                  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
                  files.push(new File([bytes], name, { type: MIME_BY_EXT[ext] ?? "" }));
                } catch (e) {
                  console.error("[DnD] read failed:", abs, e);
                  toast.error(`Не удалось прочитать: ${abs.split("/").pop()}`);
                }
              }
              if (files.length) optsRef.current.onSendFiles(files, targetChatId);
            })();
          }
        });
        if (disposed) { un(); return; }

        const w = window as any;
        try { w.__echoDndUnlisten?.(); } catch {}
        w.__echoDndUnlisten = un;
        unlisten = un;
      } catch (e) {
        console.warn("[DnD] webview events unavailable:", e);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      const w = window as any;
      if (w.__echoDndUnlisten === unlisten) w.__echoDndUnlisten = null;
      lastChatElRef.current?.classList.remove("drag-target");
    };
  }, [enabled, applyHit, markChat]);

  return state;
}