"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
  TbCamera as Camera,
  TbPhoto as PhotoIcon,
  TbTrash as TrashIcon,
  TbCheck as Check,
  TbChevronDown as ChevronDown,
  TbSearch as Search,
  TbUsers as UsersIcon,
  TbLock as LockIcon,
  TbWorld as GlobeIcon,
  TbUser as UserIcon,
} from "react-icons/tb";
import { cn, safeChar } from "@/lib/utils";
import { compressAvatar } from "@/lib/media";
import { SecureAvatar } from "./secure-avatar";
import type { Chat } from "@/hooks/echo/types";

export type GroupKind = "standard" | "super" | "superprivate";

export const GROUP_KINDS: { id: GroupKind; label: string; limit: number; hint: string; icon: typeof UsersIcon }[] = [
  { id: "standard", label: "Обычная группа", limit: 5_000, hint: "До 5 000 участников", icon: UserIcon },
  { id: "super", label: "SuperGroup", limit: 200_000, hint: "До 200 000 участников", icon: UsersIcon },
  { id: "superprivate", label: "SuperPrivate", limit: 500, hint: "До 500 участников, только по приглашениям", icon: LockIcon },
];

interface GroupCreateModalProps {
  open: boolean;
  chats: Chat[];
  onClose: () => void;
  onSubmit?: (draft: { name: string; bio: string; kind: GroupKind; memberIds: string[]; avatarFile: File | null }) => void;
}

