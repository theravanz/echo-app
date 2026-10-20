"use client";

/**
 * Редактор ссылки.
 *  • Сверху — как ссылку видят участники (@username + полная ссылка, копирование)
 *  • Режимы: «Вход по ссылке» / «Без ссылки» (никто сторонний не войдёт)
 *  • Справа в шапке — КАРАНДАШ (вместо QR): ведёт к временным ссылкам
 *    (случайный код, статистика, срок действия — пока в разработке).
 */
import { motion } from "framer-motion";
import { toast } from "sonner";
import { TbCheck, TbCopy, TbLinkPlus, TbPencil } from "react-icons/tb";
import { cn } from "@/lib/utils";
import { ScreenRow, ScreenShell, SectionTitle } from "../screen-shell";
import {
  ECHO_LINK_PREFIX,
  randomLinkCode,
  type GroupDraftState,
  type GroupPanelScreen,
} from "../lib/group-profile-utils";

interface LinkEditorScreenProps {
  draft: GroupDraftState;
  onBack: () => void;
  onPatch: (patch: Partial<GroupDraftState>) => void;
  onNavigate: (screen: GroupPanelScreen) => void;
}

export function LinkEditorScreen({ draft, onBack, onPatch, onNavigate }: LinkEditorScreenProps) {
  const hasLink = Boolean(draft.username);

  const copy = async () => {
    if (!draft.username) return;
    try {
      await navigator.clipboard.writeText(ECHO_LINK_PREFIX + draft.username);
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const enableLink = () => {
    if (hasLink) return;
    onPatch({ username: randomLinkCode() });
    toast.success("Ссылка создана");
    // TODO(backend): RPC — занять код ссылки за группой
  };

  const disableLink = () => {
    if (!hasLink) return;
    onPatch({ username: null });
    toast.success("Ссылка отключена — группа закрыта");
    // TODO(backend): RPC
  };

  return (
    <ScreenShell
      title="Ссылка"
      onBack={onBack}
      right={
        <button
          onClick={() => onNavigate("tempLinks")}
          title="Временные ссылки"
          className="grid h-9 w-9 place-items-center rounded-full bg-white/5 transition hover:bg-white/10"
        >
          <TbPencil size={16} />
        </button>
      }
    >
      {/* Как ссылку видят участники */}
      <SectionTitle>Так её видят участники</SectionTitle>
      <div className="mx-5 rounded-[20px] bg-muted p-5 text-center">
        {hasLink ? (
          <>
            <p className="text-[17px] font-bold">@{draft.username}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {ECHO_LINK_PREFIX}
              {draft.username}
            </p>
            <button
              onClick={copy}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3.5 py-1.5 text-[12px] font-semibold transition hover:bg-white/10"
            >
              <TbCopy size={13} />
              Копировать
            </button>
          </>
        ) : (
          <>
            <p className="text-[15px] font-semibold">Ссылки нет</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Группа закрыта — посторонние не войдут
            </p>
          </>
        )}
      </div>

      {/* Режимы входа */}
      <SectionTitle>Кто может вступить</SectionTitle>
      <div className="mx-5 divide-y divide-white/5 overflow-hidden rounded-[20px] bg-muted">
        <button
          type="button"
          onClick={enableLink}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.03]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Вход по ссылке</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              Вступить смогут только те, у кого есть твоя ссылка
            </span>
          </span>
          <Radio checked={hasLink} />
        </button>
        <button
          type="button"
          onClick={disableLink}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.03]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Без ссылки</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              Никто из сторонних не сможет войти — только по приглашениям
            </span>
          </span>
          <Radio checked={!hasLink} />
        </button>
      </div>

      {/* Временные ссылки */}
      <SectionTitle>Временные ссылки</SectionTitle>
      <div className="mx-5 overflow-hidden rounded-[20px] bg-muted">
        <ScreenRow
          icon={<TbLinkPlus size={18} />}
          title="Создать и управлять"
          sub="Случайный код, статистика переходов, срок действия"
          onClick={() => onNavigate("tempLinks")}
        />
      </div>
      <p className="px-5 pb-4 pt-3 text-[11px] leading-relaxed text-muted-foreground">
        Карандаш справа сверху ведёт туда же.
      </p>
    </ScreenShell>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition",
        checked ? "border-primary bg-primary" : "border-white/20",
      )}
    >
      {checked && <TbCheck size={12} className="text-white" />}
    </span>
  );
}
