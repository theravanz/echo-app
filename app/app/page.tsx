"use client";

import { useState, useEffect, useRef, memo, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
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
import { useChatList } from "@/hooks/echo/use-chat-list";
import { useMessages } from "@/hooks/echo/use-messages";
import { useNetworkQueue } from "@/hooks/echo/use-network-queue";
import { useRealtime } from "@/hooks/echo/use-realtime";
import { useConnection } from "@/hooks/echo/use-connection";
import { useProfiles } from "@/hooks/echo/use-profiles";
import { MessageBubble } from "@/components/echo/app/message-bubble";
import { MediaPicker } from "@/components/echo/app/media-picker";
import { saveDevice, generateHWID } from "@/lib/db";
import dynamic from "next/dynamic";
import type { UserProfile, Chat, Message, NetworkMode, AppTab, ConnectionStatus } from "@/hooks/echo/types";

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
  const [isQuarantined, setIsQuarantined] = useState(false);
  const [quarantineTime, setQuarantineTime] = useState("");
  const [currentHwid, setCurrentHwid] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef<UserProfile | null>(null);

  const { chats, setChats, fetchChats, selectedChat, setSelectedChat, selectedChatRef, drafts, saveDraft, onlineUsers } = useChatList(user);

  const { messages, setMessages, replyingTo, setReplyingTo, editingMessage, setEditingMessage, newMessage, setNewMessage, fetchMessages, handleSendMessage } = useMessages(chats);
  const { addToQueue, processPendingQueue } = useNetworkQueue();
  const { connectionStatus, setConnectionStatus } = useConnection(processPendingQueue);
  const { searchOpen, setSearchOpen, searchQuery, searchResults, isSearching, isSearchFocused, setIsSearchFocused, recentSearches, searchRef, searchTimeoutRef, handleSearch, handleStartChat } = useProfiles();
  const { settings: notificationSettings } = useNotificationSettings(user);
  const { notifyNewMessage } = useNotifications({ user, chats, settings: notificationSettings, onNotificationClick: (chatId) => setSelectedChat(chats.find(c => c.id === chatId) || null) });

 

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

// === App Initialization ===
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
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
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
        const { data: supabaseDevice } = await supabase.from('devices').select('*').eq('user_id', userData.id).eq('hwid', hwid).maybeSingle();
        
        if (!supabaseDevice) {
          // Register in Supabase too
          await supabase.from('devices').insert({
            id: deviceId,
            user_id: userData.id,
            hwid,
            device_name: navigator.userAgent || 'Echo Desktop',
            platform: navigator.platform || 'unknown',
            os_name: navigator.platform || 'unknown',
            browser_name: navigator.userAgent?.includes('Chrome') ? 'Chrome' : navigator.userAgent?.includes('Firefox') ? 'Firefox' : 'Echo Web',
            is_current: true,
            created_at: new Date().toISOString(),
            last_active: new Date().toISOString(),
          });
          console.log('[App] Device registered in Supabase');
        }

        // Quarantine check (from Supabase)
        const device = supabaseDevice;
        if (device && isMounted) {
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
    <div className="flex h-dvh bg-background text-foreground overflow-hidden selection:bg-primary/30 antialiased relative noise-overlay">

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
      <aside className={cn(
        "w-full md:w-[360px] border-r border-white/5 flex flex-col bg-black/10 backdrop-blur-2xl z-20 shrink-0 transition-all duration-700 ease-in-out",
        isMobile && selectedChat ? "-translate-x-full absolute inset-y-0 opacity-0 pointer-events-none" : "opacity-100 translate-x-0 relative"
      )}>
        <div className="h-16 md:h-20 px-4 md:px-6 pt-2 md:pt-0 flex items-center justify-between shrink-0">
          {activeTab === 'chats' ? (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 group">
                    {connectionStatus === 'connected' && (
                      <>
                        <Wifi className="w-5 h-5 text-primary" />
                        <span className="font-display font-bold text-2xl tracking-tight group-hover:text-primary transition-colors">Chats</span>
                      </>
                    )}
                    {connectionStatus === 'connecting' && (
                      <>
                        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin" />
                        <span className="font-display font-bold text-2xl tracking-tight text-muted-foreground">Connecting</span>
                      </>
                    )}
                    {connectionStatus === 'disconnected' && (
                      <>
                        <ZapOff className="w-5 h-5 text-destructive" />
                        <span className="font-display font-bold text-2xl tracking-tight text-destructive">Offline</span>
                      </>
                    )}
                    <ChevronDown className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52 rounded-2xl border-white/10 bg-background/95 backdrop-blur-3xl p-2">
                  <DropdownMenuLabel className="text-[9px] font-mono uppercase tracking-widest text-white/40 px-3 py-2">Network Mode</DropdownMenuLabel>
                  <DropdownMenuItem className="rounded-xl gap-3 py-3 px-3 cursor-pointer">
                    <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                    <div>
                      <div className="text-sm font-bold">Base</div>
                      <div className="text-[10px] text-white/40 font-medium">Default Connection</div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="rounded-xl gap-3 py-3 px-3 cursor-pointer">
                    <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <div>
                      <div className="text-sm font-bold">Relay</div>
                      <div className="text-[10px] text-white/40 font-medium">P2P · Servers</div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="rounded-xl gap-3 py-3 px-3 cursor-pointer">
                    <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                    <div>
                      <div className="text-sm font-bold">Mesh</div>
                      <div className="text-[10px] text-white/40 font-medium">Decentralized Web</div>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <h2 className="font-display font-bold text-2xl tracking-tight">
              {activeTab === 'community' && 'Community'}
              {activeTab === 'feed' && 'Feed'}
            </h2>
          )}
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-2xl w-10 h-10 text-white/20 hover:text-primary hover:bg-primary/5 transition-all"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-2xl w-10 h-10 text-white/20 hover:text-white hover:bg-white/5 transition-all">
              <MoreVertical className="w-5 h-5" />
            </Button>
          </div>
        </div>
        {searchOpen && (
          <div className="absolute inset-0 z-30 bg-background backdrop-blur-2xl rounded-3xl overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
            <div className="flex flex-col h-full">
              <div className="px-4 pt-4 pb-2 space-y-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSearchOpen(false)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-white/40 hover:bg-white/5 hover:text-white transition-all"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className="flex-1 relative">
                    <div className="absolute -inset-0.5 bg-primary/20 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                      onFocus={() => setIsSearchFocused(true)}
                      placeholder="Search contacts, messages..."
                      className="relative w-full h-10 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-sm text-white outline-none focus:border-primary/50 transition-all placeholder:text-white/20"
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide px-4 pb-4">
                {isSearching && (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                  </div>
                )}

                {!isSearching && searchResults.length > 0 && (
                  <div>
                    <div className="px-2 py-3 text-[9px] font-mono text-white/20 uppercase tracking-[0.2em]">
                      {language === 'ru' ? 'Результаты поиска' : 'Search Results'}
                    </div>
                    {searchResults.map((profile: any) => (
                      <button
                        key={profile.id}
                        onClick={() => handleStartChat(profile, chats, (chat) => setSelectedChat(chat), (p) => setChats(prev => { if (prev.find(c => c.id === p.id)) return prev; return [{ ...p, lastMessage: null, lastMessageTime: null, unreadCount: 0 }, ...prev]; }))}
                        className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-white/5 transition-all group"
                      >
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-primary font-bold text-sm overflow-hidden shrink-0" style={{ backgroundColor: profile.avatar_color || 'oklch(0.2 0.02 280)' }}>
                          {profile.avatar_url ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" /> : safeChar(profile.display_name || profile.username)}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <div className="text-sm font-bold truncate group-hover:text-primary transition-colors">{profile.display_name || profile.username}</div>
                          <div className="text-[10px] text-white/30 font-mono">@{profile.username}</div>
                        </div>
                        <MessageSquare className="w-4 h-4 text-white/20 group-hover:text-primary transition-colors shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {!isSearching && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Ghost className="w-10 h-10 text-white/10 mb-3" />
                    <div className="text-sm text-white/30 font-medium">{language === 'ru' ? 'Ничего не найдено' : 'No nodes found'}</div>
                    <div className="text-[10px] text-white/20 font-mono mt-1">{language === 'ru' ? 'Попробуйте другой запрос' : 'Try a different query'}</div>
                  </div>
                )}

                {!isSearching && searchQuery.trim().length < 2 && recentSearches.length > 0 && (
                  <div>
                    <div className="px-2 py-3 text-[9px] font-mono text-white/20 uppercase tracking-[0.2em]">
                      {language === 'ru' ? 'Недавние поиски' : 'Recent Searches'}
                    </div>
                    {recentSearches.map((profile: any) => (
                      <button
                        key={profile.id}
                        onClick={() => handleStartChat(profile, chats, (chat) => setSelectedChat(chat), (p) => setChats(prev => { if (prev.find(c => c.id === p.id)) return prev; return [{ ...p, lastMessage: null, lastMessageTime: null, unreadCount: 0 }, ...prev]; }))}
                        className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-white/5 transition-all group"
                      >
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-primary font-bold text-sm overflow-hidden shrink-0" style={{ backgroundColor: profile.avatar_color || 'oklch(0.2 0.02 280)' }}>
                          {profile.avatar_url ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" /> : safeChar(profile.display_name || profile.username)}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <div className="text-sm font-bold truncate group-hover:text-primary transition-colors">{profile.display_name || profile.username}</div>
                          <div className="text-[10px] text-white/30 font-mono">@{profile.username}</div>
                        </div>
                        <Clock className="w-4 h-4 text-white/20 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {!isSearching && searchQuery.trim().length < 2 && recentSearches.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Search className="w-10 h-10 text-white/10 mb-3" />
                    <div className="text-sm text-white/30 font-medium">{language === 'ru' ? 'Поиск пользователей' : 'Search for users'}</div>
                    <div className="text-[10px] text-white/20 font-mono mt-1">{language === 'ru' ? 'Введите имя или username' : 'Enter name or username'}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {isQuarantined && (
          <div className="mx-6 mb-6 p-4 rounded-[24px] bg-amber-500/5 border border-amber-500/10 flex gap-4 animate-in fade-in slide-in-from-top-4 duration-700">
             <Shield className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
             <div>
                <div className="text-[10px] font-mono text-amber-500 uppercase tracking-widest font-bold mb-1">New Node Protection</div>
                <div className="text-xs text-amber-500/60 leading-relaxed font-medium">Node features restricted for <span className="text-amber-500 font-bold">{quarantineTime}</span></div>
             </div>
          </div>
        )}

        <div className="flex-1 min-h-0 px-4 overflow-y-auto overscroll-contain scrollbar-hide" style={{ paddingBottom: isMobile ? "64px" : "0", touchAction: "pan-y" }}>
          <div className="space-y-1 pb-8">
            {activeTab === 'community' && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                  <Users className="w-8 h-8 text-primary/60" />
                </div>
                <h3 className="text-lg font-display font-bold mb-2">Community</h3>
                <p className="text-xs text-white/30 font-mono uppercase tracking-widest max-w-[240px]">
                  {language === 'ru' ? 'Страница в разработке, пожалуйста загляните позже' : 'Page in development, please check back later'}
                </p>
              </div>
            )}
            {activeTab === 'feed' && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                  <Compass className="w-8 h-8 text-primary/60" />
                </div>
                <h3 className="text-lg font-display font-bold mb-2">Feed</h3>
                <p className="text-xs text-white/30 font-mono uppercase tracking-widest max-w-[240px]">
                  {language === 'ru' ? 'Страница в разработке, пожалуйста загляните позже' : 'Page in development, please check back later'}
                </p>
              </div>
            )}
            {activeTab === 'chats' && chats.map(chat => (
              <button
                key={chat.id}
                onClick={() => setSelectedChat(chat)}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-[28px] transition-all duration-500 group relative",
                  selectedChat?.id === chat.id ? "bg-primary/10" : "hover:bg-white/5"
                )}
              >
                <div className="relative shrink-0">
                  <div className="w-14 h-14 rounded-full border-2 border-transparent group-hover:border-primary/20 transition-all flex items-center justify-center text-primary font-bold text-lg overflow-hidden shadow-2xl" style={{ backgroundColor: chat.avatar_color || 'oklch(0.2 0.02 280)' }}>
                    {chat.avatar_url ? <img src={chat.avatar_url} className="w-full h-full object-cover" alt="" /> : safeChar(chat.display_name || chat.username)}
                  </div>
                  {onlineUsers.has(chat.id) && <div className="absolute bottom-0.5 right-0.5 w-4 h-4 bg-green-500 border-[3.5px] border-background rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]" />}
                </div>
                <div className="flex-1 text-left min-w-0">
                   <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm truncate group-hover:text-primary transition-colors">{chat.display_name || chat.username}</span>
                      <span className="text-[9px] font-mono text-white/20 uppercase tracking-tighter">{formatRelativeTime(chat.lastMessageTime || new Date().toISOString())}</span>
                   </div>
                   <p className="text-xs text-muted-foreground line-clamp-1 font-medium group-hover:text-white/60 transition-colors">{chat.lastMessage || `@${chat.username}`}</p>
                </div>
                {(chat.unreadCount ?? 0) > 0 && (
                  <div className="absolute top-4 right-4 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-[10px] font-bold text-primary-foreground shadow-lg shadow-primary/20 animate-in zoom-in duration-500">
                    {chat.unreadCount}
                  </div>
                )}
                {selectedChat?.id === chat.id && <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-primary rounded-r-full" />}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* --- 3. Main Communication Area --- */}
      <main className={cn(
        "flex-1 flex flex-col relative z-10 transition-all duration-700 ease-in-out bg-black/[0.02] min-h-0",
        isMobile && !selectedChat && (activeTab === 'chats' || activeTab === 'community' || activeTab === 'feed') ? "translate-x-full absolute inset-y-0 opacity-0 pointer-events-none" : "translate-x-0 opacity-100 relative"
      )}>

        {/* Terminal Header */}
        <header className="h-14 md:h-20 border-b border-white/5 flex items-center justify-between px-4 md:px-8 bg-black/10 backdrop-blur-3xl shrink-0" style={{ touchAction: "none" }}>
          <div className="flex items-center gap-6">
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
              <div className="flex items-center gap-4 group cursor-pointer" onClick={() => { setIsRightPanelOpen(!isRightPanelOpen); }}>
                 <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-primary font-bold text-sm shadow-xl" style={{ backgroundColor: selectedChat.avatar_color || 'oklch(0.2 0.02 280)' }}>
                    {selectedChat.avatar_url ? <img src={selectedChat.avatar_url} className="w-full h-full object-cover rounded-full" alt="" /> : (selectedChat.display_name?.[0] || 'U')}
                 </div>
                <div>
                  <div className="font-bold text-base">{selectedChat.display_name || selectedChat.username}</div>
                  <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest">@{selectedChat.username}</div>
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
             <Button variant="ghost" size="icon" className="rounded-2xl text-white/30 hover:text-white hover:bg-white/5 transition-all">
                <MoreVertical className="w-5 h-5" />
             </Button>
          </div>
        </header>

        {/* Messaging Core */}
        <div className="flex-1 min-h-0 px-3 md:px-12 py-3 md:py-8 overflow-y-auto overscroll-contain scrollbar-hide" ref={scrollRef}>
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
                 />
               );
            })}
          </div>
        </div>

        {/* Input Interface */}
        {selectedChat && (
          <footer className="p-3 md:p-10 shrink-0" style={{ touchAction: "none" }}>
             <div className="max-w-4xl mx-auto">
                <GlassPanel className="rounded-[32px] md:rounded-[40px] p-3 md:p-3 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)]">
                   <CornerBrackets />

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
                          placeholder={editingMessage ? "Edit message..." : "Node_Terminal_Ready..."}
                          value={newMessage}
                          onChange={(e) => {
                            setNewMessage(e.target.value);
                            e.target.style.height = 'auto';
                            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                          }}
                          className="w-full bg-transparent border-none py-3.5 px-2 text-base md:text-lg font-medium resize-none outline-none focus:ring-0 placeholder:text-white/10 leading-relaxed scrollbar-hide"
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isMobile) { e.preventDefault(); handleSendMessage(selectedChat, user!, newMessage); } }}
                        />
                      </div>

                      <button
                        onClick={() => handleSendMessage(selectedChat, user!, newMessage)}
                        disabled={!newMessage.trim()}
                        className={cn(
                          "w-11 h-11 md:w-14 md:h-14 rounded-[28px] md:rounded-[32px] flex items-center justify-center transition-all duration-700 relative group/send",
                          newMessage.trim() ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/30" : "bg-white/5 text-white/10"
                        )}
                      >
                         <Send className="w-6 h-6 group-hover/send:translate-x-1 group-hover/send:-translate-y-1 transition-transform duration-500" />
                         {newMessage.trim() && <div className="absolute inset-0 bg-primary blur-xl opacity-30 rounded-[32px]" />}
                      </button>
                   </div>
                </GlassPanel>
             </div>
          </footer>
        )}
      </main>

            {/* --- 4. Identity Info Panel (Right) --- */}
      {selectedChat && (
        <aside className={cn(
          "flex flex-col bg-black/95 backdrop-blur-3xl z-40 shrink-0 transition-all duration-500 ease-in-out",
          isMobile
            ? "fixed inset-0 w-full h-full"
            : "border-l border-white/5 relative w-96",
          isRightPanelOpen ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full pointer-events-none"
        )}>
          {isRightPanelOpen && (
            <div className="flex flex-col h-full">
              {/* Mobile header */}
              <div className="flex items-center gap-3 px-4 pt-4 pb-2 md:hidden shrink-0">
                <button
                  onClick={() => setIsRightPanelOpen(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white/40 hover:bg-white/5 hover:text-white transition-all"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <span className="text-sm font-mono text-white/30 uppercase tracking-widest">Profile</span>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
                <div className="relative">
                  {/* Background Banner */}
                  <div className="h-32 md:h-44 w-full bg-gradient-to-br from-purple-800/40 via-black/30 to-black/80 backdrop-blur-md relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(168,85,247,0.15),transparent_70%)]" />
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(88,101,242,0.1),transparent_60%)]" />
                  </div>

                  {/* Avatar - overlapping banner */}
                  <div className="flex justify-center -mt-14 md:-mt-18 relative z-10">
                    <div className="relative group">
                      <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-150" />
                      <Avatar className="w-24 h-24 md:w-28 md:h-28 rounded-[32px] md:rounded-[40px] border-4 border-background shadow-2xl relative z-10">
                        <AvatarImage src={selectedChat?.avatar_url} className="object-cover" />
                        <AvatarFallback className="bg-primary/10 text-primary text-3xl md:text-4xl font-display font-bold uppercase">{safeChar(selectedChat?.display_name || selectedChat?.username)}</AvatarFallback>
                      </Avatar>
                    </div>
                  </div>

                  {/* Name + @username */}
                  <div className="text-center mt-3 md:mt-5 space-y-1">
                    <h3 className="text-2xl md:text-3xl font-display font-bold tracking-tight">{selectedChat?.display_name || selectedChat?.username}</h3>
                    <div className="inline-flex items-center gap-2 text-[11px] md:text-xs font-mono text-white/40 uppercase tracking-widest">
                      <LinkIcon className="w-3 h-3" />
                      <span>@{selectedChat?.username}</span>
                    </div>
                  </div>

                {/* Bio / About */}
                <div className="mt-8 md:mt-10 px-4 md:px-6">
                  <h4 className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 mb-3">About</h4>
                  <p className="text-xs md:text-sm text-white/50 leading-relaxed">
                    {selectedChat?.bio || (language === 'ru'
                      ? 'Пользователь пока не добавил описание.'
                      : 'User hasn\'t added a bio yet.')}
                  </p>
                </div>

                {/* Collectible Gifts */}
                <div className="mt-8 md:mt-10 px-4 md:px-6">
                  <h4 className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 mb-4">Collectible Gifts</h4>
                  <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-hide -mx-4 md:-mx-6 px-4 md:px-6">
                    {[
                      { emoji: '💎', name: 'Diamond Pack', color: 'from-cyan-500/30 to-blue-600/30' },
                      { emoji: '🌊', name: 'Wave Surfer', color: 'from-blue-500/30 to-purple-600/30' },
                      { emoji: '🔥', name: 'Flame Soul', color: 'from-orange-500/30 to-red-600/30' },
                    ].map((gift, i) => (
                      <div key={i} className="shrink-0 w-28 md:w-32 p-3 rounded-xl border border-white/5 bg-white/[0.03] shadow-lg space-y-2">
                        <div className="text-3xl text-center">{gift.emoji}</div>
                        <p className="text-[9px] font-mono text-white/40 uppercase tracking-widest text-center">{gift.name}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Node Intelligence — compact */}
                <div className="mt-8 md:mt-10 px-4 md:px-6">
                  <h4 className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/20 mb-3">Node Intelligence</h4>
                  <div className="space-y-2">
                    {[
                      { icon: ShieldCheck, label: 'E2EE', status: 'Active' },
                      { icon: Wifi, label: 'Network', status: '12ms' },
                      { icon: Database, label: 'Vault', status: '5.2GB' },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between py-2.5 px-4 rounded-2xl bg-white/[0.02] border border-white/5">
                        <div className="flex items-center gap-2.5">
                          <item.icon className="w-3.5 h-3.5 text-primary/60" />
                          <span className="text-[11px] font-bold text-white/40">{item.label}</span>
                        </div>
                        <span className="text-[10px] font-mono text-white/30 uppercase">{item.status}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="mt-8 md:mt-10 px-4 md:px-6 pb-6 md:pb-8 space-y-3">
                   <Button variant="outline" className="w-full h-12 md:h-14 rounded-[24px] md:rounded-[28px] border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/10 font-bold group text-xs md:text-sm">
                      <Bell className="w-4 h-4 md:w-5 md:h-5 mr-3 text-white/20 group-hover:text-primary transition-colors" />
                      Mute Notifications
                   </Button>
                   <Button variant="outline" className="w-full h-12 md:h-14 rounded-[24px] md:rounded-[28px] border-white/5 bg-white/5 hover:bg-destructive/10 hover:border-destructive/20 hover:text-destructive font-bold group text-xs md:text-sm">
                      <Trash2 className="w-4 h-4 md:w-5 md:h-5 mr-3 text-white/20 group-hover:text-destructive transition-colors" />
                      Clear History
                   </Button>
                </div>
              </div>
            </div>
            </div>
          )}
        </aside>
      )}

      {/* --- Settings Modal --- */}
      {isSettingsOpen && (
        <SettingsModal user={user} accounts={accounts} onClose={() => setIsSettingsOpen(false)} isQuarantined={isQuarantined} />
      )}
      {/* --- Mobile Hotbar --- */}      {/* --- Mobile Hotbar --- */}
      {isMobile && !selectedChat && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-2xl border-t border-white/5" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex items-center justify-around h-14">
            {[
              { id: 'community' as const, icon: Users, label: 'Community' },
              { id: 'chats' as const, icon: MessageSquare, label: 'Chats' },
              { id: 'feed' as const, icon: Compass, label: 'Feed' },
              { id: 'settings' as const, icon: Settings, label: 'Settings' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'settings') {
                    setIsSettingsOpen(true);
                  } else {
                    setActiveTab(tab.id);
                    setSelectedChat(null);
                  }
                }}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-all',
                  tab.id === 'settings'
                    ? 'text-white/30'
                    : activeTab === tab.id ? 'text-primary' : 'text-white/30'
                )}
              >
                <tab.icon className='w-5 h-5' />
                <span className='text-[8px] font-mono uppercase tracking-wider'>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Global CSS for advanced micro-interactions */}
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
        @supports (padding: env(safe-area-inset-top)) {
          body {
            padding-top: env(safe-area-inset-top);
            padding-bottom: env(safe-area-inset-bottom);
          }
        }
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