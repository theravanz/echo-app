"use client";

import { useState, useEffect, useRef, memo, useCallback, Suspense } from "react";
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
import { cn, safeChar, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/lib/supabase";
import * as bip39 from 'bip39';
import nacl from 'tweetnacl';
// @ts-ignore
import { decodeUTF8, encodeUTF8, decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { toast } from "sonner";
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
import { MessageBubble } from "@/components/echo/app/message-bubble";
import { MediaPicker } from "@/components/echo/app/media-picker";
import { saveDevice, generateHWID } from "@/lib/db";
import { ProfileViewPanel, type ViewedProfile } from "@/components/echo/app/profile-view-panel";
import dynamic from "next/dynamic";
import type { UserProfile, Chat, Message, NetworkMode, AppTab, ConnectionStatus } from "@/hooks/echo/types";
import { useProfileDetails } from "@/hooks/echo/use-profile-details";
import { ChatSidebar } from "@/components/echo/app/chat-sidebar";
import { MobileTabBar } from "@/components/echo/app/mobile-tab-bar";
import { ChatWallpaper, type WallpaperPreset } from "@/components/echo/app/chat-wallpaper";
import { ChatBackgroundPicker } from "@/components/echo/app/chat-background-picker";
import { useContactAccentColor } from "@/hooks/echo/use-contact-accent";
import { CallOverlay, type OutgoingCallRequest, type CallLogData, deriveRoomId } from "@/components/echo/app/CallOverlay";
import { serializeCallLog } from "@/hooks/echo/call-log";

import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
const SettingsModal = dynamic(
  () => import("@/components/echo/app/settings-modal"),
  { ssr: false }
);


// --- Types & Constants ---

const QUARANTINE_HOURS = 32;



// --- Helper Components ---

const CornerBrackets = () => (
  <>
    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-primary/30 rounded-tl-sm pointer-events-none z-10" />
    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-primary/30 rounded-tr-sm pointer-events-none z-10" />
    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-primary/30 rounded-bl-sm pointer-events-none z-10" />
    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-primary/30 rounded-br-sm pointer-events-none z-10" />
  </>
);

const GlassPanel = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("bg-card/30 backdrop-blur-2xl border border-white/5 relative overflow-hidden", className)}>
    {children}
  </div>
);

// --- Main Application Content ---

function EchoAppContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const { language } = useTranslation();

  // App State
  const [appLoading, setAppLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Establishing Secure Node...");
  const [activeTab, setActiveTab] = useState<AppTab>('chats');
  const [activeMode, setActiveMode] = useState<NetworkMode>('direct');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [outgoingCall, setOutgoingCall] = useState<OutgoingCallRequest | null>(null);
  const [isQuarantined, setIsQuarantined] = useState(false);
  const [quarantineTime, setQuarantineTime] = useState("");
  const [currentHwid, setCurrentHwid] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef<UserProfile | null>(null);
  const originalChatRef = useRef<Chat | null>(null);

  const { chats, setChats, fetchChats, selectedChat, setSelectedChat, selectedChatRef, drafts, saveDraft, onlineUsers } = useChatList(user);
  const { profile: viewedProfile } = useProfileDetails(isRightPanelOpen ? selectedChat?.id ?? null : null);

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

  // Chat wallpaper state
  const accentColor = useContactAccentColor(selectedChat?.avatar_url || null, selectedChat?.avatar_color || null);
  const [chatWallpaper, setChatWallpaper] = useState<{ preset: WallpaperPreset; photoUrl: string | null }>({
    preset: (selectedChat as any)?.wallpaper_preset || 'solid',
    photoUrl: (selectedChat as any)?.wallpaper_photo_url || null,
  });
  const [bgPickerOpen, setBgPickerOpen] = useState(false);

  const { messages, setMessages, replyingTo, setReplyingTo, editingMessage, setEditingMessage, newMessage, setNewMessage, fetchMessages, handleSendMessage } = useMessages(chats);
  const { addToQueue, processPendingQueue } = useNetworkQueue();
  const { connectionStatus, setConnectionStatus } = useConnection(processPendingQueue);
  const { searchOpen, setSearchOpen, searchQuery, searchResults, isSearching, isSearchFocused, setIsSearchFocused, recentSearches, searchRef, searchTimeoutRef, handleSearch, handleStartChat, clearSearch, setCurrentUserId } = useProfiles();

  useEffect(() => {
    if (user?.id) setCurrentUserId(user.id);
  }, [user?.id, setCurrentUserId]);
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
          .catch((e) => console.warn("[Push] send-call-push failed:", e));
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

// Chat wallpaper: sync when switching chats
useEffect(() => {
  if (!selectedChat) return;
  if ((selectedChat as any).wallpaper_preset) {
    setChatWallpaper({
      preset: (selectedChat as any).wallpaper_preset || 'solid',
      photoUrl: (selectedChat as any).wallpaper_photo_url || null,
    });
  } else {
    // Fetch wallpaper data for this chat if not already loaded
    supabase.from('chats').select('wallpaper_preset, wallpaper_photo_url').eq('id', selectedChat.id).maybeSingle().then(({ data }) => {
      if (data) {
        setChatWallpaper({
          preset: (data as any).wallpaper_preset || 'solid',
          photoUrl: (data as any).wallpaper_photo_url || null,
        });
      }
    });
  }
}, [selectedChat?.id]);

// Mobile keyboard: keep header visible when keyboard opens
useEffect(() => {
  if (!isMobile || typeof window === 'undefined') return;

  const appRoot = document.getElementById('echo-app-root');
  if (!appRoot) return;

  const handler = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    // When keyboard is open, visualViewport is smaller than layout viewport
    const isKeyboardOpen = vv.height < window.innerHeight - 80;
    if (isKeyboardOpen) {
      appRoot.style.height = `${vv.height}px`;
      appRoot.style.position = 'fixed';
      appRoot.style.top = '0';
      appRoot.style.left = '0';
      appRoot.style.right = '0';
      appRoot.style.overflow = 'hidden';
    } else {
      appRoot.style.height = '';
      appRoot.style.position = '';
      appRoot.style.top = '';
      appRoot.style.left = '';
      appRoot.style.right = '';
      appRoot.style.overflow = '';
    }
  };

  window.visualViewport?.addEventListener('resize', handler);
  window.visualViewport?.addEventListener('scroll', handler);
  return () => {
    window.visualViewport?.removeEventListener('resize', handler);
    window.visualViewport?.removeEventListener('scroll', handler);
  };
}, [isMobile]);

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
      if (isOffline) {
        if (isMounted) setAppLoading(false);
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
          setAppLoading(false);
          router.push('/auth');
        }
        return;
      }

      if (!session) {
        router.push('/auth');
        return;
      }

      let userData: UserProfile;
      try {
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        userData = { ...session.user, user_metadata: { ...session.user.user_metadata, ...(profile || {}) } } as UserProfile;
      } catch {
        userData = session.user as UserProfile;
      }

      if (!isMounted) return;
      setUser(userData);
      userRef.current = userData;


      // Register this device + check quarantine
      try {
        const hwid = await generateHWID();
        localStorage.setItem('echo_device_hwid', hwid); // sync for old code
        setCurrentHwid(hwid);

        // Register device in native SQLite
        const deviceId = `device_${userData.id}_${Date.now()}`;
        try {
          await saveDevice({
            id: deviceId,
            user_id: userData.id,
            hwid,
            device_name: navigator.userAgent || 'Echo Desktop',
            platform: navigator.platform || 'unknown',
            is_current: true,
          });
          console.log('[App] Device registered:', deviceId);
        } catch (e) {
          console.warn('[App] Device registration (native) failed:', e);
        }

        // Also register/check in Supabase for cloud sync + quarantine
        let supabaseDevice: any = null;
        try {
          const result = await supabase.from('devices').select('*').eq('user_id', userData.id).eq('hwid', hwid).maybeSingle();
          supabaseDevice = result.data;
        } catch (e) {
          console.warn('[App] Supabase device check failed:', e);
        }

        if (!supabaseDevice) {
          // Register in Supabase — use only columns that exist in the schema
          try {
            const { data: insertedDevice, error: insertError } = await supabase.from('devices').insert({
              id: deviceId,
              user_id: userData.id,
              hwid,
              platform: navigator.platform || 'unknown',
            }).select().maybeSingle();

            if (insertError) {
              console.warn('[App] Supabase device insert error:', insertError.message);
              // RLS issue — try upsert as fallback
              const { data: upserted } = await supabase.from('devices').upsert({
                id: deviceId,
                user_id: userData.id,
                hwid,
                platform: navigator.platform || 'unknown',
              }, { onConflict: 'hwid', ignoreDuplicates: false }).select().maybeSingle();
              supabaseDevice = upserted;
            } else {
              supabaseDevice = insertedDevice;
              console.log('[App] Device registered in Supabase:', deviceId);
            }
          } catch (e) {
            console.warn('[App] Supabase device register error:', e);
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

      fetchChats(userData.id).catch(err => console.error('Fetch chats error:', err));

      // Init complete — снимаем loading-состояние (раньше это делалось
      // только в catch, что оставляло appLoading=true навсегда при успехе).
      if (isMounted) setAppLoading(false);

    } catch (error) {
      console.error('App init error:', error);
      if (isMounted) setAppLoading(false);
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
  if (selectedChat && user) {
    selectedChatRef.current = selectedChat;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    fetchMessages(selectedChat.id, user.id);
  }
}, [selectedChat?.id, user?.id]);

// === Autoscroll ===
useEffect(() => {
  if (scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [messages, selectedChat]);

  return (
    <div id="echo-app-root" className="flex h-dvh bg-background text-foreground overflow-hidden selection:bg-primary/30 antialiased relative noise-overlay">

      {/* Immersive Background Orbs */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden opacity-30">
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-primary/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-blue-500/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* --- 1. Navigation Rails --- */}
      {!isMobile && (
        <aside className="w-[84px] border-r border-white/5 flex flex-col items-center py-8 gap-8 bg-black/20 backdrop-blur-3xl z-30 shrink-0">
          <div className="group cursor-pointer">
             <img src="/logo-full.svg" alt="E" className="h-6 w-auto grayscale opacity-50 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500" />
          </div>

          <div className="flex flex-col gap-5">
            {[
              { id: 'community', icon: Users, label: 'Community' },
              { id: 'chats', icon: MessageSquare, label: 'Chats' },
              { id: 'feed', icon: Compass, label: 'Feed' }
            ].map(tab => (
              <button
                key={tab.id}
                className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500 relative group",
                  activeTab === tab.id ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20 scale-110" : "text-white/20 hover:text-white hover:bg-white/5"
                )}
                onClick={() => setActiveTab(tab.id as any)}
              >
                <tab.icon className="w-5 h-5 relative z-10" />
                {activeTab === tab.id && <div className="absolute inset-0 bg-primary blur-md opacity-40 rounded-2xl" />}
                <div className="absolute left-full ml-4 px-3 py-1.5 bg-card border border-white/10 rounded-lg text-[10px] font-mono uppercase tracking-widest opacity-0 group-hover:opacity-100 pointer-events-none transition-all translate-x-[-10px] group-hover:translate-x-0 whitespace-nowrap z-50 shadow-2xl">
                   {tab.label}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-auto flex flex-col gap-5">
            <button className="w-12 h-12 rounded-2xl bg-white/5 text-white/20 flex items-center justify-center hover:bg-white/10 hover:bg-white/10 hover:text-white transition-all">
              <Plus className="w-5 h-5" />
            </button>
            <button className="w-12 h-12 rounded-full border border-white/5 p-1 hover:border-primary/40 transition-all overflow-hidden relative group" onClick={() => setIsSettingsOpen(true)}>
               <div className="w-full h-full rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold uppercase overflow-hidden">
                 {user?.user_metadata?.avatar_url ? (
                   <img src={user.user_metadata.avatar_url} className="w-full h-full object-cover" alt="" />
                 ) : (
                   safeChar(user?.user_metadata?.display_name || user?.email, "D")
                 )}
               </div>
               <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Settings className="w-4 h-4 text-white" />
               </div>
            </button>
          </div>
        </aside>
      )}

      {/* --- 2. List Sidebar --- */}
      <div className={cn(isMobile && selectedChat ? "hidden" : "w-full md:w-auto flex shrink-0 h-full")}>
        <ChatSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connectionStatus={connectionStatus}
          activeMode={activeMode}
          chats={chats}
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
        />
      </div>

      {/* --- 3. Main Communication Area --- */}
      <main className={cn(
        "flex-1 flex flex-col relative z-10 transition-all duration-700 ease-in-out bg-black/[0.02] min-h-0",
        isMobile && !selectedChat && (activeTab === 'chats' || activeTab === 'community' || activeTab === 'feed') ? "translate-x-full absolute inset-y-0 opacity-0 pointer-events-none" : "translate-x-0 opacity-100 relative"
      )}>

        {/* Terminal Header */}
        <header className="h-14 md:h-20 border-b border-white/5 flex items-center justify-between px-4 md:px-8 bg-black/10 backdrop-blur-3xl shrink-0 safe-top" style={{ touchAction: "none" }}>
          <div className="flex items-center gap-6 min-w-0 flex-1">
            {isMobile && selectedChat && (
              <Button variant="ghost" size="icon" className="rounded-2xl text-white/40" onClick={() => { setSelectedChat(null); if (isMobile) setSearchOpen(false); }}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
            )}

            {!isMobile && (
              <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/5 rounded-2xl group cursor-default">
                 <div className={cn("w-2 h-2 rounded-full animate-pulse", activeMode === 'direct' ? "bg-primary" : activeMode === 'relay' ? "bg-amber-500" : "bg-blue-500")} />
                 <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 group-hover:text-white/60 transition-colors">
                    Mode: {activeMode === 'direct' ? 'Mesh Direct' : activeMode === 'relay' ? 'Relay Node' : 'Global Net'}
                 </span>
              </div>
            )}

            {selectedChat && (
              <div className="flex items-center gap-4 group cursor-pointer min-w-0 flex-1" onClick={() => { setIsRightPanelOpen(!isRightPanelOpen); }}>
                 <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-primary font-bold text-sm shadow-xl shrink-0" style={{ backgroundColor: selectedChat.avatar_color || 'oklch(0.2 0.02 280)' }}>
                    {selectedChat.avatar_url ? <img src={selectedChat.avatar_url} className="w-full h-full object-cover rounded-full" alt="" /> : (selectedChat.display_name?.[0] || 'U')}
                 </div>
                <div className="min-w-0">
                  <div className="font-bold text-base truncate">{selectedChat.display_name || selectedChat.username}</div>
                  <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest truncate">@{selectedChat.username}</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
             <div className="hidden lg:flex items-center gap-4 px-5 py-2.5 rounded-full bg-white/5 border border-white/5">
                <div className="flex items-center gap-2">
                   <Wifi className="w-3.5 h-3.5 text-primary" />
                   <span className="text-[10px] font-mono font-bold uppercase tracking-widest">12ms</span>
                </div>
                <div className="w-px h-3 bg-white/10" />
                <div className="flex items-center gap-2">
                   <Database className="w-3.5 h-3.5 text-primary" />
                   <span className="text-[10px] font-mono font-bold uppercase tracking-widest">3.2MB</span>
                </div>
             </div>
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="ghost" size="icon" className="rounded-2xl text-white/30 hover:text-white hover:bg-white/5 transition-all">
                      <MoreVertical className="w-5 h-5" />
                   </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl">
                   <DropdownMenuItem onClick={() => { setIsRightPanelOpen(true); }}>
                      <User className="w-4 h-4 mr-2" /> Profile
                   </DropdownMenuItem>
                   <DropdownMenuItem onClick={() => setBgPickerOpen(true)}>
                      <Palette className="w-4 h-4 mr-2" /> Change Wallpaper
                   </DropdownMenuItem>
                   <DropdownMenuSeparator className="bg-white/5" />
                   <DropdownMenuItem onClick={async () => {
                      if (!selectedChat || !user) return;
                      const confirmed = window.confirm('Delete all messages in this chat?');
                      if (!confirmed) return;
                      await supabase.from("messages").delete().or(
                         `and(sender_id.eq.${user.id},receiver_id.eq.${selectedChat.id}),and(sender_id.eq.${selectedChat.id},receiver_id.eq.${user.id})`
                      );
                      setMessages([]);
                      toast.success('Chat cleared');
                   }} className="text-destructive focus:text-destructive">
                      <Trash2 className="w-4 h-4 mr-2" /> Clear Chat
                   </DropdownMenuItem>
                </DropdownMenuContent>
             </DropdownMenu>
          </div>
        </header>

        {/* Messaging Core */}
        <div className="flex-1 min-h-0 relative overflow-hidden">
          <ChatWallpaper preset={chatWallpaper.preset} accentColor={accentColor} photoUrl={chatWallpaper.photoUrl} />
          <div className="relative z-[1] h-full px-3 md:px-12 py-3 md:py-8 overflow-y-auto overscroll-contain scrollbar-hide" ref={scrollRef}>
            <div className="max-w-4xl mx-auto space-y-4 md:space-y-12">

            {!selectedChat && (
              <div className="h-[60dvh] flex flex-col items-center justify-center text-center space-y-8 animate-in fade-in zoom-in duration-1000">
                 <div className="relative group">
                    <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full animate-pulse group-hover:bg-primary/30 transition-all duration-1000" />
                    <div className="relative w-32 h-32 rounded-[48px] bg-card border border-primary/20 flex items-center justify-center shadow-2xl shadow-primary/10 transform -rotate-6 group-hover:rotate-0 transition-transform duration-700">
                       <Fingerprint className="w-16 h-16 text-primary" />
                    </div>
                 </div>
                 <div className="space-y-4">
                    <h3 className="text-3xl font-display font-bold tracking-tight">Access Secure Vault</h3>
                    <p className="text-muted-foreground text-sm max-w-xs mx-auto leading-relaxed">Select a communication node from the sidebar to establish a decentralized P2P tunnel.</p>
                 </div>
                 <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-white/5 border border-white/5 text-[10px] font-mono uppercase tracking-[0.3em] text-white/40">
                    <Lock className="w-3 h-3" />
                    Encrypted_Storage_Active
                 </div>
              </div>
            )}

            {selectedChat && messages.map((msg, i) => {
               const isMe = msg.sender_id === user?.id;
               const showAvatar = i === 0 || messages[i-1].sender_id !== msg.sender_id;

               return (
                 <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isMe={isMe}
                    showAvatar={showAvatar}
                    activeChat={selectedChat}
                    user={user}
                    onReply={setReplyingTo}
                    onEdit={(m) => {
                      setEditingMessage(m);
                      setNewMessage(m.content);
                      textareaRef.current?.focus();
                    }}
                     onMentionClick={handleMentionClick}
                 />
               );
            })}
          </div>
        </div>
        </div>

        {/* Input Interface */}
        {selectedChat && (
          <footer className={cn("px-2 pb-2 md:px-10 md:pb-6 shrink-0", isMobile && "safe-bottom")} style={{ touchAction: "none" }}>
             <div className="w-full mx-auto max-w-4xl">
                <div className="flex items-end gap-2 bg-white/[0.04] border border-white/[0.06] rounded-[20px] md:rounded-[28px] px-3 py-2 md:px-5 md:py-3 backdrop-blur-xl transition-all duration-300 focus-within:border-white/10 focus-within:bg-white/[0.06] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.4)]">

                   {replyingTo && (
                     <div className="px-4 py-2 bg-black/20 border-b border-white/5 flex items-center justify-between animate-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center gap-3 overflow-hidden">
                           <Reply className="w-4 h-4 text-primary shrink-0" />
                           <div className="text-xs truncate">
                              <div className="font-bold">{replyingTo.sender_id === user?.id ? 'You' : (selectedChat.display_name || selectedChat.username)}</div>
                              <div className="opacity-60 truncate">{replyingTo.content}</div>
                           </div>
                        </div>
                        <Button variant="ghost" size="icon" className="w-6 h-6 rounded-full" onClick={() => setReplyingTo(null)}><X className="w-4 h-4" /></Button>
                     </div>
                   )}

                   {editingMessage && (
                     <div className="px-4 py-2 bg-primary/10 border-b border-white/5 flex items-center justify-between animate-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center gap-3 overflow-hidden">
                           <Pen className="w-4 h-4 text-primary shrink-0" />
                           <div className="text-xs truncate">
                              <div className="font-bold text-primary">Editing Message</div>
                              <div className="opacity-60 truncate">{editingMessage.content}</div>
                           </div>
                        </div>
                        <Button variant="ghost" size="icon" className="w-6 h-6 rounded-full" onClick={() => { setEditingMessage(null); setNewMessage(""); }}><X className="w-4 h-4" /></Button>
                     </div>
                   )}

                   <div className="flex items-end gap-2">
                      <div className="flex items-center p-1 gap-1">
                         <Button variant="ghost" size="icon" className="w-10 h-10 md:w-12 md:h-12 rounded-[28px] text-white/20 hover:text-primary hover:bg-primary/5 transition-all">
                           <Paperclip className="w-5 h-5" />
                         </Button>
                         <Popover>
                            <PopoverTrigger asChild>
                               <Button variant="ghost" size="icon" className="w-10 h-10 md:w-12 md:h-12 rounded-[28px] text-white/20 hover:text-primary hover:bg-primary/5 transition-all">
                                 <Smile className="w-5 h-5" />
                               </Button>
                            </PopoverTrigger>
                            <PopoverContent side="top" align="start" className="p-0 border-none bg-transparent shadow-none">
                               <MediaPicker
                                  onEmojiSelect={(emoji) => setNewMessage(prev => prev + emoji)}
                                  onStickerSelect={(url) => handleSendMessage(selectedChat, user!, '', 'sticker', url, addToQueue)}
                                  onGifSelect={(url) => handleSendMessage(selectedChat, user!, '', 'gif', url, addToQueue)}
                               />
                            </PopoverContent>
                         </Popover>
                      </div>

                      <div className="flex-1 mb-1 relative group">
                        {newMessage.length > 0 && (
                          <div className="absolute -top-12 left-0 right-0 flex items-center gap-1 p-1.5 bg-black/40 backdrop-blur-xl border border-white/5 rounded-2xl animate-in fade-in slide-in-from-bottom-2 duration-300 z-50">
                             <button onClick={() => {
                               const start = textareaRef.current?.selectionStart || 0;
                               const end = textareaRef.current?.selectionEnd || 0;
                               const val = newMessage;
                               setNewMessage(val.substring(0, start) + `**${val.substring(start, end)}**` + val.substring(end));
                             }} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors" title="Bold"><Bold className="w-3.5 h-3.5" /></button>
                             <button onClick={() => {
                               const start = textareaRef.current?.selectionStart || 0;
                               const end = textareaRef.current?.selectionEnd || 0;
                               const val = newMessage;
                               setNewMessage(val.substring(0, start) + `*${val.substring(start, end)}*` + val.substring(end));
                             }} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors" title="Italic"><Italic className="w-3.5 h-3.5" /></button>
                             <button onClick={() => {
                               const start = textareaRef.current?.selectionStart || 0;
                               const end = textareaRef.current?.selectionEnd || 0;
                               const val = newMessage;
                               setNewMessage(val.substring(0, start) + `\`${val.substring(start, end)}\`` + val.substring(end));
                             }} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors" title="Code"><Code className="w-3.5 h-3.5" /></button>
                             <div className="w-px h-4 bg-white/10 mx-1" />
                             <button onClick={() => {
                               const start = textareaRef.current?.selectionStart || 0;
                               const end = textareaRef.current?.selectionEnd || 0;
                               const val = newMessage;
                               setNewMessage(val.substring(0, start) + `||${val.substring(start, end)}||` + val.substring(end));
                             }} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors" title="Spoiler"><EyeOff className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                        <textarea
                          ref={textareaRef}
                          rows={1}
                          placeholder={editingMessage ? "Изменить сообщение..." : "Сообщение..."}
                          value={newMessage}
                          onChange={(e) => {
                            setNewMessage(e.target.value);
                            e.target.style.height = 'auto';
                            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                          }}
                          className="w-full bg-transparent border-none py-2.5 px-2 text-[15px] font-medium resize-none outline-none focus:ring-0 placeholder:text-white/10 leading-relaxed scrollbar-hide"
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isMobile) { e.preventDefault(); handleSendMessage(selectedChat, user!, newMessage); } }}
                        />
                      </div>

                      <button
                        onClick={() => handleSendMessage(selectedChat, user!, newMessage)}
                        disabled={!newMessage.trim()}
                        className={cn(
                          "w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all shrink-0",
                          newMessage.trim() ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-white/5 text-white/20"
                        )}
                      >
                         <Send className="w-5 h-5" />
                      </button>
                   </div>
                </div>
             </div>
          </footer>
        )}
      </main>

      {/* --- Profile View Panel (Right) --- */}
      <AnimatePresence mode="wait">
        {selectedChat && isRightPanelOpen && viewedProfile && (
          <motion.aside
            initial={isMobile ? { x: "100%", opacity: 0 } : { x: 100, opacity: 0, filter: "blur(10px)" }}
            animate={{ x: 0, opacity: 1, filter: "blur(0px)" }}
            exit={isMobile ? { x: "100%", opacity: 0 } : { x: 100, opacity: 0, filter: "blur(10px)" }}
            transition={{ type: "spring", damping: 30, stiffness: 300, mass: 0.8 }}
            className={cn(
              "flex flex-col z-40 shrink-0",
              isMobile ? "fixed inset-0 w-full h-full safe-top safe-bottom bg-[#0a0a0d]" : "border-l border-white/5 relative w-96"
            )}
          >
            <ProfileViewPanel
              profile={{
                ...viewedProfile,
                is_online: onlineUsers.has(selectedChat.id),
                last_seen_label: formatRelativeTime(selectedChat.lastMessageTime || new Date().toISOString()),
              }}
              onClose={() => {
                setIsRightPanelOpen(false);
                if (originalChatRef.current) {
                  setSelectedChat(originalChatRef.current);
                  originalChatRef.current = null;
                }
              }}
              onMuteToggle={() => {}}
              onCall={() => startOutgoingCall(false)}
              onVideoCall={() => startOutgoingCall(true)}
              onBlock={async () => {
                await supabase.from("blocks").insert({ blocker_id: user?.id, blocked_id: selectedChat.id });
              }}
              onReport={() => {}}
              onClearHistory={async () => {
                if (user) {
                  await supabase.from("messages").delete().or(
                    `and(sender_id.eq.${user.id},receiver_id.eq.${selectedChat.id}),and(sender_id.eq.${selectedChat.id},receiver_id.eq.${user.id})`
                  );
                }
              }}
            />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* --- Settings Modal --- */}
      <AnimatePresence mode="wait">
        {isSettingsOpen && (
          <motion.div
            key="settings"
            initial={isMobile ? { x: "100%", opacity: 0 } : { opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={isMobile ? { x: "100%", opacity: 0 } : { opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300, mass: 0.8 }}
            className={cn(
              "fixed inset-0 z-[100]",
              !isMobile && "flex items-center justify-center p-4",
              isMobile && "safe-top safe-bottom"
            )}
          >
            <SettingsModal
              user={user}
              accounts={accounts}
              onClose={() => setIsSettingsOpen(false)}
              isQuarantined={isQuarantined}
              onUpdateUser={(patch) => setUser(prev => prev ? { ...prev, ...patch } : prev)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Chat Background Picker --- */}
      {selectedChat && (
        <ChatBackgroundPicker
          open={bgPickerOpen}
          onClose={() => setBgPickerOpen(false)}
          chatId={selectedChat.id}
          accentColor={accentColor}
          current={chatWallpaper}
          onChange={(next) => {
            setChatWallpaper(next);
          }}
        />
      )}

      {/* --- Mobile Hotbar --- */}
      {isMobile && !selectedChat && (
        <MobileTabBar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}
      <style jsx global>{`
        .noise-overlay::before {
          content: "";
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: url('/noise.png');
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