"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
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
  TbUser as UserIcon,
  TbLoader2 as Loader,
} from "react-icons/tb";
import { cn, safeChar } from "@/lib/utils";
import { compressAvatar } from "@/lib/media";
import { createStandardGroup, saveGroupKey } from "@/lib/groups";
import { supabase } from "@/lib/supabase";
import { SecureAvatar } from "./secure-avatar";
import type { Chat } from "@/hooks/echo/types";

// ── Типы групп: лимит участников + дефолт ──
export type GroupKind = "standard" | "super" | "superprivate";

export const GROUP_KINDS: { id: GroupKind; label: string; limit: number; hint: string; icon: typeof UsersIcon }[] = [
  { id: "standard", label: "Обычная группа", limit: 5_000, hint: "До 5 000 участников", icon: UserIcon },
  { id: "super", label: "SuperGroup", limit: 200_000, hint: "До 200 000 участников", icon: UsersIcon },
  { id: "superprivate", label: "SuperPrivate", limit: 500, hint: "До 500 участников, только по приглашениям", icon: LockIcon },
];

// ── Мобильный iOS-sheet: параметры анимации ──
// Кривая Apple pageSheet: быстрый старт, плавное торможение — «плавно, но быстро».
const SHEET_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const SHEET_DURATION = 0.44;        // появление, сек
const SHEET_EXIT_DURATION = 0.3;    // закрытие, сек
const SHEET_DISMISS_OFFSET = 110;   // свайп вниз дальше этого (px) закрывает
const SHEET_DISMISS_VELOCITY = 650; // flick вниз быстрее этого (px/s) закрывает
const BEHIND_SCALE = 0.94;          // насколько «отдаляется» экран под шитом

/** matchMedia-хук: mobile = ниже Tailwind-брейкпоинта md (768px). */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

interface GroupCreateModalProps {
  open: boolean;
  /** Все пользователи, с которыми есть чат — кандидаты в участники. */
  chats: Chat[];
  onClose: () => void;
  /** Логики создания пока нет — UI/UX only (вызовется позже). */
  onSubmit?: (draft: { name: string; bio: string; kind: GroupKind; memberIds: string[]; avatarFile: File | null }) => void;
  /** Успешное создание: закрыть модалку + перейти в чат группы. */
  onCreated?: (groupId: string) => void;
}

/**
- New Group — первый шаг создания группы (UI/UX only, без серверной логики).
- На мобильных (< md) открывается как iOS pageSheet: фуллскрин-плашка выезжает
  снизу, фон под ней слегка «отдаляется» (scale 0.94), свайп вниз по шапке
  или грабберу закрывает. На десктопе — прежний центрированный диалог.
 */
