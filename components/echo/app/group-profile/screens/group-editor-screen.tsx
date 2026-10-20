"use client";

/**
 * Редактор группы = САМ ПРОФИЛЬ в режиме редактирования (не список!).
 * Выглядит как панель профиля, но каждый элемент меняется прямым тапом:
 *   • баннер            → тап: смена фона (вместе с аватаром, экран «Аватар и фон»)
 *   • аватар по центру  → тап: смена фото
 *   • название          → тап по названию (пунктир + карандаш = можно менять)
 *   • описание          → тап по описанию (или «Добавить описание», если пусто)
 *   • ссылка            → отдельное меню (редактор ссылки; карандаш → временные)
 *   • остальные пункты  → строками НИЖЕ, вместо списка участников
 */
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  TbChevronRight,
  TbHistory,
  TbLink,
  TbMessagePlus,
  TbMoodSmile,
  TbPencil,
  TbShieldCheck,
  TbShieldLock,
  TbUsers,
} from "react-icons/tb";
import { cn } from "@/lib/utils";
import type { Chat } from "@/hooks/echo/types";
import { ScreenRow, ScreenShell, SectionTitle } from "../screen-shell";
import { GroupAvatar } from "../group-avatar";
import {
  GROUP_BG_PRESETS,
  formatAdmins,
  formatMembersOnline,
  type GroupDraftState,
  type GroupPanelScreen,
} from "../lib/group-profile-utils";

interface GroupEditorScreenProps {
  chat: Chat;
  draft: GroupDraftState;
  membersCount: number;
  adminsCount: number;
  isOwner: boolean;
  isAdmin: boolean;
  onBack: () => void;
  onNavigate: (screen: GroupPanelScreen) => void;
}

export function GroupEditorScreen({
  chat,
  draft,
  membersCount,
  adminsCount,
  isOwner,
  isAdmin,
  onBack,
  onNavigate,
}: GroupEditorScreenProps) {
  const canManage = isOwner || isAdmin;
  const dev = (label: string) => toast.info(`${label} — в разработке`);

  return (
    <ScreenShell title="Редактирование" onBack={onBack}>
      {/* ── баннер: тап → фон (в экране «Аватар и фон») ── */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.995 }}
        onClick={() => onNavigate("avatar")}
        className={cn(
          "relative block h-44 w-full",
          GROUP_BG_PRESETS[draft.bgIndex % GROUP_BG_PRESETS.length],
        )}
      >
        <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/40 to-transparent" />
        <span className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/40 backdrop-blur-md transition hover:bg-black/55">
          <TbPencil size={16} />
        </span>
      </motion.button>

      {/* ── аватар по центру, как в профиле ── */}
      <div className="flex flex-col items-center px-5">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => onNavigate("avatar")}
          className="relative -mt-11"
        >
          <GroupAvatar
            chat={chat}
            preview={draft.avatarPreview}
            size={88}
            className="rounded-[24px] shadow-xl ring-4 ring-background"
          />
          <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg">
            <TbPencil size={13} />
          </span>
        </motion.button>
        <p className="mt-2 text-[11px] text-muted-foreground">Нажми на фото, чтобы сменить</p>

        {/* ── название: тап → редактор названия ── */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => onNavigate("name")}
          className="mt-2 max-w-full px-2"
        >
          <span className="inline-flex max-w-full items-center gap-1.5 border-b border-dashed border-white/30 pb-0.5 text-[19px] font-bold">
            <span className="truncate">{draft.name}</span>
            <TbPencil size={13} className="shrink-0 text-muted-foreground" />
          </span>
        </motion.button>

        {/* ── описание: тап → редактор описания ── */}
        <motion.button
          whileTap={{ scale: 0.99 }}
          onClick={() => onNavigate("description")}
          className="mt-2.5 max-w-[88%]"
        >
          {draft.description ? (
            <span className="inline-block whitespace-pre-wrap border-b border-dashed border-white/20 pb-0.5 text-center text-[13px] leading-relaxed text-muted-foreground">
              {draft.description}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 border-b border-dashed border-white/20 pb-0.5 text-[13px] text-muted-foreground/70">
              <TbPencil size={12} />
              Добавить описание
            </span>
          )}
        </motion.button>

        {/* ── ссылка: отдельное меню ── */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => onNavigate("link")}
          className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-white/10"
        >
          <TbLink size={12} />
          {draft.username ? `@${draft.username}` : "Ссылки нет · группа закрыта"}
          <TbChevronRight size={12} className="opacity-50" />
        </motion.button>
      </div>

      {/* ── остальные пункты: вместо списка участников ── */}
      <SectionTitle>Управление</SectionTitle>
      <div className="mx-5 divide-y divide-white/5 overflow-hidden rounded-[20px] bg-muted">
        <ScreenRow
          icon={<TbUsers size={18} />}
          title="Участники"
          sub={formatMembersOnline(membersCount)}
          onClick={() => onNavigate("members")}
        />
        {canManage && (
          <ScreenRow
            icon={<TbShieldCheck size={18} />}
            title="Администраторы"
            sub={formatAdmins(adminsCount)}
            onClick={() => onNavigate("admins")}
          />
        )}
      </div>

      <SectionTitle>Ещё</SectionTitle>
      <div className="mx-5 divide-y divide-white/5 overflow-hidden rounded-[20px] bg-muted">
        <ScreenRow icon={<TbShieldLock size={18} />} title="Права участников" dev onClick={() => dev("Права участников")} />
        <ScreenRow icon={<TbMoodSmile size={18} />} title="Разрешённые реакции" dev onClick={() => dev("Разрешённые реакции")} />
        <ScreenRow icon={<TbMessagePlus size={18} />} title="Приветственное сообщение" dev onClick={() => dev("Приветственное сообщение")} />
        {isOwner && (
          <ScreenRow icon={<TbHistory size={18} />} title="Журнал действий" dev onClick={() => dev("Журнал действий")} />
        )}
      </div>
      <p className="px-5 pb-4 pt-4 text-[11px] leading-relaxed text-muted-foreground">
        Пункты с пометкой «Скоро» — в разработке.
      </p>
    </ScreenShell>
  );
}
