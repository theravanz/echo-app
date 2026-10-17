"use client";

import { useState, useEffect, useRef, memo, useCallback, Suspense } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import {
  TbSearch as Search,
  TbPlus as Plus,
  TbSettings as Settings,
  TbDotsVertical as MoreVertical,
  TbSend as Send,
  TbPaperclip as Paperclip,
  TbShield as Shield,
  TbShare as Share2,
  TbCpu as Cpu,
  TbSignal4G as Signal,
  TbUser as User,
  TbCheck as Check,
  TbChecks as CheckCheck,
  TbArrowLeft as ArrowLeft,
  TbLock as Lock,
  TbTrash as Trash2,
  TbArrowBackUp as Reply,
  TbEdit as Edit,
  TbCopy as Copy,
  TbExternalLink as ExternalLink,
  TbGlobe as Globe,
  TbWifi as Wifi,
  TbTrophy as Trophy,
  TbChevronDown as ChevronDown,
  TbChevronUp as ChevronUp,
  TbChevronLeft as ChevronLeft,
  TbChevronRight as ChevronRight,
  TbPencil as Pen,
  TbEyeOff as EyeOff,
  TbBold as Bold,
  TbItalic as Italic,
  TbCode as Code,
  TbMoodSmile as Smile,
  TbDeviceMobile as Smartphone,
  TbMoon as Moon,
  TbShoppingBag as ShoppingBag,
  TbRss as Rss,
  TbHome as Home,
  TbUserPlus as UserPlus,
  TbStar as Star,
  TbLogout as LogOut,
  TbBolt as Zap,
  TbLayersIntersect as Layers,
  TbDatabase as Database,
  TbX as X,
  TbHeart as Heart,
  TbMessage as MessageSquare,
  TbRepeat as Repeat2,
  TbInfoCircle as Info,
  TbCompass as Compass,
  TbHash as Hash,
  TbBell as Bell,
  TbVolume2 as Volume2,
  TbShieldCheck as ShieldCheck,
  TbDeviceDesktop as HardDrive,
  TbPalette as Palette,
  TbKey as Key,
  TbSpeakerphone as Megaphone,
  TbUsers as Users,
  TbFingerprint as Fingerprint,
  TbSparkles as Sparkles,
  TbRefresh as RefreshCw,
  TbAlertTriangle as AlertTriangle,
  TbPhoto as ImageIcon,
  TbGift as Gift,
  TbFilter as Filter,
  TbClock as Clock, TbGhost as Ghost,
  TbBoltOff as ZapOff,
  TbLink as LinkIcon
} from "react-icons/tb";
import { cn, safeChar } from "@/lib/utils";
import { SecureAvatar } from "@/components/echo/app/secure-avatar";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase, ensureSupabaseSessionFresh } from "@/lib/supabase";
import { useTranslation } from "@/hooks/use-translation";
import { useNotifications } from "@/hooks/echo/use-notifications";
import { useNotificationSettings } from "@/hooks/echo/use-notification-settings";
import { useFcm } from "@/hooks/echo/use-fcm";
import { getFcmToken } from "@/lib/fcm";
import { useChatList } from "@/hooks/echo/use-chat-list";
import { useMessages } from "@/hooks/echo/use-messages";
import { useNetworkQueue } from "@/hooks/echo/use-network-queue";
import { useRealtime } from "@/hooks/echo/use-realtime";
import { useConnection } from "@/hooks/echo/use-connection";
import { useProfiles } from "@/hooks/echo/use-profiles";
import { saveDevice, generateHWID, getDevices, deleteDevice } from "@/lib/db";
import { detectDevice } from "@/lib/device-info";
import dynamic from "next/dynamic";
import type { UserProfile, Chat, Message, NetworkMode, AppTab, ConnectionStatus, PendingMessage } from "@/hooks/echo/types";
import { ChatSidebar } from "@/components/echo/app/chat-sidebar";
import { GroupCreateModal } from "@/components/echo/app/group-create-modal";
import { MobileTabBar } from "@/components/echo/app/mobile-tab-bar";
import { CallOverlay, type OutgoingCallRequest, type CallLogData, deriveRoomId } from "@/components/echo/app/CallOverlay";
import { serializeCallLog } from "@/hooks/echo/call-log";
import { ChatArea } from "@/components/echo/app/chat-area";
import { AppNavRail } from "@/components/echo/app/app-nav-rail";

import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { registerNavLayer, canGoBack, closeTopLayer, isVoiceRecordingActive } from "@/lib/back-nav";
import { useEdgeBackGesture } from "@/hooks/echo/use-edge-back";
const SettingsModal = dynamic(
  () => import("@/components/echo/app/settings-modal"),
  { ssr: false }
);


// --- Types & Constants ---

const QUARANTINE_HOURS = 32;

// --- Main Application Content ---

function EchoAppContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const { language } = useTranslation();

  // App State
  const [activeTab, setActiveTab] = useState<AppTab>('chats');
  const [activeMode, setActiveMode] = useState<NetworkMode>('direct');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // New Group UI (первый шаг — меню создания, логики групп пока нет).
  const [isGroupCreateOpen, setIsGroupCreateOpen] = useState(false);
  const [outgoingCall, setOutgoingCall] = useState<OutgoingCallRequest | null>(null);
  const [isQuarantined, setIsQuarantined] = useState(false);
  const [quarantineTime, setQuarantineTime] = useState("");
  const [currentHwid, setCurrentHwid] = useState("");
  const userRef = useRef<UserProfile | null>(null);
  const originalChatRef = useRef<Chat | null>(null);

  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false); 

  // Network queue + connection status идут ДО useChatList: список чатов
  // опирается на статус связи (офлайн → рендер из кэша без сетевых таймаутов).
  const { pendingQueue, ready: queueReady, addToQueue, removeFromQueue, processPendingQueue } = useNetworkQueue(user?.id ?? null);
  const reconnectRef = useRef<() => void>(() => {});
  const { connectionStatus, setConnectionStatus } = useConnection(() => reconnectRef.current());

  const { chats, setChats, chatsFetchError, fetchChats, selectedChat, setSelectedChat, selectedChatRef, drafts, saveDraft, onlineUsers } = useChatList(user, connectionStatus);

  // Проход по очереди, который применяет swap temp-id → real-id к стейту
  // сообщений, объявляется ПОСЛЕ useMessages — здесь только стабильная ссылка,
  // чтобы reconnect-колбэк всегда дёргал актуальную версию.
  const flushQueueRef = useRef<() => Promise<void>>(async () => {});

  // Возврат сети: досылаем offline-очередь и синхронизируем список с сервером
  // (кэш при этом уже отрендерен — список не «ждёт» сеть).
  useEffect(() => {
    reconnectRef.current = () => {
      void flushQueueRef.current();
      if (userRef.current?.id) fetchChats(userRef.current.id);
    };
  }, [fetchChats]);

  const handleMentionClick = useCallback(async (username: string) => {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", username)
        .maybeSingle();

      if (!profile) return;

      const chat: Chat = {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        avatar_color: profile.avatar_color,
        bio: profile.bio,
        public_key: profile.public_key,
        lastMessage: null,
        lastMessageType: null,
        lastMessageTime: null,
        unreadCount: 0,
        wallpaper_preset: "solid",
        wallpaper_photo_url: null,
      };

      originalChatRef.current = selectedChat;
      setSelectedChat(chat);
      setIsRightPanelOpen(true);
    } catch (err) {
      console.error("Failed to open profile from mention:", err);
    }
  }, [selectedChat, setSelectedChat]);

  const { messages, setMessages, replyingTo, setReplyingTo, editingMessage, setEditingMessage, newMessage, setNewMessage, fetchMessages, handleSendMessage, handleSendVoice } = useMessages(chats, connectionStatus, pendingQueue);
  const { searchOpen, setSearchOpen, searchQuery, searchResults, isSearching, isSearchFocused, setIsSearchFocused, recentSearches, searchRef, searchTimeoutRef, handleSearch, handleStartChat, clearSearch, setCurrentUserId } = useProfiles();

  // ─── ОФЛАЙН-ОЧЕРЕДЬ: досылка + swap temp-id → real-id ───
  // Один проход по очереди (последовательно, по одному сообщению).
  // Результат применяем к стейту: успех → меняем id (часики → галочка),
  // дроп сервером → убираем пузырь (тост уже показал хук).
  const runFlushQueue = useCallback(async () => {
    const results = await processPendingQueue();
    if (results.length === 0) return;
    const sent = results.filter((r) => r.ok && r.realId);
    const dropped = results.filter((r) => !r.ok && r.dropped);
    if (sent.length > 0) {
      setMessages((prev) =>
        prev.map((m) => {
          const hit = sent.find((s) => s.tempId === m.id);
          return hit
            ? { ...m, id: hit.realId as string, status: "sent" as const, _pending: false }
            : m;
        }),
      );
    }
    if (dropped.length > 0) {
      setMessages((prev) => prev.filter((m) => !dropped.some((d) => d.tempId === m.id)));
    }
    console.log(
      `[QUEUE] UI-синхронизация: swap=${sent.length}, drop=${dropped.length}, ` +
        `retry=${results.length - sent.length - dropped.length}`,
    );
  }, [processPendingQueue, setMessages]);

  // Проходы строго по одному: сообщение, добавленное во время досылки,
  // не «зависает» — следующий проход цепочки его подхватит.
  const flushChainRef = useRef<Promise<void>>(Promise.resolve());
  const flushQueue = useCallback((): Promise<void> => {
    const next = flushChainRef.current.then(
      () => runFlushQueue(),
      () => runFlushQueue(),
    );
    flushChainRef.current = next.catch((e) => console.error("[QUEUE] flush chain failed:", e));
    return flushChainRef.current;
  }, [runFlushQueue]);

  useEffect(() => {
    flushQueueRef.current = flushQueue;
  }, [flushQueue]);

  // Персистентная очередь готова (гидратация из SQLCipher) → досылаем.
  // Это же покрывает кейс «убили приложение с pending → рестарт → досылка».
  useEffect(() => {
    if (!queueReady || !user?.id) return;
    void flushQueue();
  }, [queueReady, user?.id, flushQueue]);

  // Оптимистичный путь: в очередь + сразу попытка отправки (быстрый путь).
  const enqueuePending = useCallback(
    (msg: PendingMessage) => {
      addToQueue(msg);
      void flushQueue();
    },
    [addToQueue, flushQueue],
  );

  // «Отменить отправку» из контекст-меню pending-сообщения (только temp-id).
  const cancelPending = useCallback(
    async (msg: Message) => {
      await removeFromQueue(msg.id);
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      toast.success("Отправка отменена");
    },
    [removeFromQueue, setMessages],
  );

