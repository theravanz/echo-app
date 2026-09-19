"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cacheGetBounded, cacheSetBounded } from "./chat-cache";
import { deleteOutboxBlob, readOutboxBlob } from "@/lib/outbox-media";
import { parseVoiceMeta, uploadVoiceCipher } from "@/lib/voice";
import { isPermanentMediaError, uploadFileCipher } from "@/lib/files";
import type { PendingMessage } from "./types";

/**
 * Офлайн-очередь отправки (модель Telegram): сообщение показывается мгновенно
 * с часиками, отправка в БД/Storage — фон. Здесь живёт ЕДИНАЯ очередь для
 * текста/voice/file.
 *
 * Инварианты:
 *  - Персистентность: очередь целиком лежит в SQLCipher через chat-cache
 *    (`echo_queue_${userId}`), НЕ в localStorage (plaintext запрещён вне SQL).
 *  - Медиа НЕ лежит в очереди: только путь в AppCache `outbox/<tempId>.enc`
 *    (см. lib/outbox-media.ts) — очередь перезаписывается на каждое изменение.
 *  - Досылка строго ПОСЛЕДОВАТЕЛЬНО (в порядке created_at), один запрос за раз.
 *  - Ничего не удаляем по ошибке: только явные 4xx/validation — дроп с тостом.
 *  - Все ошибки логируются с префиксом [QUEUE] и не глотаются молча.
 */

interface UseNetworkQueueReturn {
  pendingQueue: PendingMessage[];
  /** Гидратация из SQLCipher завершена (можно досылать). */
  ready: boolean;
  addToQueue: (msg: PendingMessage) => void;
  removeFromQueue: (tempId: string) => Promise<void>;
  processPendingQueue: () => Promise<QueueProcessResult[]>;
  updateLocalMessageStatus: (tempId: string, updates: Partial<PendingMessage>) => void;
  getQueueLength: () => number;
  isQueued: (tempId: string) => boolean;
  isProcessing: boolean;
}

export interface QueueProcessResult {
  tempId: string;
  ok: boolean;
  /** id строки в БД после успешной досылки. */
  realId?: string;
  /** Сервер отклонил сообщение (4xx/validation) — удалено из очереди. */
  dropped?: boolean;
  reason?: string;
}

interface PersistedQueue {
  v: number;
  items: PendingMessage[];
}

const QUEUE_VERSION = 1;

/** Ключ очереди в SQLCipher (chat-cache → secure_store). */
export function queueCacheKey(userId: string): string {
  return `echo_queue_${userId}`;
}

