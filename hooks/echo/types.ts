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
  lastMessageType?: 'text' | 'sticker' | 'gif' | null;
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
  type?: 'text' | 'sticker' | 'gif' | 'voice' | 'call_log';
  voice?: {
    path: string;
    nonce: string;
    mime: string;
    duration: number;
  } | null;
  status?: 'pending' | 'sent' | 'read';
  created_at: string;
  reply_to_id?: string | null;
  reply_to?: {
    sender_id: string;
    content: string;
  } | null;
  is_edited?: boolean;
  read_at?: string;
  _pendingContent?: string;
  _pending?: boolean;
}

export interface PendingMessage extends Message {
  _pendingContent: string;
  _pending: true;
  status: 'pending';
}

export type NetworkMode = 'direct' | 'relay' | 'normal';
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
export type AppTab = 'chats' | 'feed' | 'community';
