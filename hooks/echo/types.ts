"use client";

// === Domain Types ===

export interface UserProfile {
  id: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  avatar_color?: string;
  avatar_storage_path?: string | null;
  avatar_nonce?: string | null;
  avatar_mime?: string | null;
  bio?: string;
  public_key?: string;
  email?: string;
  phone?: string;
  user_metadata?: Record<string, any>;
  created_at?: string;
}

export interface Chat {
  id: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  avatar_color?: string;
  avatar_storage_path?: string | null;
  avatar_nonce?: string | null;
  avatar_mime?: string | null;
  bio?: string;
  public_key?: string;
  lastMessage?: string | null;
  lastMessageType?: 'text' | 'sticker' | 'gif' | 'voice' | 'call_log' | 'file' | null;
  lastMessageTime?: string | null;
  last_seen?: string | null;
  unreadCount?: number;
  /** Фон чата */
  wallpaper_preset?: 'solid' | 'doodle' | 'photo';
  wallpaper_photo_url?: string | null;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  nonce?: string;
  type?: 'text' | 'sticker' | 'gif' | 'voice' | 'call_log' | 'file';
  voice?: {
    path: string;
    nonce: string;
    mime: string;
    duration: number;
  } | null;
  status?: "sending" | "pending" | "sent" | "read";
  created_at: string;
  reply_to_id?: string | null;
  reply_to?: {
    id: string;
    sender_id: string;
    type?: "text" | "sticker" | "gif" | "voice" | "file" | "call_log";
    content: string;
    call_status?: "incoming" | "outgoing" | "missed";
    call_duration?: number;
  } | null;
  is_edited?: boolean;
  read_at?: string;
  _pendingContent?: string;
  _pending?: boolean;
}

/**
 * Медиа-пейлоад офлайн-очереди (voice/file).
 *
 * ВЫБОР (см. lib/outbox-media.ts): шифротекст живёт ФАЙЛОМ в Tauri AppCache
 * (`outbox/<tempId>.enc`), а очередь хранит только путь + plaintext-мету.
 * Почему не base64 в очередь: очередь персистится в SQLCipher и
 * перезаписывается целиком на каждое изменение — 10 МБ base64 = +33% размера,
 * полная сериализация blob'а на каждый чих и те же байты в JS-памяти (и в
 * стейте React, если положить их в Message).
 */
export interface PendingMedia {
  kind: 'voice' | 'file';
  /** Относительный путь шифротекста в AppCache — очередь хранит только путь. */
  outboxPath: string;
  /** Планируемый путь в Storage (детерминирован локально, без сети). */
  remotePath: string;
  nonce: string;
  mime: string;
  name?: string;
  size?: number;
  duration?: number;
}

/**
 * Сообщение в офлайн-очереди. Персистится через chat-cache (SQLCipher,
 * ключ `echo_queue_${userId}`), НЕ через localStorage.
 *
 * Инвариант контента:
 *  - `content` — то, что уйдёт в БД: для текста это E2EE-шифротекст,
 *    для voice/file — plaintext JSON-мета (шифруется только медиа).
 *  - `_pendingContent` — plaintext текста ТОЛЬКО для рендера пузыря
 *    (лежит в SQLCipher, как и остальные расшифрованные кэши).
 */
export interface PendingMessage extends Message {
  _pendingContent: string;
  _pending: true;
  status: 'pending' | 'sending';
  media?: PendingMedia;
}

export type NetworkMode = 'direct' | 'relay' | 'normal';
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
export type AppTab = 'chats' | 'feed' | 'community';