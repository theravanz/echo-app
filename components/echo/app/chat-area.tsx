"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatRelativeTime } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useContactAccentColor } from "@/hooks/echo/use-contact-accent";
import { useProfileDetails } from "@/hooks/echo/use-profile-details";
import { ChatWallpaper, type WallpaperPreset } from "@/components/echo/app/chat-wallpaper";
import { ChatBackgroundPicker } from "@/components/echo/app/chat-background-picker";
import { ProfileViewPanel } from "@/components/echo/app/profile-view-panel";
import { MessageBubble, type UploadUiState } from "@/components/echo/app/message-bubble";
import {
  encryptAndUploadFile,
  parseFileMeta,
  openFileMessage,
  keyUserFor,
  MAX_FILE_BYTES,
  type FileUploadHandle,
} from "@/lib/files";
import { MessageContextMenu, type ContextMenuTarget } from "@/components/echo/app/message-context-menu";
import { ChatInput } from "@/components/echo/app/chat-input";
import { ChatHeader } from "@/components/echo/app/chat-header";
import { MediaPicker } from "@/components/echo/app/media-picker";
import {
  TbX as X,
  TbFingerprint as Fingerprint,
  TbLock as Lock,
} from "react-icons/tb";
import type { UserProfile, Chat, Message, NetworkMode, AppTab } from "@/hooks/echo/types";
import { deleteMessageMedia } from "@/lib/files";
import { TbFileUpload } from "react-icons/tb";
import { useFileDragDrop } from "@/hooks/echo/use-file-dragdrop";
import { registerNavLayer } from "@/lib/back-nav";


interface ChatAreaProps {
  user: UserProfile | null;
  selectedChat: Chat | null;
  isMobile: boolean;
  activeMode: NetworkMode;
  activeTab: AppTab;
  onlineUsers: Set<string>;
  chats: Chat[];
  onBack: () => void;
  onCall: (withVideo: boolean) => void;
  onMentionClick: (username: string) => void;

  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  replyingTo: Message | null;
  setReplyingTo: (msg: any) => void;
  editingMessage: Message | null;
  setEditingMessage: (msg: any) => void;
  newMessage: string;
  setNewMessage: React.Dispatch<React.SetStateAction<string>>;
  fetchMessages: (chatId: string, userId: string) => void;
  handleSendMessage: (chat: Chat, user: UserProfile, content: string) => void;
  handleSendVoice: (chat: Chat, user: UserProfile, blob: Blob, durationSec: number) => void;
  isRightPanelOpen: boolean;
  setIsRightPanelOpen: (open: boolean) => void;
  onOpenChat?: (chatId: string) => void;
}

