"use client";

/**
 * Метаданные лога звонка, сериализуемые в JSON-поле `content` сообщения
 * с типом `call_log`. Сообщения-логи НЕ шифруются E2EE — поле `content`
 * хранит обычный незашифрованный JSON (это системные данные, а не приватная
 * переписка), поэтому дешифратор должен байпаситься при их обработке.
 */

export interface CallLogMeta {
  status: "outgoing" | "incoming" | "missed";
  duration: number;
  withVideo?: boolean;
}

/**
 * Парсит незашифрованный JSON лога звонка из `content`. Безопасно падает
 * в "missed" при любом повреждении (bad JSON), чтобы UI не сломался.
 */
export function parseCallLogJson(content: string): CallLogMeta {
  try {
    const raw = JSON.parse(content || "{}") as Partial<CallLogMeta>;
    const status =
      raw.status === "incoming" || raw.status === "outgoing"
        ? raw.status
        : "missed";
    return {
      status,
      duration: Math.max(0, Number(raw.duration) || 0),
      withVideo: !!raw.withVideo,
    };
  } catch {
    return { status: "missed", duration: 0, withVideo: false };
  }
}

/** Сериализует метаданные лога звонка в JSON-строку для поля `content`. */
export function serializeCallLog(meta: Partial<CallLogMeta>): string {
  return JSON.stringify({
    status: (meta.status as CallLogMeta["status"]) ?? "missed",
    duration: Math.max(0, Number(meta.duration) || 0),
    withVideo: !!meta.withVideo,
  });
}