export function GroupCreateModal({ open, chats, onClose, onSubmit, onCreated }: GroupCreateModalProps) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [kind, setKind] = useState<GroupKind>("standard");
  const [kindOpen, setKindOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const dragControls = useDragControls();
  const bgAnimsRef = useRef<Animation[]>([]);
  const openTokenRef = useRef(0);
  const isMobile = useIsMobile();

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

  // ── Блокируем скролл страницы, пока открыт мобильный шит ──
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  // ── iOS-эффект: фон под шитом слегка «отдаляется» (scale + скругление) ──
  // Цель ищется так: [data-sheet-backdrop] на корне приложения → <main> →
  // первый ребёнок #root / #__next. Можно повесить data-sheet-backdrop
  // на свой layout-контейнер для точного контроля.
  useEffect(() => {
    if (!open || !isMobile) return;
    const token = ++openTokenRef.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const target =
      document.querySelector<HTMLElement>("[data-sheet-backdrop]") ??
      document.querySelector<HTMLElement>("main") ??
      (document.getElementById("root")?.firstElementChild as HTMLElement | null) ??
      (document.getElementById("__next")?.firstElementChild as HTMLElement | null);
    if (!target) return;

    // Гасим незавершённые анимации от прошлого открытия/закрытия
    bgAnimsRef.current.forEach((a) => {
      try { a.cancel(); } catch { /* уже отменена */ }
    });
    bgAnimsRef.current = [];

    const prevOverflow = target.style.overflow;
    const prevRadius = target.style.borderRadius;
    target.style.overflow = "hidden";
    target.style.willChange = "transform";

    const zoomIn = target.animate(
      [
        { transform: "scale(1) translateY(0px)", borderRadius: "0px" },
        { transform: `scale(${BEHIND_SCALE}) translateY(-8px)`, borderRadius: "24px" },
      ],
      { duration: SHEET_DURATION * 1000, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" }
    );
    bgAnimsRef.current = [zoomIn];

    return () => {
      const zoomOut = target.animate(
        [
          { transform: `scale(${BEHIND_SCALE}) translateY(-8px)`, borderRadius: "24px" },
          { transform: "scale(1) translateY(0px)", borderRadius: "0px" },
        ],
        { duration: SHEET_EXIT_DURATION * 1000, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" }
      );
      bgAnimsRef.current = [zoomIn, zoomOut];
      const restore = () => {
        try { zoomIn.cancel(); } catch { /* уже отменена */ }
        try { zoomOut.cancel(); } catch { /* уже отменена */ }
        bgAnimsRef.current = bgAnimsRef.current.filter((a) => a !== zoomIn && a !== zoomOut);
        // Если шит успели открыть снова — не трогаем стили (свой набор уже стоит)
        if (openTokenRef.current === token) {
          target.style.overflow = prevOverflow;
          target.style.borderRadius = prevRadius;
          target.style.willChange = "";
        }
      };
      zoomOut.finished.then(restore).catch(restore);
    };
  }, [open, isMobile]);

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

  const canSubmit = name.trim().length > 0 && !submitting;

  // ── Сабмит: Group Seed → KDF → метаданные → пакеты → create-group ──
  // Криптография — в Rust (KeyStore), сервер видит только шифротекст.
  // Вёрстка не тронута: меняется только тело обработчика + disabled кнопки.
  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Введите название группы");
      return;
    }
    // Пока реализован только пайплайн обычных групп (is_ultra_private=false,
    // лимит 5000 — контракт задеплоенной Edge Function create-group).
    if (kind !== "standard") {
      if (onSubmit) {
        try {
          const compressed = avatarFile ? await compressAvatar(avatarFile) : null;
          const prepared = compressed && avatarFile
            ? new File([compressed], avatarFile.name, { type: compressed.type || "image/webp" })
            : avatarFile;
          onSubmit({ name: name.trim(), bio: bio.trim(), kind, memberIds, avatarFile: prepared });
        } catch {
          toast.error("Не удалось подготовить фото");
        }
        return;
      }
      toast.info("Этот тип групп — следующая итерация", { description: activeKind.label });
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const creatorId = session?.user?.id;
      if (!creatorId) {
        toast.error("Нет авторизации", { description: "Войдите в аккаунт заново" });
        return;
      }

      // Публичные X25519-ключи участников из контактов чата (fallback внутри
      // createStandardGroup — profiles.public_key, как в use-e2ee).
      const memberPubkeys = new Map<string, string>();
      for (const c of chats) {
        const pk = (c as { public_key?: string | null }).public_key;
        if (c.id && pk) memberPubkeys.set(c.id, pk);
      }

      const { group_id, seed } = await createStandardGroup({
        name: name.trim(),
        bio: bio.trim(),
        memberIds,
        avatarFile,
        memberPubkeys,
        creatorId,
      });

      // Создателю пакет в mailbox НЕ выдаётся (создатель уже имеет сид) —
      // кладём его в локальный SQLCipher-кэш, иначе buildGroupChats не сможет
      // расшифровать метаданные и группа не появится в списке у создателя.
      try {
        await saveGroupKey(creatorId, group_id, seed);
      } catch (e) {
        console.warn("[GroupCreate] failed to cache creator group key:", e);
      }

      toast.success("Группа создана", { description: `"${name.trim()}" · ${memberIds.length + 1} уч.` });
      const createdId = group_id;
      resetAll();
      onClose();
      onCreated?.(createdId);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      // Маппинг статусов Edge Function под дизайн-систему (sonner):
      // 400 — данные, 409 — конфликт id, остальное — сервер/крипто.
      if (/\(400\)|Некорректные данные/i.test(msg)) {
        toast.error("Не удалось создать группу", { description: msg });
      } else if (/\(409\)|уже существует/i.test(msg)) {
        toast.error("Конфликт создания", { description: msg });
      } else {
        toast.error("Ошибка создания группы", { description: msg });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const portalHeader = (
    <div
      className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/5"
      // Шапка — тоже «ручка» для свайпа вниз (как в iOS), кнопки при этом кликаются
      onPointerDown={isMobile ? (e) => dragControls.start(e) : undefined}
      style={isMobile ? { touchAction: "none" } : undefined}
    >
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
      </div>
      <button
        className="px-4 h-9 rounded-xl bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest disabled:opacity-40 disabled:pointer-events-none transition-all active:scale-95 flex items-center gap-2"
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {submitting && <Loader className="w-4 h-4 animate-spin" />}
        {submitting ? "Создание…" : "Далее"}
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
    <button
      className="w-full h-12 rounded-2xl border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-widest transition-all active:scale-[0.98]"
      onClick={handleClose}
    >
      Отмена
    </button>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="group-create"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.24 } }}
          transition={{ duration: 0.18 }}
          className={cn(
            "fixed inset-0 z-[300] flex",
            isMobile
              ? "items-end bg-black/55"
              : "items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          )}
          onClick={handleClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Создание группы"
            initial={isMobile ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 12 }}
            animate={isMobile ? { y: 0, opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={
              isMobile
                ? { y: "100%", transition: { duration: SHEET_EXIT_DURATION, ease: SHEET_EASE } }
                : { opacity: 0, scale: 0.96, y: 12 }
            }
            transition={
              isMobile
                ? { duration: SHEET_DURATION, ease: SHEET_EASE }
                : { type: "spring", damping: 28, stiffness: 320, mass: 0.9 }
            }
            drag={isMobile ? "y" : false}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.4}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (!isMobile) return;
              if (info.offset.y > SHEET_DISMISS_OFFSET || info.velocity.y > SHEET_DISMISS_VELOCITY) {
                handleClose();
              }
            }}
            className={
              isMobile
                // iOS pageSheet: почти на весь экран, скруглённый верх, фон за шитом виден
                ? "w-full h-[97dvh] flex flex-col bg-background border border-t-white/10 border-x-0 border-b-0 rounded-t-[22px] shadow-2xl overflow-hidden"
                : "w-full max-w-md max-h-[calc(100vh-2rem)] flex flex-col bg-background border border-white/10 rounded-[28px] shadow-2xl overflow-hidden"
            }
            onClick={(e) => e.stopPropagation()}
          >
            {isMobile && (
              <div
                className="shrink-0 flex justify-center pt-[max(0.625rem,env(safe-area-inset-top))] pb-1.5 cursor-grab active:cursor-grabbing"
                style={{ touchAction: "none" }}
                onPointerDown={(e) => dragControls.start(e)}
              >
                <div className="w-10 h-1.5 rounded-full bg-white/20" />
              </div>
            )}
            {portalHeader}
            <div className={cn(
              "flex-1 min-h-0 overflow-y-auto settings-scroll p-5 space-y-6 overscroll-contain",
              isMobile && "pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            )}>
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