export function ChatArea({
  user, selectedChat, isMobile, activeMode, activeTab, onlineUsers, chats, onBack, onCall, onMentionClick,
  messages, setMessages, replyingTo, setReplyingTo, editingMessage, setEditingMessage, newMessage, setNewMessage, fetchMessages, handleSendMessage, handleSendVoice, isRightPanelOpen, setIsRightPanelOpen, onOpenChat
}: ChatAreaProps) {
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const accentColor = useContactAccentColor(selectedChat?.avatar_url || null, selectedChat?.avatar_color || null);
  const { profile: viewedProfile } = useProfileDetails(isRightPanelOpen ? selectedChat?.id ?? null : null);

  const [chatWallpaper, setChatWallpaper] = useState<{ preset: WallpaperPreset; photoUrl: string | null }>({
    preset: (selectedChat as any)?.wallpaper_preset || 'solid',
    photoUrl: (selectedChat as any)?.wallpaper_photo_url || null,
  });

  const setReplyingToSafe = (msg: any) => {
    if (msg) setEditingMessage(null);
    setReplyingTo(msg);
  };
  const setEditingMessageSafe = (msg: any) => {
    if (msg) setReplyingTo(null);
    setEditingMessage(msg);
  };

  // ─── BACK-NAV: внутренние слои ChatArea в едином back-стеке ───
  // Приоритеты: contextMenu (100) → bgPicker (90) → mediaPicker (80).
  // rightPanel/editing/replying/чат регистрируются в app/page.tsx.
  useEffect(() => {
    if (!contextMenu) return;
    return registerNavLayer({
      id: "chat-context-menu",
      priority: 100,
      isOpen: () => true,
      close: () => setContextMenu(null),
    });
  }, [contextMenu]);

  useEffect(() => {
    if (!bgPickerOpen) return;
    return registerNavLayer({
      id: "chat-bg-picker",
      priority: 90,
      isOpen: () => true,
      close: () => setBgPickerOpen(false),
    });
  }, [bgPickerOpen]);

  useEffect(() => {
    if (!isMediaPickerOpen) return;
    return registerNavLayer({
      id: "chat-media-picker",
      priority: 80,
      isOpen: () => true,
      close: () => setIsMediaPickerOpen(false),
    });
  }, [isMediaPickerOpen]);


  const drag = useFileDragDrop({
    enabled: !isMobile && !!user,
    selectedChatId: selectedChat?.id ?? null,
    onSendFiles: (files, chatId) => { for (const f of files) onSendFile(f, chatId); },
    onOpenChat: (id) => onOpenChat?.(id),
  });

  // ─── ФАЙЛЫ: upload-стейты + обработчики ───
  const [uploadStates, setUploadStates] = useState<Map<string, UploadUiState>>(new Map());
  const fileHandlesRef = useRef<Map<string, FileUploadHandle>>(new Map());

  const otherPartyId = (selectedChat as any)?.other_user_id
    ?? (selectedChat as any)?.peer_id
    ?? (selectedChat as any)?.user_id
    ?? (selectedChat as any)?.participant_id
    ?? selectedChat?.id;

    const onSendFile = (file: File, targetChatId?: string) => {
      if (!user) return;
      const receiverId = targetChatId ?? otherPartyId ?? selectedChat?.id;
      if (!receiverId) return;
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`Файл больше 10 МБ (${(file.size / 1048576).toFixed(1)} МБ)`);
        return;
      }

      // Оптимистичный UI только если файл летит в ОТКРЫТЫЙ чат.
      // Дроп на чат из списка → тихо грузим, баббл появится у получателя/после открытия.
      const inView = receiverId === selectedChat?.id;
      const localId = `file-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (inView) {
        const optimistic: Message = {
          id: localId,
          sender_id: user.id,
          receiver_id: receiverId,
          type: "file",
          content: JSON.stringify({
            path: "", nonce: "",
            mime: file.type || "application/octet-stream",
            name: file.name, size: file.size,
            to: receiverId, kind: "file",
          }),
          created_at: new Date().toISOString(),
          status: "sending",
        } as Message;
        setMessages(prev => [...prev, optimistic]);
      }

      const handle = encryptAndUploadFile(user.id, receiverId, file, {
        onProgress: (loaded, total) => {
          if (inView) setUploadStates(prev => new Map(prev).set(localId, { status: "uploading", loaded, total }));
        },
        onStatus: (s) => {
          if (!inView) return;
          setUploadStates(prev => {
            const n = new Map(prev);
            const cur = n.get(localId) ?? { status: "uploading" as const, loaded: 0, total: 0 };
            n.set(localId, { ...cur, status: s });
            return n;
          });
        },
      });
      fileHandlesRef.current.set(localId, handle);

      handle.metaPromise.then(async (meta) => {
        const { data: inserted, error } = await supabase.from("messages").insert({
          sender_id: user.id,
          receiver_id: receiverId,
          type: "file",
          content: JSON.stringify(meta),
          status: "sent",
        }).select().single();
        if (error) throw error;

        if (inView) {
          setMessages(prev => prev.map(m => m.id === localId ? (inserted as Message) : m));
          setUploadStates(prev => { const n = new Map(prev); n.delete(localId); return n; });
        }
        fileHandlesRef.current.delete(localId);
      }).catch((err) => {
        fileHandlesRef.current.delete(localId);
        if (err?.cancelled) {
          if (inView) setMessages(prev => prev.filter(m => m.id !== localId));
        } else {
          console.error("[FILE] upload failed:", err);
          if (inView) setUploadStates(prev => new Map(prev).set(localId, { status: "error", loaded: 0, total: 0 }));
          toast.error("Не удалось отправить файл");
        }
      });
    };

  const handleFileCancel = (msg: any) => {
    fileHandlesRef.current.get(msg?.id)?.cancel();
  };

  const handleFileResume = (msg: any) => {
    fileHandlesRef.current.get(msg?.id)?.resume();
  };

  const handleFileOpen = async (msg: any) => {
    if (!user) return;
    const meta = parseFileMeta(msg?.content);
    if (!meta || !meta.path) return; // ещё льётся — открывать нечего
    const keyUserId = keyUserFor(msg, meta.to, user.id);
    try {
      await openFileMessage(meta, keyUserId);
    } catch (e) {
      console.error("[FILE] open failed:", e);
      toast.error("Не удалось открыть файл");
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, selectedChat]);

  useEffect(() => {
    if (!selectedChat) return;
    if ((selectedChat as any).wallpaper_preset) {
      setChatWallpaper({
        preset: (selectedChat as any).wallpaper_preset || 'solid',
        photoUrl: (selectedChat as any).wallpaper_photo_url || null,
      });
    } else {
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

  // Загрузка сообщений при смене чата
  useEffect(() => {
    if (selectedChat && user) {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      fetchMessages(selectedChat.id, user.id);
    }
  }, [selectedChat?.id, user?.id]);

  return (
    <>
      <main className={cn(
        "flex-1 flex flex-col relative z-10 transition-all duration-700 ease-in-out bg-black/[0.02] min-h-0 min-w-0 overflow-hidden",
        isMobile && !selectedChat && (activeTab === 'chats' || activeTab === 'community' || activeTab === 'feed') ? "translate-x-full absolute inset-y-0 opacity-0 pointer-events-none" : "translate-x-0 opacity-100 relative"
      )}>
        <ChatHeader
          selectedChat={selectedChat}
          isMobile={isMobile}
          activeMode={activeMode}
          user={user}
          isOnline={selectedChat ? onlineUsers.has(selectedChat.id) : false}
          lastSeenLabel={selectedChat?.last_seen ? formatRelativeTime(selectedChat.last_seen) : null}
          onBack={onBack}
          onOpenProfile={() => setIsRightPanelOpen(true)}
          onOpenBgPicker={() => setBgPickerOpen(true)}
          onClearChat={async () => {
            if (!selectedChat || !user) return;
            await supabase.from("messages").delete().or(
              `and(sender_id.eq.${user.id},receiver_id.eq.${selectedChat.id}),and(sender_id.eq.${selectedChat.id},receiver_id.eq.${user.id})`
            );
            setMessages([]);
            toast.success("Чат очищен");
          }}
        />

        <div data-chatarea className="flex-1 min-h-0 relative overflow-hidden">
          <ChatWallpaper preset={chatWallpaper.preset} accentColor={accentColor} photoUrl={chatWallpaper.photoUrl} />
          <div
            className={cn("relative z-[1] h-full px-3 md:px-12 py-3 md:py-8 overflow-y-auto overscroll-contain scrollbar-hide", contextMenu ? "chat-dimmed" : "")}
            ref={scrollRef}
          >
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
                const showAvatar = i === 0 || messages[i-1]?.sender_id !== msg.sender_id;
                const rawId = msg?.id || (msg as any)?.temp_id;
                const safeKey = (!rawId || String(rawId).trim() === "") ? `msg-fallback-${i}-${Date.now()}` : String(rawId);
                const targetId = contextMenu?.message?.id || (contextMenu?.message as any)?.temp_id;
                const currentId = msg?.id || (msg as any)?.temp_id;
                const isTarget = Boolean(targetId) && String(currentId) === String(targetId);
                const isDimmed = Boolean(contextMenu) && !isTarget;

                return (
                  <MessageBubble
                    key={safeKey}
                    msg={msg}
                    isMe={isMe}
                    showAvatar={showAvatar}
                    activeChat={selectedChat}
                    user={user}
                    onReply={setReplyingToSafe}
                    onEdit={(m) => { setEditingMessageSafe(m); setNewMessage(m.content); textareaRef.current?.focus(); }}
                    onMentionClick={onMentionClick}
                    isDimmed={isDimmed}
                    onContextMenu={(e, msg, isMine, rect) => {
                      e.preventDefault();
                      setContextMenu({ message: msg, isMine, anchorRect: rect });
                    }}
                    uploadState={uploadStates.get(currentId)}
                    onFileOpen={handleFileOpen}
                    onFileCancel={handleFileCancel}
                    onFileResume={handleFileResume}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {selectedChat && (
          <ChatInput
            newMessage={newMessage}
            setNewMessage={setNewMessage}
            replyingTo={replyingTo}
            setReplyingTo={setReplyingToSafe}
            editingMessage={editingMessage}
            setEditingMessage={setEditingMessageSafe}
            onSend={() => handleSendMessage(selectedChat, user!, newMessage)}
            onSendVoice={(blob, sec) => handleSendVoice(selectedChat, user!, blob, sec)}
            onSendFile={onSendFile}
            selectedChat={selectedChat}
            user={user}
            isMobile={isMobile}
            textareaRef={textareaRef}
            isFullPickerOpen={isMediaPickerOpen}
            onToggleFullPicker={() => setIsMediaPickerOpen(prev => !prev)}
          />
        )}

          <AnimatePresence>
            {drag.active && drag.overChatArea && (
              <motion.div
                key="dropzone"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
              >
                <div className="absolute inset-0 backdrop-blur-xl bg-black/40" />
                <motion.div
                  initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 380, damping: 26 }}
                  className="relative z-10 flex flex-col items-center gap-5"
                >
                  <motion.div
                    animate={{ scale: [1, 1.06, 1] }}
                    transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                    className="w-24 h-24 rounded-[28px] border-2 border-dashed border-primary/70 bg-primary/10 flex items-center justify-center shadow-2xl shadow-primary/20"
                  >
                    <TbFileUpload className="w-10 h-10 text-primary" />
                  </motion.div>
                  <div className="px-6 py-3 rounded-2xl bg-zinc-900/80 backdrop-blur-xl border border-white/10 text-sm font-medium text-zinc-200">
                    Перетащите файлы, чтобы отправить их здесь
                  </div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">до 10 МБ · E2EE</div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
      </main>

      {/* Profile View Panel & MediaPicker Panel (Right) */}
      <AnimatePresence mode="wait">
        {selectedChat && isMediaPickerOpen && !isMobile ? (
          <motion.aside
            key="media-picker-panel"
            initial={{ x: 100, opacity: 0, filter: "blur(10px)" }}
            animate={{ x: 0, opacity: 1, filter: "blur(0px)" }}
            exit={{ x: 100, opacity: 0, filter: "blur(10px)" }}
            transition={{ type: "spring", damping: 30, stiffness: 300, mass: 0.8 }}
            className="flex flex-col z-40 shrink-0 border-l border-white/5 relative w-96 bg-[#0a0a0d]"
          >
            <button onClick={() => setIsMediaPickerOpen(false)} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10">
              <X className="w-4 h-4" />
            </button>
            <div className="flex-1 overflow-hidden p-2">
              <MediaPicker
                onEmojiSelect={(e) => setNewMessage(prev => prev + e)}
                onStickerSelect={() => {}}
                onGifSelect={() => {}}
              />
            </div>
          </motion.aside>
        ) : selectedChat && isRightPanelOpen && viewedProfile && (
          <motion.aside
            key="profile-panel"
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
              onClose={() => setIsRightPanelOpen(false)}
              onMuteToggle={() => {}}
              onCall={() => onCall(false)}
              onVideoCall={() => onCall(true)}
              onBlock={async () => {
                await supabase.from("blocks").insert({ blocker_id: user?.id, blocked_id: selectedChat.id });
              }}
              onReport={() => {}}
              onClearHistory={async () => {
                if (user) {
                  await supabase.from("messages").delete().or(
                    `and(sender_id.eq.${user.id},receiver_id.eq.${selectedChat.id}),and(sender_id.eq.${selectedChat.id},receiver_id.eq.${user.id})`
                  );
                  setMessages([]);
                }
              }}
            />
          </motion.aside>
        )}
      </AnimatePresence>

      {selectedChat && (
        <ChatBackgroundPicker
          open={bgPickerOpen}
          onClose={() => setBgPickerOpen(false)}
          chatId={selectedChat.id}
          accentColor={accentColor}
          current={chatWallpaper}
          onChange={(next) => setChatWallpaper(next)}
        />
      )}

      <MessageContextMenu
        target={contextMenu}
        onClose={() => setContextMenu(null)}
        onReply={(msg) => setReplyingToSafe(msg)}
        onCopy={(msg) => {
          navigator.clipboard.writeText(msg.content || "");
          toast.success("Скопировано");
        }}
        onPin={(msg) => toast.info("Закрепление сообщений скоро")}
        onEdit={(msg) => {
          setEditingMessageSafe(msg);
          setNewMessage(msg.content);
          textareaRef.current?.focus();
        }}
        onDelete={async (msg, scope) => {
          try {
            if (scope === "me") {
              setMessages(prev => prev.filter(m => m.id !== msg.id));
              toast.success("Удалено у вас");
            } else {
            // Сначала снести медиа из Storage, потом строку
              await deleteMessageMedia(msg);
              await supabase.from("messages").delete().eq("id", msg.id);
              setMessages(prev => prev.filter(m => m.id !== msg.id));
              toast.success("Удалено у всех");
            }
          } catch (err) {
          console.error("Delete error:", err);
          toast.error("Ошибка удаления сообщения");
          }
        }}
        onReact={(msg, emoji) => toast.success(`Реакция ${emoji} добавлена`)}
      />
    </>
  );
}