// Обёртки, чтобы ответ и редактирование взаимно исключали друг друга
const setReplyingToSafe = (msg: any) => {
  if (msg) {
    setEditingMessage(null); // Сбрасываем редактирование, если начинаем отвечать
  }
  setReplyingTo(msg);
};

const setEditingMessageSafe = (msg: any) => {
  if (msg) {
    setReplyingTo(null); // Сбрасываем ответ, если начинаем редактировать
  }
  setEditingMessage(msg);
};

  useEffect(() => {
    if (user?.id) setCurrentUserId(user.id);
  }, [user?.id, setCurrentUserId]);

  // ─── BACK-NAV: единый back-стек (см. lib/back-nav.ts) ───
  // Внутренние слои ChatArea (contextMenu/bgPicker/mediaPicker) регистрирует
  // сам ChatArea. Здесь — глобальные слои страницы.
  useEffect(() => {
    if (!isSettingsOpen) return;
    return registerNavLayer({
      id: "settings-modal",
      priority: 110,
      isOpen: () => true,
      close: () => setIsSettingsOpen(false),
    });
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isRightPanelOpen) return;
    return registerNavLayer({
      id: "chat-right-panel",
      priority: 80,
      isOpen: () => true,
      close: () => setIsRightPanelOpen(false),
    });
  }, [isRightPanelOpen]);

  useEffect(() => {
    if (!editingMessage) return;
    return registerNavLayer({
      id: "editing-message",
      priority: 70,
      isOpen: () => true,
      close: () => setEditingMessage(null),
    });
  }, [editingMessage, setEditingMessage]);

  useEffect(() => {
    if (!replyingTo) return;
    return registerNavLayer({
      id: "replying-to",
      priority: 70,
      isOpen: () => true,
      close: () => setReplyingTo(null),
    });
  }, [replyingTo, setReplyingTo]);

  useEffect(() => {
    if (!selectedChat) return;
    return registerNavLayer({
      id: "selected-chat",
      priority: 60,
      isOpen: () => true,
      close: () => {
        // Та же onBack-логика, что и у стрелки в ChatHeader — не переписываем.
        setSelectedChat(null);
        if (isMobile) setSearchOpen(false);
      },
    });
  }, [selectedChat, isMobile, setSelectedChat, setSearchOpen]);

  // Esc (десктоп) → closeTopLayer(). Если идёт запись голоса (rec !== "idle"),
  // Esc отменяет запись в ChatInput — навигационный Esc не срабатывает.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      try {
        if (e.key !== "Escape" || e.repeat) return;
        if (isVoiceRecordingActive()) return;
        if (isMobile) return; // навигационный Esc — только десктоп
        if (canGoBack()) {
          e.preventDefault();
          closeTopLayer();
        }
      } catch (err) {
        console.error("[BACK-NAV] Escape handling failed:", err);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isMobile]);

  // Android системный back: MainActivity.onBackPressed эмитит в webview
  // CustomEvent 'echo-native-back'. Есть слои → закрываем верхний.
  // Слоёв нет → настоящий выход (finishAndRemoveTask, НЕ kill процесса).
  useEffect(() => {
    const onNativeBack = () => {
      try {
        if (canGoBack()) {
          closeTopLayer();
          return;
        }
        invoke("exit_app").catch((err: unknown) => {
          console.error("[BACK-NAV] exit_app failed:", err);
        });
      } catch (err) {
        console.error("[BACK-NAV] native back handling failed:", err);
      }
    };
    window.addEventListener("echo-native-back", onNativeBack as EventListener);
    return () => window.removeEventListener("echo-native-back", onNativeBack as EventListener);
  }, []);

  // Edge-swipe от левого края (iOS + Android): работает когда есть хоть один
  // слой для закрытия — чат, настройки (и их под-экраны), reply/edit, панель.
  // Нет слоёв → жеста нет. onCommit — общий closeTopLayer(): закрывает
  // именно ВЕРХНИЙ слой (settings-sub-view → settings → чат → ...).
  const edgeCommit = useCallback(() => {
    try {
      if (closeTopLayer()) return;
      // Fallback на случай, когда реестр пуст (не должен случаться):
      // закрываем чат — та же onBack-логика.
      setSelectedChat(null);
      setSearchOpen(false);
    } catch (err) {
      console.error("[BACK-NAV] edge-swipe commit failed:", err);
    }
  }, [setSelectedChat, setSearchOpen]);
  const edgeBackEnabled =
    isMobile && (!!selectedChat || isSettingsOpen || !!editingMessage || !!replyingTo || isRightPanelOpen);
  const { dragX, sidebarX } = useEdgeBackGesture(
    edgeBackEnabled,
    edgeCommit,
    isMobile && !!selectedChat, // сайдбар за экраном, когда открыт чат
  );


  // === Phase 0: восстановление E2EE-ключа при старте ===
  // Rust KeyStore пуст после перезапуска. Ключ персистится device-bound
  // (Argon2id(HWID+salt)+AES-GCM) и восстанавливается из локальной БД.
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const pub = await invoke<{ public_key: string }>("crypto_restore_key", {
          userId: user.id,
        });
        if (!cancelled && pub?.public_key) {
          console.log("[E2EE] Restored device-bound key on startup");
        }
      } catch (err: any) {
        const msg = String(err?.message || err);
        if (!cancelled && msg.includes("HWID_CHANGED")) {
          // Сменилось железо → нужна мнемоника (можно логировать / редирект на auth-restore).
          console.warn("[E2EE] HWID changed, recovery via mnemonic required");
        } else if (!cancelled) {
          console.info("[E2EE] No stored key yet (first run) —", msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  const { settings: notificationSettings } = useNotificationSettings(user);

  // === Reusable function to open chat by username ===
  const openChatByUsername = useCallback(async (rawUsername: string) => {
    if (!user) return;
    const username = rawUsername.replace(/^@/, '');

    // Reset UI state to ensure the chat becomes visible
    setIsSettingsOpen(false);
    setActiveTab('chats');

    // 1. Try to find in current chat list
    let existing = chats.find(
      (c) => (c.username || '').toLowerCase() === username.toLowerCase(),
    );

    // 2. If not found, fetch from Supabase
    if (!existing) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('username', username)
          .maybeSingle();

        if (profile) {
          existing = {
            id: profile.id,
            username: profile.username,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url || undefined,
            avatar_color: profile.avatar_color || undefined,
            last_seen: profile.last_seen || null,
            bio: profile.bio || undefined,
            public_key: profile.public_key || undefined,
            unreadCount: 0,
          } as Chat;
          setChats((prev) => prev.some((c) => c.id === existing!.id) ? prev : [existing!, ...prev]);
        } else {
          const { data: channel } = await supabase
            .from('channels')
            .select('*')
            .eq('username', username)
            .maybeSingle();
          if (channel) {
            existing = {
              id: channel.id,
              username: channel.username,
              display_name: channel.name,
              avatar_url: channel.avatar_url || undefined,
              unreadCount: 0,
            } as Chat;
            setChats((prev) => prev.some((c) => c.id === existing!.id) ? prev : [existing!, ...prev]);
          }
        }
      } catch (err) {
        console.error('[Deep-link] Error resolving user:', err);
      }
    }

    if (existing) {
      setSelectedChat(existing);
      fetchMessages(existing.id, user.id);
    }
  }, [user, chats, setChats, setSelectedChat, fetchMessages]);

  const { notifyNewMessage } = useNotifications({ user, chats, settings: notificationSettings, onNotificationClick: (chatId) => setSelectedChat(chats.find(c => c.id === chatId) || null) });

  // === FCM: регистрация push-токена устройства ===
  // Получаем токен (нативный Android-мост или JS SDK фолбэк) и
  // сохраняем в Rust-бэкенд + Supabase (device_tokens), чтобы пуши
  // сообщений/звонков могли доставляться, когда приложение в фоне.
  const { registerFcmToken } = useFcm(user?.id ?? null);

  useEffect(() => {
    let cancelled = false;
    const syncToken = async () => {
      if (!user?.id) return;
      const token = await getFcmToken();
      if (cancelled) return;
      if (!token) {
        console.warn("[FCM] No push token available on this platform");
        return;
      }
      try {
        await registerFcmToken(token);
      } catch (err) {
        console.error("[FCM] Token registration failed:", err);
      }
    };
    syncToken();
    return () => {
      cancelled = true;
    };
  }, [user?.id, registerFcmToken]);



  // === Call initiation ===
  const startOutgoingCall = useCallback(
    (withVideo: boolean) => {
      if (!user?.id || !selectedChat) return;
      setOutgoingCall({
        peerId: selectedChat.id,
        peerName: selectedChat.display_name || selectedChat.username || "Пользователь",
        peerAvatar: selectedChat.avatar_url || null,
        peerAccent: selectedChat.avatar_color || null,
        withVideo,
      });

      // FCM-пуш "входящий звонок" получателю — фоном, не блокирует звонок.
      // Будит приложение получателя в фоне и показывает экран звонка.
      // Edge-функция сама находит токен получателя в device_tokens (RLS-обход).
      try {
        const roomId = deriveRoomId(user.id, selectedChat.id);
        supabase.functions
          .invoke("send-call-push", {
            body: {
              receiver_id: selectedChat.id,
              room_id: roomId,
              caller_id: user.id,
              caller_name: user.display_name || user.username || "",
              caller_avatar: user.avatar_url || "",
            },
          })
          .then((res) => {
            console.log("[Push] send-call-push result:", res?.data ?? res);
          })
          .catch((e) => {
            // Диагностика: 404 = функция не задеплоена, 500 = секреты FCM,
            // 200+skipped = у получателя не зарегистрирован FCM-токен.
            console.error("[Push] send-call-push failed:", e?.context ?? e?.message ?? e);
          });
      } catch (e) {
        console.warn("[Push] failed to invoke send-call-push:", e);
      }
    },
    [user?.id, selectedChat],
  );

  const handleCallLog = useCallback(
    (log: CallLogData) => {
      if (!user?.id) return;
      // Сериализуем метаданные лога в JSON (НЕ шифруется E2EE).
      const content = serializeCallLog({
        status: log.status,
        duration: log.duration,
        withVideo: log.withVideo,
      });
      const tempId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const logMsg: any = {
        id: tempId,
        sender_id: user.id,
        receiver_id: log.peerId,
        content,
        type: "call_log",
        call_status: log.status,
        call_duration: log.duration,
        created_at: new Date(log.timestamp).toISOString(),
        status: "sent",
      };
      // Оптимистично вставляем в локальный стейт.
      setMessages((prev) =>
        prev.some((m) => m.id === tempId) ? prev : [...prev, logMsg],
      );
      // Реальный INSERT в таблицу messages (call_log НЕ шифруется E2EE).
      supabase
        .from("messages")
        .insert({
          sender_id: user.id,
          receiver_id: log.peerId,
          content,
          type: "call_log",
          status: "sent",
        })
        .then(({ error }) => {
          if (error) console.error("[CallLog] insert failed:", error);
        });
    },
    [user?.id, setMessages],
  );

  // Drafts: load when switching chats
useEffect(() => {
  if (!selectedChat?.id) return;
  const draft = drafts[selectedChat.id] || "";
  setNewMessage(prev => prev === draft ? prev : draft);
}, [selectedChat?.id, drafts, setNewMessage]);

// Drafts: save on typing
useEffect(() => {
  if (!selectedChat?.id) return;
  const currentDraft = drafts[selectedChat.id] || "";
  if (newMessage === currentDraft) return;

  const timeout = setTimeout(() => {
    saveDraft(selectedChat.id, newMessage);
  }, 500);

  return () => clearTimeout(timeout);
}, [newMessage, selectedChat?.id, saveDraft, drafts]);

  // Deep link listener — warm start (echomes://...) when app is already open
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const fn = await listen<string[]>('deep-link://new-url', async (event) => {
          console.log('[DeepLink] Warm start received:', event.payload);

          // В Tauri v2 payload — это уже массив строк, парсить его не нужно
          const urls = Array.isArray(event.payload) ? event.payload : [event.payload];
          const url = urls[0];
          if (!url) return;

          const match = url.match(/echomes:\/\/(?:@)?([^/?#\s]+)/);
          if (match && match[1]) {
            const username = match[1];
            console.log('[DeepLink] Opening chat with:', username);

            // Принудительно выводим окно на передний план
            try {
              const win = getCurrentWindow();
              await win.unminimize();
              await win.show();
              await win.setFocus();
            } catch (e) {
              console.warn('[DeepLink] Failed to focus window:', e);
            }

            // Вызываем функцию открытия чата
            openChatByUsername(username);
          }
        });
        unlisten = fn;
      } catch (err) {
        console.error('[DeepLink] Listener setup failed:', err);
      }
    })();

    return () => { if (unlisten) unlisten(); };
  }, [openChatByUsername]);