// Генерация временного ID для локальных сообщений (pending → real swap).
const generateTempId = () => `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

/** Признак локального (не подтверждённого сервером) сообщения. */
export function isTempId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith("local_");
}

const ts = (m: { created_at?: string }): number => {
  const v = Date.parse(m?.created_at ?? "");
  return Number.isFinite(v) ? v : 0;
};

const byCreatedAt = (a: PendingMessage, b: PendingMessage) => ts(a) - ts(b);

/** Ошибка, ретраить которую бессмысленно (payload битый/потерян). */
class PermanentSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentSendError";
  }
}

/** Юзер отменил отправку, пока сообщение уже ушло в работу. */
class CancelledSendError extends Error {
  constructor() {
    super("cancelled by user");
    this.name = "CancelledSendError";
  }
}

function parsePersistedQueue(raw: string | null): PendingMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PersistedQueue | null;
    const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter((it) => it && typeof it.id === "string" && typeof it.sender_id === "string");
  } catch (e) {
    console.error("[QUEUE] failed to parse persisted queue, starting empty:", e);
    return [];
  }
}

/**
 * Классификация ошибки: permanent = сервер/данные отклонили без шанса на ретрай.
 * Сетевые, 5xx, 408/429 и офлайн — НЕ permanent (остаются в очереди).
 */
function isPermanentQueueError(err: unknown): boolean {
  if (err instanceof PermanentSendError) return true;
  const e = err as any;
  if (e?.cancelled) return true;
  if (e?.offline || e?.paused) return false;
  if (isPermanentMediaError(e)) return true;
  // Postgres/PostgREST: class 22 (data), 23 (integrity), 42 (access) → ретрай не поможет.
  const code = typeof e?.code === "string" ? e.code : "";
  if (/^(22|23|42)/.test(code)) return true;
  const status =
    typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : undefined;
  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return true;
  return false;
}

function describeError(err: unknown): string {
  const e = err as any;
  const parts = [e?.code, e?.message, e?.details, e?.hint, e?.status ? `status=${e.status}` : ""].filter(
    (p) => typeof p === "string" && p.length > 0,
  );
  return parts.length > 0 ? parts.join(" | ") : String(err);
}

function isOfflineNow(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Идемпотентность: если строка с таким же content уже есть в БД — значит
 * приложение умерло между INSERT и удалением из очереди. Возвращаем её id,
 * чтобы не создать дубль (content уникален: шифротекст/путь меты).
 */
async function findExistingRowId(msg: PendingMessage): Promise<string | null> {
  if (!msg.content) return null;
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("sender_id", msg.sender_id)
    .eq("receiver_id", msg.receiver_id)
    .eq("content", msg.content)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

/** Отправить одно сообщение: медиа → Storage, затем строка в messages. */
async function sendQueuedMessage(msg: PendingMessage, isCancelled: () => boolean): Promise<string> {
  if (isCancelled()) throw new CancelledSendError();
  // 1) Медиа: шифротекст из outbox-файла → Storage (фоновая часть отправки).
  if (msg.type === "voice" || msg.type === "file") {
    const media = msg.media;
    if (!media?.outboxPath || !media.remotePath) {
      throw new PermanentSendError(`медиа-пейлоад отсутствует в очереди (${msg.type})`);
    }
    const cipher = await readOutboxBlob(media.outboxPath);
    if (!cipher) {
      throw new PermanentSendError(`шифротекст outbox не найден: ${media.outboxPath}`);
    }
    if (msg.type === "voice") await uploadVoiceCipher(cipher, media.remotePath);
    else await uploadFileCipher(cipher, media.remotePath);
  }

  // 2) Дедупликация после краша (до INSERT — экономим и Storage, и БД).
  const existingId = await findExistingRowId(msg);
  if (existingId) {
    console.log(`[QUEUE] уже в БД, дубль не создаём: ${msg.id} → ${existingId}`);
    return existingId;
  }

  // Юзер мог нажать «Отменить отправку», пока шёл upload/дедуп.
  if (isCancelled()) throw new CancelledSendError();

  // 3) Строка сообщения: ровно то, что было в оптимистичном сообщении
  //    (для текста content — E2EE-шифротекст, для медиа — plaintext-мета).
  const row: Record<string, any> = {
    sender_id: msg.sender_id,
    receiver_id: msg.receiver_id,
    content: msg.content,
    type: msg.type || "text",
    status: "sent",
    reply_to_id: msg.reply_to_id || null,
  };
  if (msg.nonce) row.nonce = msg.nonce;

  const { data, error } = await supabase.from("messages").insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/** Push получателю — фоном, как в онлайн-флоу (контент E2EE в push не идёт). */
function notifyReceiver(msg: PendingMessage): void {
  try {
    void supabase.functions
      .invoke("send-message-push", {
        body: { receiver_id: msg.receiver_id, sender_id: msg.sender_id },
      })
      .then((res) => console.log("[QUEUE] send-message-push result:", res?.data ?? res))
      .catch((e) => console.error("[QUEUE] send-message-push failed:", e?.context ?? e?.message ?? e));
  } catch (e) {
    console.error("[QUEUE] failed to invoke send-message-push:", e);
  }
}

/** Снести outbox-файл сообщения (после успешной досылки или дропа). */
async function cleanupOutbox(msg: PendingMessage): Promise<void> {
  const outboxPath = msg.media?.outboxPath;
  if (!outboxPath) return;
  try {
    await deleteOutboxBlob(outboxPath);
  } catch (e) {
    console.error("[QUEUE] outbox cleanup failed:", e);
  }
}

export function useNetworkQueue(userId?: string | null): UseNetworkQueueReturn {
  const [pendingQueue, setPendingQueue] = useState<PendingMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const pendingQueueRef = useRef<PendingMessage[]>([]);
  const userIdRef = useRef<string | null>(userId ?? null);
  userIdRef.current = userId ?? null;
  /** Под какой аккаунт гидратирована текущая очередь (защита от утечки между аккаунтами). */
  const hydratedUserIdRef = useRef<string | null>(null);

  const processingRef = useRef(false);
  const inFlightRef = useRef<Set<string>>(new Set());
  /** id, успешно отправленные в этой сессии — чтобы гидратация не вернула их назад. */
  const settledIdsRef = useRef<Set<string>>(new Set());
  /** id, отменённые юзером — in-flight отправка обязана прерваться до INSERT. */
  const cancelledIdsRef = useRef<Set<string>>(new Set());

  const persist = useCallback((items: PendingMessage[], uidOverride?: string) => {
    const uid = uidOverride ?? userIdRef.current;
    if (!uid) {
      console.warn("[QUEUE] нет userId — очередь не персистится");
      return;
    }
    const payload: PersistedQueue = { v: QUEUE_VERSION, items };
    void cacheSetBounded(queueCacheKey(uid), JSON.stringify(payload)).catch((e) =>
      console.error("[QUEUE] persist failed:", e),
    );
  }, []);

  /** Единая точка изменения очереди: ref (синхронно) → state → SQLCipher. */
  const applyQueue = useCallback(
    (items: PendingMessage[]) => {
      const sorted = [...items].sort(byCreatedAt);
      pendingQueueRef.current = sorted;
      setPendingQueue(sorted);
      persist(sorted);
    },
    [persist],
  );

  // Гидратация из SQLCipher. Локальные (добавленные, пока шло чтение) не
  // теряем: они перетирают одноимённые элементы из хранилища.
  useEffect(() => {
    if (!userId) {
      // Разлогин: чужую очередь в новой сессии не показываем и не персистим
      // под другим аккаунтом (при повторном входе она придёт из SQLCipher).
      if (hydratedUserIdRef.current !== null) {
        console.log("[QUEUE] logout → очередь очищена из памяти");
        pendingQueueRef.current = [];
        setPendingQueue([]);
        settledIdsRef.current.clear();
        cancelledIdsRef.current.clear();
        hydratedUserIdRef.current = null;
      }
      setReady(false);
      return;
    }
    let cancelled = false;
    // Смена аккаунта: очередь другого юзера не переносим.
    if (hydratedUserIdRef.current !== null && hydratedUserIdRef.current !== userId) {
      console.log(`[QUEUE] смена аккаунта ${hydratedUserIdRef.current} → ${userId}: очередь сброшена`);
      pendingQueueRef.current = [];
      setPendingQueue([]);
      settledIdsRef.current.clear();
      cancelledIdsRef.current.clear();
    }
    setReady(false);

    (async () => {
      let stored: PendingMessage[] = [];
      try {
        const raw = await cacheGetBounded(queueCacheKey(userId));
        stored = parsePersistedQueue(raw);
      } catch (e) {
        console.error("[QUEUE] hydrate failed:", e);
      }
      if (cancelled) return;

      const merged = new Map<string, PendingMessage>();
      for (const it of stored) {
        if (settledIdsRef.current.has(it.id)) continue;
        merged.set(it.id, it);
      }
      for (const it of pendingQueueRef.current) {
        if (settledIdsRef.current.has(it.id)) continue;
        merged.set(it.id, it);
      }
      const items = [...merged.values()].sort(byCreatedAt);
      pendingQueueRef.current = items;
      setPendingQueue(items);
      hydratedUserIdRef.current = userId;
      // Мердж пишем обратно: если локальное сообщение успело персистнуться
      // РАНЬШЕ чтения (гонка старта), в SQLCipher остался бы только он —
      // вернём в хранилище и старые элементы очереди.
      persist(items, userId);
      setReady(true);
      console.log(`[QUEUE] hydrated: ${items.length} (из SQLCipher: ${stored.length})`);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, persist]);

  /** Добавить в очередь. Идемпотентно по temp-id: повторный add не создаёт дубль. */
  const addToQueue = useCallback(
    (msg: PendingMessage) => {
      if (!msg?.id) {
        console.error("[QUEUE] addToQueue: сообщение без id, пропуск");
        return;
      }
      const existing = pendingQueueRef.current.find((m) => m.id === msg.id);
      if (existing) {
        console.warn(`[QUEUE] дедупликация: ${msg.id} уже в очереди — обновляю мету`);
        applyQueue(pendingQueueRef.current.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
        return;
      }
      applyQueue([...pendingQueueRef.current, msg]);
    },
    [applyQueue],
  );

  const updateLocalMessageStatus = useCallback(
    (tempId: string, updates: Partial<PendingMessage>) => {
      if (!pendingQueueRef.current.some((m) => m.id === tempId)) return;
      applyQueue(pendingQueueRef.current.map((m) => (m.id === tempId ? { ...m, ...updates } : m)));
    },
    [applyQueue],
  );

  /** Отмена отправки (юзер) или дроп: убрать из очереди и снести outbox-файл. */
  const removeFromQueue = useCallback(
    async (tempId: string) => {
      const item = pendingQueueRef.current.find((m) => m.id === tempId);
      if (!item) {
        console.warn(`[QUEUE] removeFromQueue: ${tempId} нет в очереди`);
        return;
      }
      settledIdsRef.current.add(tempId);
      cancelledIdsRef.current.add(tempId);
      applyQueue(pendingQueueRef.current.filter((m) => m.id !== tempId));
      const outboxPath = item.media?.outboxPath;
      if (outboxPath) {
        try {
          await deleteOutboxBlob(outboxPath);
        } catch (e) {
          console.error("[QUEUE] outbox cleanup failed:", e);
        }
      }
    },
    [applyQueue],
  );

  /**
   * Один проход по очереди: СТРОГО последовательно, в порядке created_at.
   * Успех → удаляем из очереди (+ outbox) и возвращаем real-id для swap.
   * Ретраибельная ошибка → оставляем, ждём следующий reconnect.
   * Permanent (4xx/validation) → дроп с тостом.
   */
  const processPendingQueue = useCallback(async (): Promise<QueueProcessResult[]> => {
    if (processingRef.current) {
      console.log("[QUEUE] уже идёт досылка — повторный вызов пропущен");
      return [];
    }
    if (!userIdRef.current) return [];
    if (isOfflineNow()) {
      console.log("[QUEUE] офлайн — досылка отложена");
      return [];
    }

    const snapshot = [...pendingQueueRef.current].sort(byCreatedAt);
    if (snapshot.length === 0) return [];

    processingRef.current = true;
    setIsProcessing(true);
    console.log(`[QUEUE] досылка ${snapshot.length} сообщений...`);
    const results: QueueProcessResult[] = [];

    try {
      for (const item of snapshot) {
        // Юзер мог отменить сообщение, пока шла очередь.
        if (!pendingQueueRef.current.some((m) => m.id === item.id)) {
          console.log(`[QUEUE] ${item.id} отменено до отправки — пропуск`);
          continue;
        }
        if (inFlightRef.current.has(item.id)) continue;
        inFlightRef.current.add(item.id);

        try {
          const realId = await sendQueuedMessage(item, () => cancelledIdsRef.current.has(item.id));
          settledIdsRef.current.add(item.id);
          applyQueue(pendingQueueRef.current.filter((m) => m.id !== item.id));
          await cleanupOutbox(item);
          notifyReceiver(item);
          results.push({ tempId: item.id, ok: true, realId });
          console.log(`[QUEUE] отправлено ${item.id} → ${realId}`);
        } catch (err) {
          const reason = describeError(err);
          if (err instanceof CancelledSendError) {
            // Юзер отменил во время отправки: строка в БД не создана,
            // тост не нужен (отмена уже отражена в UI).
            console.log(`[QUEUE] ${item.id} отменено во время отправки — до БД не дошло`);
            results.push({ tempId: item.id, ok: false, dropped: true, reason });
          } else if (isPermanentQueueError(err)) {
            console.error(`[QUEUE] сервер отклонил ${item.id} — дроп:`, reason);
            settledIdsRef.current.add(item.id);
            applyQueue(pendingQueueRef.current.filter((m) => m.id !== item.id));
            await cleanupOutbox(item);
            toast.error("Сообщение отклонено сервером и удалено из очереди");
            results.push({ tempId: item.id, ok: false, dropped: true, reason });
          } else {
            console.warn(`[QUEUE] ${item.id} остаётся в очереди (повтор при reconnect):`, reason);
            results.push({ tempId: item.id, ok: false, reason });
          }
        } finally {
          inFlightRef.current.delete(item.id);
        }
      }
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }

    const ok = results.filter((r) => r.ok).length;
    const dropped = results.filter((r) => r.dropped).length;
    console.log(
      `[QUEUE] проход завершён: ok=${ok}, dropped=${dropped}, ` +
        `retry=${results.length - ok - dropped}, осталось=${pendingQueueRef.current.length}`,
    );
    return results;
  }, [applyQueue]);

  const getQueueLength = useCallback(() => pendingQueueRef.current.length, []);
  const isQueued = useCallback((tempId: string) => pendingQueueRef.current.some((m) => m.id === tempId), []);

  return {
    pendingQueue,
    ready,
    addToQueue,
    removeFromQueue,
    processPendingQueue,
    updateLocalMessageStatus,
    getQueueLength,
    isQueued,
    isProcessing,
  };
}

export { generateTempId };