export function GroupCreateModal({ open, chats, onClose, onSubmit }: GroupCreateModalProps) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [kind, setKind] = useState<GroupKind>("standard");
  const [kindOpen, setKindOpen] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const activeKind = GROUP_KINDS.find((k) => k.id === kind) ?? GROUP_KINDS[0];

  const q = memberQuery.trim().toLowerCase();
  const candidates = q
    ? chats.filter((c) =>
        (c.display_name || c.username || "").toLowerCase().includes(q) ||
        (c.username || "").toLowerCase().includes(q)
      )
    : chats;

  const selectedMembers = chats.filter((c) => memberIds.includes(c.id));
  const limitReached = memberIds.length >= activeKind.limit;

  const resetAll = () => {
    setName("");
    setBio("");
    setKind("standard");
    setKindOpen(false);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarMenuOpen(false);
    setMembersOpen(false);
    setMemberQuery("");
    setMemberIds([]);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  const toggleMember = (id: string) => {
    setMemberIds((prev) => {
      if (prev.includes(id)) return prev.filter((m) => m !== id);
      if (prev.length >= activeKind.limit) {
        toast.error(`Лимит: ${activeKind.limit} участников`, { description: activeKind.label });
        return prev;
      }
      return [...prev, id];
    });
  };

  const handlePickAvatar = (file: File | null) => {
    setAvatarMenuOpen(false);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Нужен файл-картинка");
      return;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleRemoveAvatar = () => {
    setAvatarMenuOpen(false);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const canSubmit = name.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      toast.error("Введите название группы");
      return;
    }
    try {
      let prepared: File | null = null;
      if (avatarFile) {
        const compressed = await compressAvatar(avatarFile);
        prepared = new File([compressed], avatarFile.name, { type: compressed.type || "image/webp" });
      }
      if (onSubmit) {
        onSubmit({ name: name.trim(), bio: bio.trim(), kind, memberIds, avatarFile: prepared ?? avatarFile });
      } else {
        toast.info("Создание групп скоро", { description: `"${name.trim()}" · ${activeKind.label} · ${memberIds.length} уч.` });
      }
    } catch {
      toast.error("Не удалось подготовить фото");
    }
  };

  const portalHeader = (
    <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/5">
      <button
        className="w-9 h-9 rounded-xl hover:bg-white/5 flex items-center justify-center text-white/60 hover:text-white transition-colors"
        onClick={handleClose}
        aria-label="Отмена"
        title="Отмена"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <div className="flex-1 min-w-0">
        <h2 className="text-base font-display font-bold tracking-tight truncate">New Group</h2>
        <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/30">Шаг 1 из 1 · UI</p>
      </div>
      <button
        className="px-4 h-9 rounded-xl bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest disabled:opacity-40 disabled:pointer-events-none transition-all active:scale-95"
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        Далее
      </button>
    </div>
  );

  const avatarBlock = (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <button
          className="w-20 h-20 rounded-full bg-white/5 border border-white/10 hover:border-primary/40 flex items-center justify-center overflow-hidden transition-all group"
          onClick={() => setAvatarMenuOpen((v) => !v)}
          aria-label="Фото группы"
          title="Выбрать фото группы"
        >
          {avatarPreview ? (
            <img src={avatarPreview} alt="Group avatar" className="w-full h-full object-cover" />
          ) : (
            <Camera className="w-7 h-7 text-white/30 group-hover:text-primary transition-colors" />
          )}
        </button>
        <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary flex items-center justify-center border-[3px] border-background">
          <Camera className="w-3.5 h-3.5 text-primary-foreground" />
        </span>
        <AnimatePresence>
          {avatarMenuOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 top-[calc(100%+10px)] z-20 w-52 rounded-2xl border border-white/10 bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-1.5"
            >
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-white/5 transition-colors text-left"
                onClick={() => avatarInputRef.current?.click()}
              >
                <PhotoIcon className="w-4 h-4 text-primary" />
                <span>Выбрать фото</span>
              </button>
              {avatarPreview && (
                <button
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-destructive/10 text-destructive transition-colors text-left"
                  onClick={handleRemoveAvatar}
                >
                  <TrashIcon className="w-4 h-4" />
                  <span>Убрать фото</span>
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handlePickAvatar(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold">Фото группы</div>
        <p className="text-xs text-white/40 leading-relaxed">
          Шифруется как аватары профиля (AES-256-GCM, приватный bucket).
        </p>
      </div>
    </div>
  );

  const nameBlock = (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 ml-1">
          Group name *
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="Название группы"
          className="w-full h-12 px-4 rounded-2xl bg-white/[0.03] border border-white/10 focus:border-primary/50 focus:bg-white/[0.05] outline-none text-sm font-medium placeholder:text-white/25 transition-all"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 ml-1">
          Group bio
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={255}
          rows={3}
          placeholder="О чём группа (необязательно)"
          className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/10 focus:border-primary/50 focus:bg-white/[0.05] outline-none text-sm font-medium placeholder:text-white/25 transition-all resize-none"
        />
      </div>
    </div>
  );

  const kindBlock = (
    <div className="space-y-2">
      <label className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 ml-1">
        Тип группы
      </label>
      <div className="relative">
        <button
          className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-primary/40 transition-all text-left"
          onClick={() => setKindOpen((v) => !v)}
          aria-expanded={kindOpen}
        >
          <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <activeKind.icon className="w-5 h-5 text-primary" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-bold truncate">{activeKind.label}</span>
            <span className="block text-[11px] text-white/40 truncate">{activeKind.hint}</span>
          </span>
          <ChevronDown className={cn("w-4 h-4 text-white/40 transition-transform", kindOpen && "rotate-180")} />
        </button>
        <AnimatePresence>
          {kindOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-2xl border border-white/10 bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-1.5"
            >
              {GROUP_KINDS.map((k) => {
                const Icon = k.icon;
                const active = k.id === kind;
                return (
                  <button
                    key={k.id}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left",
                      active ? "bg-primary/15 border border-primary/20" : "hover:bg-white/5 border border-transparent"
                    )}
                    onClick={() => {
                      setKind(k.id);
                      setKindOpen(false);
                      if (memberIds.length > k.limit) {
                        toast.error(`В «${k.label}» влезет только ${k.limit}`, {
                          description: `Сейчас выбрано ${memberIds.length} — уберите лишних`,
                        });
                      }
                    }}
                  >
                    <span className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", active ? "bg-primary/20" : "bg-white/5")}>
                      <Icon className={cn("w-5 h-5", active ? "text-primary" : "text-white/60")} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold">{k.label}</span>
                      <span className="block text-[11px] text-white/40">{k.hint}</span>
                    </span>
                    {active && <Check className="w-4 h-4 text-primary shrink-0" />}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  const membersHead = (
    <div className="flex items-center justify-between ml-1">
      <label className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30">
        Add members
      </label>
      <span className={cn(
        "text-[10px] font-mono tabular-nums",
        limitReached ? "text-destructive" : "text-white/40"
      )}>
        {memberIds.length}/{activeKind.limit.toLocaleString("ru-RU")}
      </span>
    </div>
  );

  const membersTrigger = (
    <button
      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-primary/40 transition-all text-left"
      onClick={() => setMembersOpen((v) => !v)}
      aria-expanded={membersOpen}
    >
      <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <UsersIcon className="w-5 h-5 text-primary" />
      </span>
      <span className="flex-1 min-w-0 text-sm text-white/60 truncate">
        {memberIds.length === 0 ? "Выбрать из чатов…" : `Выбрано: ${memberIds.length}`}
      </span>
      <ChevronDown className={cn("w-4 h-4 text-white/40 transition-transform", membersOpen && "rotate-180")} />
    </button>
  );

  const membersSearch = (
    <div className="p-2 border-b border-white/5">
      <div className="flex items-center gap-2 px-3 h-10 rounded-xl bg-white/[0.04] border border-white/5 focus-within:border-primary/40 transition-all">
        <Search className="w-4 h-4 text-white/30 shrink-0" />
        <input
          value={memberQuery}
          onChange={(e) => setMemberQuery(e.target.value)}
          placeholder="Найти…"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-white/25"
        />
        {memberQuery && (
          <button onClick={() => setMemberQuery("")} aria-label="Очистить поиск" className="text-white/30 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  const membersChips = selectedMembers.length > 0 && (
    <div className="flex flex-wrap gap-2 pt-1">
      {selectedMembers.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-2 pl-1 pr-2 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-medium"
        >
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold overflow-hidden"
            style={{ backgroundColor: m.avatar_color || "oklch(0.2 0.02 280)" }}>
            {m.avatar_url || m.avatar_storage_path ? (
              <SecureAvatar src={m.avatar_url} bucket="avatars" path={m.avatar_storage_path || undefined} nonce={m.avatar_nonce} mime={m.avatar_mime} fallback={safeChar(m.display_name || m.username)} className="w-full h-full object-cover" />
            ) : safeChar(m.display_name || m.username)}
          </span>
          <span className="max-w-[120px] truncate">{m.display_name || m.username}</span>
          <button
            onClick={() => toggleMember(m.id)}
            aria-label={`Убрать ${m.display_name || m.username}`}
            className="text-white/40 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      ))}
    </div>
  );

  const footerBlock = (
    <>
      <button
        className="w-full h-12 rounded-2xl border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-widest transition-all active:scale-[0.98]"
        onClick={handleClose}
      >
        Отмена
      </button>
      <p className="text-center text-[10px] font-mono uppercase tracking-widest text-white/25 pb-1">
        <GlobeIcon className="w-3 h-3 inline mr-1 -mt-0.5" />
        Логика групп — следующая итерация
      </p>
    </>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="group-create"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm sm:p-4"
          onClick={handleClose}
        >
          {/* Анимация отдаливания фона (опционально, можно повесить на главный контейнер приложения, если есть реф) */}
          <motion.div
            initial={{ opacity: 0, y: "100%", scale: 1 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: "100%", scale: 1 }}
            transition={{ type: "spring", damping: 30, stiffness: 300, mass: 0.8 }}
            className={cn(
              "w-full flex flex-col bg-background border border-white/10 shadow-2xl overflow-hidden",
              /* Мобилки: на весь экран скругленные сверху, планшеты/ПК: обычное по центру */
              "h-[100dvh] sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:max-w-md sm:rounded-[28px]",
              "rounded-t-[32px] sm:rounded-[28px]"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {portalHeader}
            <div className="flex-1 min-h-0 overflow-y-auto settings-scroll p-5 space-y-6">
              {avatarBlock}
              {nameBlock}
              {kindBlock}
              <div className="space-y-2">
                {membersHead}
                <div className="relative">
                  {membersTrigger}
                  <AnimatePresence>
                    {membersOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.97, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-2xl border border-white/10 bg-zinc-900/95 backdrop-blur-xl shadow-2xl overflow-hidden"
                      >
                        {membersSearch}
                        <div className="max-h-56 overflow-y-auto settings-scroll p-1.5">
                          {candidates.length === 0 && (
                            <div className="px-3 py-6 text-center text-xs text-white/35">
                              {chats.length === 0 ? "Пока нет чатов — некого добавлять" : "Никого не найдено"}
                            </div>
                          )}
                          {candidates.map((c) => (
                            <MemberRow
                              key={c.id}
                              chat={c}
                              checked={memberIds.includes(c.id)}
                              disabled={!memberIds.includes(c.id) && limitReached}
                              onToggle={() => toggleMember(c.id)}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                {membersChips}
              </div>
              {footerBlock}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function MemberRow({ chat: c, checked, disabled, onToggle }: { chat: Chat; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left",
        disabled ? "opacity-35 pointer-events-none" : "hover:bg-white/5",
        checked && "bg-primary/10"
      )}
    >
      <span className={cn(
        "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all",
        checked ? "bg-primary border-primary" : "border-white/20 bg-transparent"
      )}>
        {checked && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
      </span>
      <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold overflow-hidden shrink-0"
        style={{ backgroundColor: c.avatar_color || "oklch(0.2 0.02 280)" }}>
        {c.avatar_url || c.avatar_storage_path ? (
          <SecureAvatar src={c.avatar_url} bucket="avatars" path={c.avatar_storage_path || undefined} nonce={c.avatar_nonce} mime={c.avatar_mime} fallback={safeChar(c.display_name || c.username)} className="w-full h-full object-cover" />
        ) : safeChar(c.display_name || c.username)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold truncate">{c.display_name || c.username}</span>
        {c.username && <span className="block text-[11px] text-white/35 truncate">@{c.username}</span>}
      </span>
    </button>
  );
}