// ═══════════════════════════════════════════════════════════════════
// Offline userId — БЕЗ getSession(). При офлайне supabase-js может
// зависнуть в refreshSession (fetch без таймаута) — до кэша тогда не
// дойдём. userId достаём синхронно из локального storage supabase-js
// (ключ `sb-<ref>-auth-token`) и фолбэка echo_accounts.
// ═══════════════════════════════════════════════════════════════════
function getOfflineUserId(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const rec = JSON.parse(localStorage.getItem(k) || '{}');
        if (rec?.user?.id) return rec.user.id as string;
      }
    }
  } catch { /* ignore */ }
  try {
    const accounts = JSON.parse(localStorage.getItem('echo_accounts') || '[]');
    if (Array.isArray(accounts) && accounts[0]?.id) return accounts[0].id as string;
  } catch { /* ignore */ }
  return null;
}



useEffect(() => {
  let isMounted = true;

  const init = async () => {
    try {
      // 1. Мгновенно читаем localStorage до проверки сессии
      let isOffline = false;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setConnectionStatus('disconnected');
        isOffline = true;
      }

      // 2. Загружаем кэш аккаунтов из localStorage (синхронно)
      try {
        const saved = JSON.parse(localStorage.getItem('echo_accounts') || '[]');
        if (isMounted) setAccounts(saved);
      } catch (e) { if (isMounted) setAccounts([]); }

      // 3. Показываем окно Tauri после того, как первый кадр отрисован
      //    и данные из localStorage уже вставлены в стейт
      requestAnimationFrame(async () => {
        try {
          const window = getCurrentWindow();
          await window.show();
        } catch {
          // Не в Tauri-окружении (браузерный dev-режим)
        }
      });

      // 4. Асинхронная инициализация (сессия, профиль, чаты)
      // ОФФЛАЙН (cache-first): userId берём синхронно из локального storage
      // (sb-*-auth-token / echo_accounts) и сразу рендерим список из
      // SQLCipher — сеть не трогаем вообще (статус disconnected + onLine=false),
      // поэтому никаких ожиданий таймаутов.
      if (isOffline) {
        const offlineUserId = getOfflineUserId();
        if (offlineUserId && isMounted) {
          const offlineUser: UserProfile = {
            id: offlineUserId,
            user_metadata: {},
          } as unknown as UserProfile;
          setUser(offlineUser);
          userRef.current = offlineUser;
          await fetchChats(offlineUserId);
        } else {
          console.warn('[App] offline init: no local session available');
        }
        return;
      }

      // Таймаут 5с: если getSession() зависнет на autoRefreshToken,
      // не оставляем пользователя на чёрном экране.
      let session: any = null;
      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('auth timeout')), 5000),
          ),
        ]);
        session = result.data.session;
      } catch (e) {
        console.error('App init: auth check failed/timeout:', e);
        if (isMounted) {
          router.push('/auth');
        }
        return;
      }

      if (!session) {
        router.push('/auth');
        return;
      }

      // Свежесть access-токена: если истёк/истекает — ручной refresh
      // (autoRefreshToken отключён в lib/db.ts, чтобы офлайн retry-цикл
      // gotrue не удалял сессию). Fire-and-forget: init не блокируем.
      ensureSupabaseSessionFresh().catch(e => console.warn('[SupabaseAuth] init refresh rejected:', e));

      // ═══ CACHE-FIRST: сначала БД, потом сеть ═══
      // 1) Юзер — из локальной сессии, мгновенно (без сетевого запроса профиля).
      const sessionUser = session.user as UserProfile;
      if (isMounted) {
        setUser(sessionUser);
        userRef.current = sessionUser;
      }

      // 2) Список чатов — из SQLCipher-кэша сразу же. Внутри fetchChats
      //    сначала рендерится кэш, затем идёт сеть за свежаком (и
      //    обновляет unread/new при возврате). Раньше список ждал
      //    сетевые профиль/geo/регистрацию устройства ниже.
      void fetchChats(session.user.id)
        .catch(err => console.warn('[CHAT-CACHE] fetchChats rejected:', err));

      // 3) Далее сеть — уточняем профиль и, если пришло, обновляем юзера.
      //    abort-таймаут: не даём сети повесить инициализацию.
      let userData: UserProfile = sessionUser;
      const profileAbort = new AbortController();
      const profileTimeout = setTimeout(() => profileAbort.abort(), 8000);
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .abortSignal(profileAbort.signal)
          .maybeSingle();
        userData = { ...session.user, user_metadata: { ...session.user.user_metadata, ...(profile || {}) } } as UserProfile;
        if (isMounted) {
          setUser(userData);
          userRef.current = userData;
        }
      } catch (e) {
        console.warn('[App] profile fetch failed, using local session:', e);
      } finally {
        clearTimeout(profileTimeout);
      }

      if (!isMounted) return;

      // Register this device + check quarantine (сеть/geo — уже после кэша)
      try {
        const hwid = await generateHWID();
        localStorage.setItem('echo_device_hwid', hwid); // sync for old code
        setCurrentHwid(hwid);

        // Определяем устройство и геолокацию (ОС/браузер + IP-локация + таймзона + VPN)
        let meta: any = null;
        let geo: any = null;
        try {
          const detected = await detectDevice(true);
          meta = detected.meta || null;
          geo = detected.geo || null;
        } catch (e) {
          console.warn('[App] detectDevice failed, using fallback:', e);
        }

        const device_name = meta?.os_name || navigator.userAgent || 'Echo Desktop';
        const platform = meta?.platform || navigator.platform || 'unknown';
        const device_type = meta?.device_type || 'desktop';
        const os_name = meta?.os_name || '';
        const browser_name = meta?.browser_name || '';
        const ip_address = geo?.ip || '';
        const location = geo?.locationLabel || '';
        const timezone = geo?.tz || '';
        const is_vpn = !!geo?.isVpn;

        // Register device in native SQLite
        const deviceId = `device_${userData.id}_${Date.now()}`;
        try {
          await saveDevice({
            id: deviceId,
            user_id: userData.id,
            hwid,
            device_name,
            platform,
            device_type,
            os_name,
            browser_name,
            ip_address,
            location,
            timezone,
            is_vpn,
            is_current: true,
          });
          console.log('[App] Device registered:', deviceId, { os_name, browser_name, location, is_vpn });
        } catch (e) {
          console.warn('[App] Device registration (native) failed:', e);
        }

        // Убираем фантомные/устаревшие ЛОКАЛЬНЫЕ записи этого устройства.
        // getDevices() возвращает только строки, записанные на ЭТОЙ машине,
        // поэтому удаляем все локальные записи с другим hwid (остатки от прежних
        // версий generateHWID) — это не трогает другие устройства в облаке.
        try {
          const localDevices = await getDevices(userData.id);
          for (const localD of localDevices) {
            if (localD.hwid && localD.hwid !== hwid) {
              try { await deleteDevice(localD.id); } catch (e) { console.warn('[App] Local cleanup skip:', e); }
            }
          }
        } catch (e) {
          console.warn('[App] Local device cleanup failed:', e);
        }

        // Also register/check in Supabase for cloud sync + quarantine
        let supabaseDevice: any = null;
        try {
          const result = await supabase.from('devices').select('*').eq('user_id', userData.id).eq('hwid', hwid).maybeSingle();
          supabaseDevice = result.data;
        } catch (e) {
          console.warn('[App] Supabase device check failed:', e);
        }

        const row = {
          id: deviceId,
          user_id: userData.id,
          hwid,
          device_name,
          platform,
          device_type,
          os_name,
          browser_name,
          ip_address,
          location,
          timezone,
          is_vpn,
          is_current: true,
          last_active: new Date().toISOString(),
        };

        if (!supabaseDevice) {
          // Register in Supabase — upsert на уникальный (user_id, hwid)
          try {
            const { data: upserted, error: upsertError } = await supabase
              .from('devices')
              .upsert(row, { onConflict: 'user_id,hwid', ignoreDuplicates: false })
              .select()
              .maybeSingle();
            if (upsertError) {
              console.warn('[App] Supabase device upsert error:', upsertError.message);
              // Fallback: если схема ещё не обновилась (нет новых колонок) —
              // синхронизируем только базовыми колонками, чтобы устройство
              // хотя бы зарегистрировалось и карантин работал.
              const baseRow = {
                id: deviceId,
                user_id: userData.id,
                hwid,
                platform,
                last_active: new Date().toISOString(),
              };
              try {
                const { data: fb } = await supabase
                  .from('devices')
                  .upsert(baseRow, { onConflict: 'user_id,hwid', ignoreDuplicates: false })
                  .select()
                  .maybeSingle();
                supabaseDevice = fb || supabaseDevice;
              } catch (e2) {
                console.warn('[App] Supabase device fallback sync failed:', e2);
              }
            } else {
              supabaseDevice = upserted;
              console.log('[App] Device registered in Supabase:', deviceId);
            }
          } catch (e) {
            console.warn('[App] Supabase device register error:', e);
          }
        } else {
          // Уже есть — обновляем метаданные, чтобы не потерять гео/VPN после перерегистрации
          try {
            await supabase.from('devices').update({
              device_name,
              platform,
              os_name,
              browser_name,
              ip_address,
              location,
              timezone,
              is_vpn,
              last_active: new Date().toISOString(),
            }).eq('id', supabaseDevice.id);
          } catch (e) {
            console.warn('[App] Supabase device update failed:', e);
          }
        }

        // Quarantine check (use supabaseDevice even for newly inserted)
        const device = supabaseDevice;
        if (device?.created_at && isMounted) {
          const created = new Date(device.created_at).getTime();
          const diff = (new Date().getTime() - created) / (1000 * 60 * 60);
          if (diff < QUARANTINE_HOURS) {
            setIsQuarantined(true);
            const target = created + (QUARANTINE_HOURS * 60 * 60 * 1000);
            const interval = setInterval(() => {
              if (!isMounted) { clearInterval(interval); return; }
              const rem = target - new Date().getTime();
              if (rem <= 0) { setIsQuarantined(false); clearInterval(interval); }
              else {
                const h = Math.floor(rem / (1000 * 60 * 60));
                const m = Math.floor((rem % (1000 * 60 * 60)) / (1000 * 60));
                setQuarantineTime(`${h}h ${m}m`);
              }
            }, 60000);
          }
        }
      } catch (err) { console.error('Device init error:', err); }

      // fetchChats уже вызван выше (cache-first) — здесь сеть за свежаком
      // дополнительно дёрнет realtime/reconnect.

    } catch (error) {
      console.error('App init error:', error);
    }
  };

  init();

  return () => {
    isMounted = false;
  };
}, []);

