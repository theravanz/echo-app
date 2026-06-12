"use client";

import { useState, useEffect, useRef, memo, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import { 
  Search, Plus, Settings, MoreVertical, Send, Paperclip, Shield, Share2, 
  Cpu, Signal, User, Check, CheckCheck, ArrowLeft, Lock, Trash2, 
  Reply, Edit, Copy, ExternalLink, Globe, Wifi, Trophy, ChevronDown, 
  ChevronUp, ChevronLeft, ChevronRight, Pen, EyeOff, Bold, Italic, 
  Code, Smile, Smartphone, Moon, ShoppingBag, Rss, Home, UserPlus, Star, LogOut,
  Zap, Layers, Database, X, Heart, MessageSquare, Repeat2, Info, Compass, 
  Hash, Bell, Volume2, ShieldCheck, HardDrive, Palette, Key, Megaphone, Users,
  Fingerprint, Sparkles, RefreshCw, AlertTriangle, Image as ImageIcon, Gift,
  Filter, Ghost, ZapOff, Link as LinkIcon
} from "lucide-react";
import { cn, safeChar, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { useEchoApp } from "@/hooks/echo/use-echo-app";
import { useE2EE } from "@/hooks/echo/use-e2ee";
import { MessageBubble } from "@/components/echo/app/message-bubble";
import { MediaPicker } from "@/components/echo/app/media-picker";

// --- Types & Constants ---

type NetworkMode = 'direct' | 'relay' | 'normal';
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
  
  // App State
  const [appLoading, setAppLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Establishing Secure Node...");
  const [activeTab, setActiveTab] = useState<'chats' | 'feed' | 'market'>('chats');
  const [activeMode, setActiveMode] = useState<NetworkMode>('direct');
  const [user, setUser] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isQuarantined, setIsQuarantined] = useState(false);
  const [quarantineTime, setQuarantineTime] = useState("");
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const [editingMessage, setEditingMessage] = useState<any | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef<any>(null);
  const selectedChatRef = useRef<any>(null);

  const { chats, setChats, onlineUsers, lastSeenMap, fetchChats, drafts, saveDraft } = useEchoApp(user);
  const { encryptMessage, decryptMessage } = useE2EE(chats);

  // --- Ported Logic ---

  useEffect(() => {
    if (selectedChat?.id) {
      setNewMessage(drafts[selectedChat.id] || "");
    }
  }, [selectedChat?.id]);

  useEffect(() => {
    if (selectedChat?.id && newMessage !== (drafts[selectedChat.id] || "")) {
      const timeout = setTimeout(() => saveDraft(selectedChat.id, newMessage), 500);
      return () => clearTimeout(timeout);
    }
  }, [newMessage, selectedChat?.id]);

  const fetchMessages = async (chatId: string, currentUserId: string) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${chatId}),and(sender_id.eq.${chatId},receiver_id.eq.${currentUserId})`)
        .order('created_at', { ascending: true });

      if (error) throw error;
      const processed = await Promise.all((data || []).map(async (m) => {
        if (!m) return null;
        const otherId = m.sender_id === currentUserId ? m.receiver_id : m.sender_id;
        return { ...m, content: await decryptMessage(m.content || '', m.nonce || '', otherId) };
      }));
      setMessages(processed.filter((msg): msg is any => msg !== null));
      
      const unreadIds = (data || []).filter(m => m.receiver_id === currentUserId && m.status !== 'read').map(m => m.id);
      if (unreadIds.length > 0) {
        await supabase.from('messages').update({ status: 'read', read_at: new Date().toISOString() }).in('id', unreadIds);
      }
    } catch (err) { console.error('Fetch messages error:', err); }
  };

  const handleSendMessage = async (type: 'text' | 'sticker' | 'gif' = 'text', customContent?: string) => {
    const text = customContent || newMessage.trim();
    if (!text || !selectedChat || !user || isSending) return;
    
    if (editingMessage && type === 'text') {
      const encrypted = await encryptMessage(text, selectedChat.id);
      if (!encrypted) return;
      try {
        await supabase.from('messages').update({
          content: encrypted.content,
          nonce: encrypted.nonce,
          is_edited: true
        }).eq('id', editingMessage.id);
        setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, content: text, is_edited: true } : m));
        setEditingMessage(null);
        setNewMessage("");
      } catch (err) { toast.error("Failed to edit message"); }
      return;
    }

    setNewMessage("");
    setIsSending(true);

    const encrypted = await encryptMessage(text, selectedChat.id);
    if (!encrypted) { toast.error("E2EE Key Error"); setIsSending(false); return; }

    try {
      const { data, error } = await supabase.from('messages').insert({
        sender_id: user.id,
        receiver_id: selectedChat.id,
        content: encrypted.content,
        nonce: encrypted.nonce,
        type: type,
        status: 'sent',
        reply_to_id: replyingTo?.id || null
      }).select().single();

      if (error) throw error;
      setMessages(prev => [...prev, { ...data, content: text, reply_to: replyingTo }]);
      setReplyingTo(null);
    } catch (err) { toast.error("Failed to send message"); }
    finally { setIsSending(false); }
  };

  // --- Effects ---

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/auth'); return; }

      const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      const userData = { ...session.user, user_metadata: { ...session.user.user_metadata, ...(profile || {}) } };
      
      setUser(userData);
      userRef.current = userData;
      
      // Sync accounts
      const saved = JSON.parse(localStorage.getItem('echo_accounts') || '[]');
      setAccounts(saved);

      // Check quarantine
      const hwid = localStorage.getItem('echo_device_hwid');
      const { data: device } = await supabase.from('devices').select('*').eq('user_id', userData.id).eq('hwid', hwid).maybeSingle();
      if (device) {
        const created = new Date(device.created_at).getTime();
        const diff = (new Date().getTime() - created) / (1000 * 60 * 60);
        if (diff < QUARANTINE_HOURS) {
          setIsQuarantined(true);
          const target = created + (QUARANTINE_HOURS * 60 * 60 * 1000);
          const interval = setInterval(() => {
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

      await fetchChats(userData.id);
      
      // Setup presence
      const presence = supabase.channel('online-presence', { config: { presence: { key: userData.id } } });
      presence.on('presence', { event: 'sync' }, () => {
        setOnlineUsers(new Set(Object.keys(presence.presenceState())));
      }).subscribe(async (s) => {
        if (s === 'SUBSCRIBED') await presence.track({ online_at: new Date().toISOString() });
      });

      // Global messages listener
      const msgChannel = supabase.channel('global-msgs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const nm = payload.new as any;
        if (nm.receiver_id === userData.id || nm.sender_id === userData.id) {
          fetchChats(userData.id);
          if (selectedChatRef.current && (nm.sender_id === selectedChatRef.current.id || nm.receiver_id === selectedChatRef.current.id)) {
            const dec = await decryptMessage(nm.content, nm.nonce, nm.sender_id === userData.id ? nm.receiver_id : nm.sender_id);
            setMessages(prev => [...prev, { ...nm, content: dec }]);
          }
        }
      }).subscribe();

      setAppLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (selectedChat && user) {
      selectedChatRef.current = selectedChat;
      fetchMessages(selectedChat.id, user.id);
    }
  }, [selectedChat?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages, selectedChat]);

  if (appLoading) return (
    <div className="h-svh bg-background flex flex-col items-center justify-center noise-overlay">
       <div className="relative w-24 h-24 mb-12">
          <div className="absolute inset-0 border-4 border-primary/10 rounded-full" />
          <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(var(--primary),0.3)]" />
          <Shield className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-primary/40" />
       </div>
       <img src="/logo-full.svg" alt="Echo" className="h-6 mb-4 animate-pulse" />
       <div className="text-[10px] font-mono text-primary uppercase tracking-[0.5em] animate-pulse">{loadingStatus}</div>
    </div>
  );

  return (
    <div className="flex h-svh bg-background text-foreground overflow-hidden selection:bg-primary/30 antialiased relative noise-overlay">
      
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
              { id: 'chats', icon: MessageSquare, label: 'Messages' },
              { id: 'feed', icon: Compass, label: 'Feed' },
              { id: 'market', icon: ShoppingBag, label: 'Market' }
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
        isMobile && (selectedChat || activeTab !== 'chats') ? "-translate-x-full absolute opacity-0" : "opacity-100 translate-x-0 relative"
      )}>
        <div className="h-20 px-6 flex items-center justify-between shrink-0">
          <h2 className="font-display font-bold text-2xl tracking-tight">
            {activeTab === 'chats' && 'Identity'}
            {activeTab === 'feed' && 'Discovery'}
            {activeTab === 'market' && 'Terminal'}
          </h2>
          <Button variant="ghost" size="icon" className="rounded-2xl text-white/20 hover:text-primary hover:bg-primary/5 transition-all">
            <Filter className="w-5 h-5" />
          </Button>
        </div>

        <div className="px-6 mb-6 shrink-0">
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-primary/20 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-primary transition-colors" />
            <Input 
              placeholder="Search Mesh..." 
              className="relative h-12 bg-white/5 border-white/5 rounded-2xl pl-12 text-sm focus:bg-white/[0.08] placeholder:text-white/20"
            />
          </div>
        </div>

        {isQuarantined && (
          <div className="mx-6 mb-6 p-4 rounded-[24px] bg-amber-500/5 border border-amber-500/10 flex gap-4 animate-in fade-in slide-in-from-top-4 duration-700">
             <Shield className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
             <div>
                <div className="text-[10px] font-mono text-amber-500 uppercase tracking-widest font-bold mb-1">New Node Protection</div>
                <div className="text-xs text-amber-500/60 leading-relaxed font-medium">Node features restricted for <span className="text-amber-500 font-bold">{quarantineTime}</span></div>
             </div>
          </div>
        )}

        <ScrollArea className="flex-1 px-4">
          <div className="space-y-1 pb-8">
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
                      <span className="text-[9px] font-mono text-white/20 uppercase tracking-tighter">{formatRelativeTime(chat.lastMessageTime)}</span>
                   </div>
                   <p className="text-xs text-muted-foreground truncate font-medium group-hover:text-white/60 transition-colors">{chat.lastMessage || `@${chat.username}`}</p>
                </div>
                {chat.unreadCount > 0 && (
                  <div className="absolute top-4 right-4 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-[10px] font-bold text-primary-foreground shadow-lg shadow-primary/20 animate-in zoom-in duration-500">
                    {chat.unreadCount}
                  </div>
                )}
                {selectedChat?.id === chat.id && <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-primary rounded-r-full" />}
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      {/* --- 3. Main Communication Area --- */}
      <main className={cn(
        "flex-1 flex flex-col relative z-10 transition-all duration-700 ease-in-out bg-black/[0.02]",
        isMobile && !selectedChat && activeTab === 'chats' ? "translate-x-full absolute opacity-0" : "translate-x-0 opacity-100 relative"
      )}>
        
        {/* Terminal Header */}
        <header className="h-20 border-b border-white/5 flex items-center justify-between px-6 md:px-8 bg-black/10 backdrop-blur-3xl shrink-0">
          <div className="flex items-center gap-6">
            {isMobile && selectedChat && (
              <Button variant="ghost" size="icon" className="rounded-2xl text-white/40" onClick={() => setSelectedChat(null)}>
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
              <div className="flex items-center gap-4 group cursor-pointer" onClick={() => setIsRightPanelOpen(true)}>
                 <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-primary font-bold text-sm shadow-xl" style={{ backgroundColor: selectedChat.avatar_color || 'oklch(0.2 0.02 280)' }}>
                    {selectedChat.avatar_url ? <img src={selectedChat.avatar_url} className="w-full h-full object-cover rounded-full" alt="" /> : (selectedChat.display_name?.[0] || 'U')}
                 </div>
                 <div>
                    <div className="flex items-center gap-2">
                       <span className="font-bold text-base">{selectedChat.display_name || selectedChat.username}</span>
                       <ShieldCheck className="w-4 h-4 text-primary animate-pulse" />
                    </div>
                    <div className="flex items-center gap-2">
                       <span className="text-[9px] font-mono text-green-500 uppercase tracking-widest">E2EE Tunnel Active</span>
                       <div className="w-1 h-1 bg-white/20 rounded-full" />
                       <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">@{selectedChat.username}</span>
                    </div>
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
        <ScrollArea className="flex-1 px-6 md:px-12 py-8" ref={scrollRef}>
          <div className="max-w-4xl mx-auto space-y-12">
            
            {!selectedChat && (
              <div className="h-[60svh] flex flex-col items-center justify-center text-center space-y-8 animate-in fade-in zoom-in duration-1000">
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
        </ScrollArea>

        {/* Input Interface */}
        {selectedChat && (
          <footer className="p-6 md:p-10 shrink-0">
             <div className="max-w-4xl mx-auto">
                <GlassPanel className="rounded-[40px] p-2 md:p-3 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)]">
                   <CornerBrackets />
                   
                   {replyingTo && (
                     <div className="px-4 py-2 bg-black/20 border-b border-white/5 flex items-center justify-between animate-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center gap-3 overflow-hidden">
                           <Reply className="w-4 h-4 text-primary shrink-0" />
                           <div className="text-xs truncate">
                              <div className="font-bold">{replyingTo.sender_id === user.id ? 'You' : (selectedChat.display_name || selectedChat.username)}</div>
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
                         <Button variant="ghost" size="icon" className="w-12 h-12 rounded-[28px] text-white/20 hover:text-primary hover:bg-primary/5 transition-all">
                           <Paperclip className="w-5 h-5" />
                         </Button>
                         <Popover>
                            <PopoverTrigger asChild>
                               <Button variant="ghost" size="icon" className="w-12 h-12 rounded-[28px] text-white/20 hover:text-primary hover:bg-primary/5 transition-all">
                                 <Smile className="w-5 h-5" />
                               </Button>
                            </PopoverTrigger>
                            <PopoverContent side="top" align="start" className="p-0 border-none bg-transparent shadow-none">
                               <MediaPicker 
                                  onEmojiSelect={(emoji) => setNewMessage(prev => prev + emoji)}
                                  onStickerSelect={(url) => handleSendMessage('sticker', url)}
                                  onGifSelect={(url) => handleSendMessage('gif', url)}
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
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isMobile) { e.preventDefault(); handleSendMessage(); } }}
                        />
                      </div>

                      <button 
                        onClick={() => handleSendMessage()}
                        disabled={!newMessage.trim() || isSending}
                        className={cn(
                          "w-14 h-14 rounded-[32px] flex items-center justify-center transition-all duration-700 relative group/send",
                          newMessage.trim() ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/30" : "bg-white/5 text-white/10"
                        )}
                      >
                         {isSending ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6 group-hover/send:translate-x-1 group-hover/send:-translate-y-1 transition-transform duration-500" />}
                         {newMessage.trim() && <div className="absolute inset-0 bg-primary blur-xl opacity-30 rounded-[32px]" />}
                      </button>
                   </div>
                </GlassPanel>

                <div className="flex items-center justify-between mt-6 px-4">
                   <div className="flex gap-6">
                      <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.2em] text-white/20 hover:text-white/40 cursor-help transition-colors">
                         <Ghost className="w-3 h-3" />
                         <span>Stealth Mode: Off</span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.2em] text-white/20 hover:text-white/40 cursor-help transition-colors">
                         <Zap className="w-3 h-3 text-primary" />
                         <span>Reality_V2 active</span>
                      </div>
                   </div>
                   <div className="hidden md:flex gap-1.5 opacity-20">
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                   </div>
                </div>
             </div>
          </footer>
        )}
      </main>

      {/* --- 4. Identity Info Panel (Right) --- */}
      {!isMobile && (
        <aside className={cn(
          "border-l border-white/5 flex flex-col bg-black/10 backdrop-blur-3xl z-30 shrink-0 transition-all duration-700 ease-in-out relative",
          isRightPanelOpen ? "w-96 opacity-100" : "w-0 opacity-0 pointer-events-none"
        )}>
          {isRightPanelOpen && (
            <ScrollArea className="flex-1">
              <div className="p-10 space-y-12">
                <div className="flex justify-end">
                   <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/5" onClick={() => setIsRightPanelOpen(false)}><X className="w-5 h-5" /></Button>
                </div>

                {/* Profile Identity Card */}
                <div className="text-center space-y-6">
                   <div className="relative inline-flex items-center justify-center group">
                      <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-150 group-hover:scale-175 transition-transform duration-1000" />
                      <Avatar className="w-32 h-32 rounded-[48px] border border-white/10 shadow-2xl relative z-10">
                         <AvatarImage src={selectedChat?.avatar_url} className="object-cover" />
                         <AvatarFallback className="bg-primary/10 text-primary text-4xl font-display font-bold uppercase">{safeChar(selectedChat?.display_name || selectedChat?.username)}</AvatarFallback>
                      </Avatar>
                   </div>
                   <div>
                      <h3 className="text-3xl font-display font-bold tracking-tight mb-2">{selectedChat?.display_name || selectedChat?.username}</h3>
                      <div className="inline-flex items-center gap-2 text-xs font-mono text-white/40 uppercase tracking-widest">
                         <LinkIcon className="w-3 h-3" />
                         <span>@{selectedChat?.username}</span>
                      </div>
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <GlassPanel className="p-5 rounded-[28px]">
                      <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/20 mb-2">Trust Score</div>
                      <div className="text-xl font-bold text-primary flex items-center gap-2">98.4<Trophy className="w-4 h-4" /></div>
                   </GlassPanel>
                   <GlassPanel className="p-5 rounded-[28px]">
                      <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/20 mb-2">Uptime</div>
                      <div className="text-xl font-bold text-green-500 flex items-center gap-2">100%<Wifi className="w-4 h-4" /></div>
                   </GlassPanel>
                </div>

                <div className="space-y-6">
                   <h4 className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 px-2">Node Intelligence</h4>
                   <div className="space-y-3">
                      {[
                        { icon: ShieldCheck, label: 'E2EE X25519', status: 'Active' },
                        { icon: Share2, label: 'Onion Hops', status: '3 Hops' },
                        { icon: Database, label: 'Vault Storage', status: '5.2GB' },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-4 rounded-[24px] bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-all">
                           <div className="flex items-center gap-3">
                              <item.icon className="w-4 h-4 text-primary" />
                              <span className="text-xs font-bold text-white/60">{item.label}</span>
                           </div>
                           <span className="text-[10px] font-mono text-white/30 uppercase">{item.status}</span>
                        </div>
                      ))}
                   </div>
                </div>

                <div className="space-y-4 pt-4">
                   <Button variant="outline" className="w-full h-14 rounded-[28px] border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/10 font-bold group">
                      <Bell className="w-5 h-5 mr-3 text-white/20 group-hover:text-primary transition-colors" />
                      Mute Notifications
                   </Button>
                   <Button variant="outline" className="w-full h-14 rounded-[28px] border-white/5 bg-white/5 hover:bg-destructive/10 hover:border-destructive/20 hover:text-destructive font-bold group">
                      <Trash2 className="w-5 h-5 mr-3 text-white/20 group-hover:text-destructive transition-colors" />
                      Clear History
                   </Button>
                </div>
              </div>
            </ScrollArea>
          )}
        </aside>
      )}

      {/* --- Settings Dialog --- */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-w-3xl bg-background/95 border-white/10 backdrop-blur-3xl rounded-[48px] p-0 overflow-hidden shadow-2xl noise-overlay">
           <div className="flex h-[640px]">
              <aside className="w-56 border-r border-white/5 bg-black/20 p-8 space-y-1 hidden sm:block">
                 <div className="text-[9px] font-mono text-white/20 uppercase tracking-[0.4em] mb-6">Core System</div>
                 <div className="space-y-4">
                    {[
                      { icon: User, label: 'Identity', active: true },
                      { icon: ShieldCheck, label: 'Security' },
                      { icon: Bell, label: 'Alerts' },
                      { icon: Palette, label: 'Interface' },
                      { icon: Wifi, label: 'Network' },
                      { icon: HardDrive, label: 'Storage' },
                    ].map(item => (
                      <button key={item.label} className={cn("w-full flex items-center gap-4 py-3 px-4 rounded-2xl transition-all", item.active ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20 font-bold" : "text-white/40 hover:text-white hover:bg-white/5")}>
                        <item.icon className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-widest tracking-tighter">{item.label}</span>
                      </button>
                    ))}
                 </div>
              </aside>
              
              <div className="flex-1 p-12 overflow-y-auto">
                 <div className="flex items-center justify-between mb-12">
                    <div>
                       <h2 className="text-3xl font-display font-bold tracking-tight mb-2">Settings</h2>
                       <p className="text-muted-foreground text-xs font-mono uppercase tracking-widest">Protocol_Version: 2.4.0-Alpha</p>
                    </div>
                    <Button variant="ghost" size="icon" className="rounded-2xl" onClick={() => setIsSettingsOpen(false)}><X className="w-6 h-6" /></Button>
                 </div>
                 
                 <div className="space-y-12">
                    <section className="space-y-6">
                       <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">Node Integrity</h4>
                       <GlassPanel className="p-8 rounded-[36px]">
                          <CornerBrackets />
                          <div className="flex items-center gap-6">
                             <div className="w-20 h-20 rounded-[32px] bg-primary flex items-center justify-center text-primary-foreground font-display text-4xl font-bold shadow-2xl shadow-primary/30">D</div>
                             <div className="flex-1">
                                <div className="text-xl font-bold mb-1">Echo Node</div>
                                <div className="text-xs text-white/40 font-mono tracking-widest">UID: {(user?.id || "").substring(0, 16)}...</div>
                                <Button size="sm" variant="outline" className="mt-4 rounded-xl border-white/10 hover:bg-white/5 h-8 text-[10px] uppercase tracking-widest">Export Identity</Button>
                             </div>
                          </div>
                       </GlassPanel>
                    </section>
                    
                    <section className="space-y-6">
                       <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">Multi-Account Bridge</h4>
                       <div className="space-y-3">
                          {accounts.map(acc => (
                            <div key={acc.uid} className={cn("flex items-center justify-between p-5 rounded-[28px] border transition-all duration-500", acc.uid === user?.id ? "bg-primary/10 border-primary/20 shadow-xl" : "bg-white/[0.02] border-white/5 opacity-40 hover:opacity-100")}>
                               <div className="flex items-center gap-4">
                                 <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-sm font-bold">{safeChar(acc.displayName || acc.email)}</div>
                                 <div>
                                    <div className="text-sm font-bold">{acc.displayName || acc.email}</div>
                                    <div className="text-[10px] text-white/30 font-mono">@{acc.username || (acc.uid ? acc.uid.substring(0, 8) : "node")}</div>
                                 </div>
                               </div>
                               {acc.uid === user?.id ? <ShieldCheck className="w-5 h-5 text-primary animate-pulse" /> : <div className="w-5 h-5" />}
                            </div>
                          ))}
                          <Button variant="outline" className="w-full rounded-[28px] border-dashed border-white/10 hover:border-primary/40 hover:bg-primary/5 h-16 text-xs uppercase tracking-widest font-bold">
                             <UserPlus className="w-5 h-5 mr-3" /> Connect New Node
                          </Button>
                       </div>
                    </section>

                    <section className="space-y-6 pb-12">
                       <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">Advanced Protocol</h4>
                       <div className="p-6 bg-destructive/5 border border-destructive/10 rounded-[32px] flex gap-5 group hover:bg-destructive/10 transition-all duration-500">
                          <div className="w-12 h-12 bg-destructive/20 rounded-[20px] flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform"><AlertTriangle className="w-6 h-6 text-destructive" /></div>
                          <div className="space-y-2">
                             <div className="text-sm font-bold text-destructive uppercase tracking-widest">Master Termination</div>
                             <p className="text-xs text-destructive-foreground/60 leading-relaxed font-medium">This will permanently purge your local node identity and revoke all E2EE session keys. This action cannot be reversed.</p>
                             <Button size="sm" variant="destructive" className="mt-2 rounded-xl h-10 px-6 font-bold uppercase tracking-widest text-[10px] active:scale-95 transition-all">Execute Purge</Button>
                          </div>
                       </div>
                    </section>
                 </div>
              </div>
           </div>
        </DialogContent>
      </Dialog>

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
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
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
      `}</style>
    </div>
  );
}

export default function EchoApp() {
  return (
    <Suspense fallback={
      <div className="h-svh bg-background flex items-center justify-center noise-overlay">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    }>
      <EchoAppContent />
    </Suspense>
  );
}
