import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const safeChar = (val: any, fallback: string = "U") => {
  if (typeof val === 'string' && val.length > 0) return val.charAt(0);
  if (Array.isArray(val) && val.length > 0) return val[0];
  return fallback;
};

export const formatRelativeTime = (date: string | Date) => {
  const now = new Date();
  const then = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (diffInSeconds < 60) return 'just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d`;
  return then.toLocaleDateString();
};
/** Человекочитаемое превью сообщения (reply, список чатов, уведомления).
 *  voice/file/call_log несут plaintext-мету в content — не текст. */
export const messagePreview = (msg: any): string => {
  if (!msg) return "";
  if (msg.type === "voice") return "🎙 Голосовое сообщение";
  if (msg.type === "file") {
    let meta = msg.file;
    if (!meta && typeof msg.content === "string") {
      try { meta = JSON.parse(msg.content); } catch { /* ignore */ }
    }
    return meta?.name ? `📎 ${meta.name}` : "📎 Файл";
  }
  if (msg.type === "call_log") {
    const s = msg.call_status;
    return s === "missed" ? "📞 Пропущенный звонок"
      : s === "incoming" ? "📞 Входящий звонок" : "📞 Исходящий звонок";
  }
  if (msg.type === "sticker") return "Стикер";
  if (msg.type === "gif") return "GIF";
  if (msg.type === "image") return "🖼 Фото";
  return typeof msg.content === "string" ? msg.content : "";
};