// === Open chat by ?chat=username parameter from initial load ===
const deepLinkChat = searchParams.get('chat');
const initialChatHandled = useRef(false);
useEffect(() => {
  if (user && deepLinkChat && !initialChatHandled.current) {
    initialChatHandled.current = true;
    openChatByUsername(deepLinkChat);
    router.replace('/app', { scroll: false });
  }
}, [user, deepLinkChat, openChatByUsername, router]);

// === Realtime subscriptions ===
useRealtime({
  user,
  chats,
  selectedChatRef,
  onNewMessage: (msg) => setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]),
  onUpdateMessage: (msg) => setMessages(prev => prev.map(m => m.id === msg.id ? msg : m)),
  onFetchChats: () => { if (user) fetchChats(user.id); },
  onNotifyMessage: (senderId, content, currentChatId) => notifyNewMessage(senderId, content, currentChatId),
});

// === Fetch messages when switching chats ===
useEffect(() => {
  if (selectedChat) {
    selectedChatRef.current = selectedChat;
  }
}, [selectedChat]);

  return (
    <div id="echo-app-root" className="flex h-dvh bg-background text-foreground overflow-hidden selection:bg-primary/30 antialiased relative noise-overlay">

      {/* Immersive Background Orbs */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden opacity-30">
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-primary/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-blue-500/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* --- 1. Folder Nav Rail --- */}
      {!isMobile && (
        <AppNavRail
        activeFolderId="all"
        />
      )}

      {/* --- 2. List Sidebar --- */}
      <motion.div
        style={{ x: sidebarX }}
        className={cn(
          // BACK-NAV edge-swipe: при открытом чате на мобиле сайдбар НЕ
          // размонтируется (hidden) — он постоянно живёт за левым краем
          // (x = -W из use-edge-back) и подъезжает синхронно с жестом.
          // Это убирает «моргание» списка: mount в момент жеста его и давал.
          isMobile && selectedChat
            ? "absolute inset-y-0 left-0 w-full flex z-0"
            : "w-full md:w-auto flex shrink-0 h-full relative z-0"
        )}
      >
        <ChatSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connectionStatus={connectionStatus}
          activeMode={activeMode}
          chats={chats}
          chatsFetchError={chatsFetchError}
          selectedChat={selectedChat}
          onlineUsers={onlineUsers}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          searchResults={searchResults}
          isSearching={isSearching}
          isSearchFocused={isSearchFocused}
          recentSearches={recentSearches}
          onSearchOpen={setSearchOpen}
          onSearch={handleSearch}
          onSearchFocus={setIsSearchFocused}
          onStartChat={(p) => handleStartChat(p, chats, (chat) => {
            setSelectedChat(chat);
            if (user) fetchMessages(chat.id, user.id);
          }, (prof) => setChats(prev => [...prev, prof as any]))}
          onSelectChat={(chat) => {
            setSelectedChat(chat);
            if (user) fetchMessages(chat.id, user.id);
          }}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onCreateGroup={() => setIsGroupCreateOpen(true)}
          onCreateChannel={() => toast.info("Создание каналов скоро")}
        />
        <GroupCreateModal
          open={isGroupCreateOpen}
          chats={chats}
          onClose={() => setIsGroupCreateOpen(false)}
        />
      </motion.div>

      {/* --- 3. Main Communication Area --- */}
      <motion.div
        style={{ x: dragX }}
        className={cn(
          "min-w-0 min-h-0",
          // На мобиле с открытым чатом ChatArea — фуллскрин-оверлей над
          // сайдбаром: во время edge-жеста он уезжает вправо, открывая список.
          isMobile && selectedChat ? "absolute inset-0 z-20 flex" : "flex-1 flex relative"
        )}
      >
        <ChatArea
          user={user}
          selectedChat={selectedChat}
          isMobile={isMobile}
          activeMode={activeMode}
          activeTab={activeTab}
          isRightPanelOpen={isRightPanelOpen}
          setIsRightPanelOpen={setIsRightPanelOpen}
          onlineUsers={onlineUsers}
          chats={chats}
          onBack={() => {
            setSelectedChat(null);
            if (isMobile) setSearchOpen(false);
          }}
          onCall={(withVideo) => startOutgoingCall(withVideo)}
          onMentionClick={handleMentionClick}
          messages={messages}
          setMessages={setMessages}
          replyingTo={replyingTo}
          setReplyingTo={setReplyingToSafe}
          editingMessage={editingMessage}
          setEditingMessage={setEditingMessageSafe}
          newMessage={newMessage}
          setNewMessage={setNewMessage}
          fetchMessages={fetchMessages}
          handleSendMessage={handleSendMessage}
          handleSendVoice={handleSendVoice}
          enqueuePending={enqueuePending}
          onCancelPending={cancelPending}
          onOpenChat={(id) => setSelectedChat(chats.find(c => c.id === id)!)}
        />
      </motion.div>

      {/* --- Settings Modal --- */}
      {/* Отдельный слой поверх чата (z-[200]), БЕЗ dragX-трансформа:
          transform у предка ломает nested `position: fixed` (становится
          relative к трансформированному предку) — из-за этого модалка
          жила «на одном слое с чатом» и чат просвечивал как часть настроек. */}
      <div
        className={cn("fixed inset-0 z-[200]", !isSettingsOpen && "pointer-events-none")}
      >
      <AnimatePresence mode="wait">
        {isSettingsOpen && (
          <motion.div
            key="settings"
            initial={isMobile ? { x: "100%", opacity: 0 } : { opacity: 0, scale: 0.98 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={isMobile ? { x: "100%", opacity: 0 } : { opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 30, stiffness: 300, mass: 0.8 }}
            className={cn(
              "absolute inset-0",
              !isMobile && "flex items-center justify-center p-4",
              isMobile && "safe-top safe-bottom"
            )}
          >
            <SettingsModal
              user={user}
              accounts={accounts}
              onClose={() => setIsSettingsOpen(false)}
              isQuarantined={isQuarantined}
              quarantineTime={quarantineTime}
              onUpdateUser={(patch) => setUser(prev => prev ? { ...prev, ...patch } : prev)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* --- Mobile Hotbar --- */}
      {isMobile && !selectedChat && (
        <MobileTabBar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}
      <style jsx global>{`
        .safe-top {
          padding-top: env(safe-area-inset-top);
        }
        .safe-bottom {
          padding-bottom: env(safe-area-inset-bottom);
        }
        .safe-y {
          padding-top: env(safe-area-inset-top);
          padding-bottom: env(safe-area-inset-bottom);
        }
        .safe-x {
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
        }
        .noise-overlay::before {
          content: "";
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          /* Inline SVG noise — без внешнего /noise.png (его нет в public/, был 404) */
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
          opacity: 0.015;
          pointer-events: none;
          z-index: 100;
        }
        html, body {
          overflow: hidden;
          height: 100%;
          overscroll-behavior: none;
        }
        /* Hide scrollbars globally */
        *::-webkit-scrollbar {
          display: none;
        }
        * {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        html {
          touch-action: pan-y;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
        }
        /* Safe-area handled via CSS variables (.safe-top, .safe-bottom, etc.) */
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
        .scanline::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(to bottom, transparent, rgba(88, 101, 242, 0.05), transparent);
          height: 10px;
          animation: scanline 8s linear infinite;
        }
        /* Overscroll containment utility */
        .overscroll-contain {
          overscroll-behavior: contain;
        }
      `}</style>

      {/* --- Call Overlay (fullscreen call UI + FCM wake) --- */}
      <CallOverlay
        currentUserId={user?.id ?? ""}
        outgoingCall={outgoingCall}
        onOutgoingConsumed={() => setOutgoingCall(null)}
        onCallLog={handleCallLog}
        selectedChatId={selectedChat?.id ?? null}
        selectedChatPeerName={selectedChat?.display_name || selectedChat?.username || null}
        selectedChatPeerAvatar={selectedChat?.avatar_url || null}
        currentUserName={user?.display_name || user?.username || null}
        currentUserAvatar={user?.avatar_url || null}
      />
    </div>
  );
}

export default function EchoApp() {
  return (
    <Suspense fallback={
      <div className="h-dvh bg-background flex items-center justify-center noise-overlay">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    }>
      <EchoAppContent />
    </Suspense>
  );
}