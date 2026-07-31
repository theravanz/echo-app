"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  TbSearch as Search,
  TbPlus as Plus,
  TbDotsVertical as MoreVertical,
  TbArrowLeft as ArrowLeft,
  TbChevronDown as ChevronDown,
  TbRefresh as RefreshCw,
  TbBoltOff as ZapOff,
  TbWifi as Wifi,
  TbClock as Clock,
  TbGhost as Ghost,
} from "react-icons/tb";
import { cn, safeChar, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import type { Chat, UserProfile, AppTab, ConnectionStatus, NetworkMode } from "@/hooks/echo/types";

interface ChatSidebarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  connectionStatus: ConnectionStatus;
  activeMode: NetworkMode;
  chats: Chat[];
  selectedChat: Chat | null;
  onlineUsers: Set<string>;
  searchOpen: boolean;
  searchQuery: string;
  searchResults: UserProfile[];
  isSearching: boolean;
  isSearchFocused: boolean;
  recentSearches: UserProfile[];
  onSearchOpen: (v: boolean) => void;
  onSearch: (q: string) => void;
  onSearchFocus: (v: boolean) => void;
  onStartChat: (profile: UserProfile) => void;
  onSelectChat: (chat: Chat) => void;
  onOpenSettings: () => void;
}

export function ChatSidebar({
  activeTab, setActiveTab,
  connectionStatus, activeMode,
  chats, selectedChat, onlineUsers,
  searchOpen, searchQuery, searchResults, isSearching, isSearchFocused, recentSearches,
  onSearchOpen, onSearch, onSearchFocus, onStartChat, onSelectChat,
  onOpenSettings,
}: ChatSidebarProps) {
  const connectionIcon = () => {
    switch (connectionStatus) {
      case 'connected': return <Wifi className="w-5 h-5 text-primary" />;
      case 'connecting': return <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin" />;
      case 'disconnected': return <ZapOff className="w-5 h-5 text-destructive" />;
    }
  };

  const connectionLabel = () => {
    switch (connectionStatus) {
      case 'connected': return <span className="font-display font-bold text-2xl tracking-tight group-hover:text-primary transition-colors">Chats</span>;
      case 'connecting': return <span className="font-display font-bold text-2xl tracking-tight text-muted-foreground">Connecting</span>;
      case 'disconnected': return <span className="font-display font-bold text-2xl tracking-tight text-destructive">Offline</span>;
    }
  };

  const modeStyles = (mode: NetworkMode) => {
    switch (mode) {
      case 'direct': return { dot: 'bg-primary', label: 'Mesh Direct' };
      case 'relay': return { dot: 'bg-amber-500', label: 'Relay Node' };
      default: return { dot: 'bg-blue-500', label: 'Global Net' };
    }
  };

  return (
    <aside className="w-full md:w-[360px] border-r border-border flex flex-col bg-background backdrop-blur-2xl z-20 shrink-0 transition-all duration-700 ease-in-out h-full safe-top">
      <div className="h-16 md:h-20 px-4 md:px-6 pt-2 md:pt-0 flex items-center justify-between shrink-0">
        {activeTab === 'chats' ? (
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 group">
                  {connectionIcon()}
                  {connectionLabel()}
                  <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52 rounded-2xl border-border bg-background/95 backdrop-blur-3xl p-2">
                <DropdownMenuLabel className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground px-3 py-2">Network Mode</DropdownMenuLabel>
                {(['direct', 'relay', 'normal'] as NetworkMode[]).map(m => (
                  <DropdownMenuItem key={m} className="rounded-xl gap-3 py-3 px-3 cursor-pointer">
                    <div className={cn("w-2 h-2 rounded-full shrink-0", modeStyles(m).dot)} />
                    <div>
                      <div className="text-sm font-bold">{modeStyles(m).label}</div>
                      <div className="text-[10px] text-muted-foreground font-medium">
                        {m === 'direct' ? 'Default' : m === 'relay' ? 'P2P Relay' : 'Mesh Net'}
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
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
          <Button variant="ghost" size="icon" className="rounded-2xl w-10 h-10 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all" onClick={() => onSearchOpen(true)}>
            <Search className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Search Overlay */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 bg-background/95 backdrop-blur-2xl rounded-3xl overflow-hidden safe-top border border-border">
            <div className="flex flex-col h-full">
              <div className="px-4 pt-4 pb-2 space-y-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => onSearchOpen(false)} className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className="flex-1 relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input autoFocus value={searchQuery} onChange={(e) => onSearch(e.target.value)} onFocus={() => onSearchFocus(true)}
                      placeholder="Search contacts, messages..."
                      className="relative w-full h-10 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/40 transition-all" />
                  </div>
                </div>
                <div className="max-h-[calc(100vh-200px)] overflow-y-auto scrollbar-hide space-y-1">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-8"><RefreshCw className="w-5 h-5 text-primary animate-spin" /></div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map(profile => (
                      <button key={profile.id} onClick={() => onStartChat(profile)} className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-primary/5 transition-all group">
                        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm overflow-hidden shrink-0">
                          {profile.avatar_url ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" /> : safeChar(profile.display_name || profile.username)}
                        </div>
                        <div className="text-left min-w-0">
                          <div className="text-sm font-bold truncate text-foreground">{profile.display_name || profile.username}</div>
                          <div className="text-[10px] text-muted-foreground/70 font-mono">@{profile.username}</div>
                        </div>
                        <Plus className="w-4 h-4 text-primary/20 ml-auto shrink-0" />
                      </button>
                    ))
                  ) : searchQuery ? (
                    <div className="text-center py-8 text-muted-foreground/80 text-sm">No users found</div>
                  ) : null}
                  {!searchQuery && recentSearches.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-3 py-3"><Clock className="w-3.5 h-3.5 text-muted-foreground/60" /><span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">Recent</span></div>
                      {recentSearches.map(profile => (
                        <button key={profile.id} onClick={() => onStartChat(profile)} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-primary/5 transition-all">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold shrink-0">{safeChar(profile.display_name || profile.username)}</div>
                          <span className="text-sm truncate text-foreground">{profile.display_name || profile.username}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {!searchQuery && recentSearches.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40">
                      <Search className="w-8 h-8 mb-3" /><span className="text-xs font-mono uppercase tracking-widest">Search users</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide p-2 md:p-3 space-y-1">
        {chats.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <Ghost className="w-12 h-12 text-muted-foreground/20 mb-4" />
            <div className="text-sm text-muted-foreground/60 font-medium">No conversations yet</div>
            <div className="text-xs text-muted-foreground/40 mt-1">Search for users to start chatting</div>
          </div>
        )}
        {chats.map(chat => (
          <button key={chat.id} onClick={() => onSelectChat(chat)}
            className={cn("w-full flex items-center gap-4 p-3 md:p-4 rounded-2xl transition-all duration-500 relative group", selectedChat?.id === chat.id ? "bg-primary/10" : "hover:bg-accent/40")}>
            <div className="relative shrink-0">
              <div className="w-14 h-14 rounded-full border-2 border-transparent group-hover:border-primary/20 transition-all flex items-center justify-center text-primary font-bold text-lg overflow-hidden shadow-2xl"
                style={{ backgroundColor: chat.avatar_color || 'oklch(0.2 0.02 280)' }}>
                {chat.avatar_url ? <img src={chat.avatar_url} className="w-full h-full object-cover" alt="" /> : safeChar(chat.display_name || chat.username)}
              </div>
              {onlineUsers.has(chat.id) && <div className="absolute bottom-0.5 right-0.5 w-4 h-4 bg-green-500 border-[3.5px] border-background rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]" />}
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-sm truncate group-hover:text-primary transition-colors">{chat.display_name || chat.username}</span>
                <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-tighter">{formatRelativeTime(chat.lastMessageTime || new Date().toISOString())}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1 font-medium">{chat.lastMessage || `@${chat.username}`}</p>
            </div>
            {(chat.unreadCount ?? 0) > 0 && (
              <div className="absolute top-4 right-4 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-[10px] font-bold text-primary-foreground shadow-lg shadow-primary/20">{chat.unreadCount}</div>
            )}
            {selectedChat?.id === chat.id && <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-primary rounded-r-full" />}
          </button>
        ))}
      </div>
    </aside>
  );
}
