"use client";

/**
 * GroupProfilePanel — профиль группы (главная панель).
 * Монтируй как ProfileViewPanel; если ставишь внутрь контейнера —
 * замени `fixed inset-0` на `absolute inset-0` в корневом div.
 *
 * СТРУКТУРА ПАПКИ (всё лежит рядом):
 *   group-profile-panel.tsx   ← главная панель (этот файл)
 *   screen-shell.tsx          оболочка экранов + SectionTitle + ScreenRow
 *   group-avatar.tsx          GroupAvatar (прямоугольный) + MemberAvatar
 *   lib/group-profile-utils   типы, форматы, пресеты фона, генератор кодов
 *   screens/                  меню редактора и все под-экраны
 *   dialogs/                  подтверждение вводом названия + выбор владельца
 *
 * НАВИГАЦИЯ — стек: openScreen() кладёт экран, back() снимает верхний.
 */
import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  TbArrowLeft,
  TbBellOff,
  TbLogout,
  TbPencil,
  TbShare2,
  TbUserPlus,
} from "react-icons/tb";
import { cn } from "@/lib/utils";
import type { Chat, GroupMember, GroupRole } from "@/hooks/echo/types";
import {
  GROUP_BG_PRESETS,
  ROLE_BADGE_CLASS,
  ROLE_LABEL,
  formatMembersOnline,
  getMemberName,
  isMemberOnline,
  readGroupMeta,
  type GroupDraftState,
  type GroupPanelScreen,
} from "./lib/group-profile-utils";
import { GroupAvatar, MemberAvatar } from "./group-avatar";
import { ScreenDirectionContext } from "./screen-shell";
import { GroupEditorScreen } from "./screens/group-editor-screen";
import { AvatarEditorScreen } from "./screens/avatar-editor-screen";
import { TextEditorScreen } from "./screens/text-editor-screen";
import { LinkEditorScreen } from "./screens/link-editor-screen";
import { TempLinksScreen } from "./screens/temp-links-screen";
import { MembersManageScreen } from "./screens/members-manage-screen";
import { AdminsManageScreen } from "./screens/admins-manage-screen";
import { ConfirmNameDialog } from "./dialogs/confirm-name-dialog";
import { OwnerExitDialog } from "./dialogs/owner-exit-dialog";

export interface GroupProfilePanelProps {
  chat: Chat;
  myId: string | null;
  members: GroupMember[];
  myRole: GroupRole | null;
  isOwner: boolean;
  isAdmin: boolean;
  onClose: () => void;
}

export function GroupProfilePanel({
  chat,
  myId,
  members,
  myRole,
  isOwner,
  isAdmin,
  onClose,
}: GroupProfilePanelProps) {
  const meta = useMemo(() => readGroupMeta(chat), [chat]);

  const [draft, setDraft] = useState<GroupDraftState>({
    name: meta.name,
    description: meta.description,
    username: meta.username,
    bgIndex: 0,
    avatarPreview: null,
  });
  const [stack, setStack] = useState<GroupPanelScreen[]>([]);
  const [dir, setDir] = useState(1);
  const [dialog, setDialog] = useState<"leave" | "ownerExit" | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const current = stack.length ? stack[stack.length - 1] : null;
  const canManage = isOwner || isAdmin;

  const patchDraft = (patch: Partial<GroupDraftState>) => setDraft((d) => ({ ...d, ...patch }));
  const openScreen = (s: GroupPanelScreen) => {
    setDir(1);
    setStack((prev) => [...prev, s]);
  };
  const back = () => {
    setDir(-1);
    setStack((prev) => prev.slice(0, -1));
  };

  const sortedMembers = useMemo(() => {
    const weight: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };
    return [...members].sort(
      (a, b) => weight[a.role] - weight[b.role] || getMemberName(a).localeCompare(getMemberName(b)),
    );
  }, [members]);

  const adminsCount = members.filter((m) => m.role === "admin" || m.role === "owner").length;
  const showAdd = !meta.isPrivate || canManage;

  /* TODO(backend): RPC-заглушки — заменить на реальные вызовы */
  const handleLeave = () => {
    setDialog(null);
    toast.info("Выход из группы — в разработке");
    // await rpc("group_leave", { chatId: meta.id })
  };
  const handleOwnerExit = (mode: "transfer" | "delete", memberId?: string) => {
    setDialog(null);
    toast.info(mode === "delete" ? "Удаление группы — в разработке" : "Передача владельца — в разработке");
    // await rpc(mode === "delete" ? "group_delete" : "group_transfer_owner", { chatId: meta.id, memberId })
  };

  return (
    <ScreenDirectionContext.Provider value={dir}>
      <div className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground">
        {/* плавающие кнопки поверх баннера */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-black/40 backdrop-blur-md transition hover:bg-black/55"
          >
            <TbArrowLeft size={18} />
          </motion.button>
          {canManage && (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => openScreen("editor")}
              title="Редактировать"
              className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-black/40 backdrop-blur-md transition hover:bg-black/55"
            >
              <TbPencil size={16} />
            </motion.button>
          )}
        </div>

        {/* контент панели */}
        <div
          className="scrollbar-hide flex-1 overflow-y-auto"
          onScroll={(e) => setCollapsed(e.currentTarget.scrollTop > 48)}
        >
          <motion.div
            animate={{ height: collapsed ? 190 : 280 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className={cn(
              "relative w-full shrink-0",
              GROUP_BG_PRESETS[draft.bgIndex % GROUP_BG_PRESETS.length],
            )}
          >
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent" />
          </motion.div>

          <div className="relative -mt-12 px-5 pb-8">
            <GroupAvatar
              chat={chat}
              preview={draft.avatarPreview}
              size={84}
              className="rounded-[24px] shadow-xl ring-4 ring-background"
            />
            <h1 className="mt-3 truncate text-[20px] font-bold">{draft.name}</h1>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {formatMembersOnline(meta.membersCount ?? members.length, meta.onlineCount)}
            </p>
            {draft.username && (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => toast.info("Поделиться группой — в разработке")}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-[12px] font-medium text-muted-foreground transition hover:bg-white/10"
              >
                @{draft.username}
                <TbShare2 size={12} />
              </motion.button>
            )}
            {draft.description && (
              <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                {draft.description}
              </p>
            )}

            {/* быстрые действия */}
            <div className="mt-4 flex gap-1 rounded-[20px] bg-muted p-1.5">
              {showAdd && (
                <QuickAction
                  icon={<TbUserPlus size={20} />}
                  label="Добавить"
                  onClick={() => toast.info("Приглашение участников — в разработке")}
                />
              )}
              <QuickAction
                icon={<TbBellOff size={20} />}
                label="Звук"
                onClick={() => toast.info("Настройка звука — в разработке")}
              />
              <QuickAction
                danger
                icon={<TbLogout size={20} />}
                label="Выйти"
                onClick={() => setDialog(isOwner ? "ownerExit" : "leave")}
              />
            </div>

            {/* участники */}
            <div className="flex items-baseline justify-between pb-2 pt-6">
              <h3 className="text-[13px] font-bold">Участники</h3>
              <button
                onClick={() => openScreen("members")}
                className="text-[12px] text-muted-foreground transition hover:text-foreground"
              >
                Все · {members.length}
              </button>
            </div>
            <div className="divide-y divide-white/5 overflow-hidden rounded-[20px] bg-muted">
              {sortedMembers.slice(0, 8).map((m) => (
                <MemberRow key={m.user_id} member={m} />
              ))}
            </div>
          </div>
        </div>

        {/* ─── экраны (стек) ─── */}
        <AnimatePresence custom={dir}>
          {current === "editor" && (
            <GroupEditorScreen
              chat={chat}
              draft={draft}
              membersCount={members.length}
              adminsCount={adminsCount}
              isOwner={isOwner}
              isAdmin={isAdmin}
              onBack={back}
              onNavigate={openScreen}
            />
          )}
          {current === "avatar" && (
            <AvatarEditorScreen chat={chat} draft={draft} onBack={back} onPatch={patchDraft} />
          )}
          {current === "name" && (
            <TextEditorScreen
              title="Название группы"
              value={draft.name}
              placeholder="Название группы"
              maxLength={64}
              onBack={back}
              onSubmit={(v) => {
                patchDraft({ name: v });
                toast.success("Название обновлено");
              }}
            />
          )}
          {current === "description" && (
            <TextEditorScreen
              title="Описание"
              value={draft.description}
              placeholder="Расскажи, о чём группа"
              multiline
              maxLength={500}
              allowEmpty
              submitLabel="Готово"
              onBack={back}
              onSubmit={(v) => {
                patchDraft({ description: v });
                toast.success("Описание обновлено");
              }}
            />
          )}
          {current === "link" && (
            <LinkEditorScreen draft={draft} onBack={back} onPatch={patchDraft} onNavigate={openScreen} />
          )}
          {current === "tempLinks" && <TempLinksScreen onBack={back} />}
          {current === "members" && (
            <MembersManageScreen members={members} myId={myId} canManage={canManage} onBack={back} />
          )}
          {current === "admins" && (
            <AdminsManageScreen members={members} isOwner={isOwner} onBack={back} />
          )}
        </AnimatePresence>

        {/* ─── диалоги ─── */}
        <AnimatePresence>
          {dialog === "leave" && (
            <ConfirmNameDialog
              title="Выйти из группы?"
              description={
                myRole === "admin"
                  ? `Ты администратор — для подтверждения введи название группы «${draft.name}».`
                  : "Ты сможешь вернуться по ссылке или через участников."
              }
              expectedName={myRole === "admin" ? draft.name : null}
              confirmLabel="Выйти"
              danger
              onConfirm={handleLeave}
              onCancel={() => setDialog(null)}
            />
          )}
          {dialog === "ownerExit" && (
            <OwnerExitDialog
              groupName={draft.name}
              members={members.filter((m) => m.role !== "owner")}
              onConfirm={handleOwnerExit}
              onCancel={() => setDialog(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </ScreenDirectionContext.Provider>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-center gap-1.5 rounded-2xl py-2.5 transition",
        danger ? "text-red-400 hover:bg-red-500/10" : "hover:bg-white/5",
      )}
    >
      {icon}
      <span className="text-[11px] font-medium">{label}</span>
    </motion.button>
  );
}

function MemberRow({ member }: { member: GroupMember }) {
  const role: GroupRole = member.role ?? "member";
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="relative shrink-0">
        <MemberAvatar member={member} size={38} />
        {isMemberOnline(member) && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-muted bg-emerald-500" />
        )}
      </div>
      <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{getMemberName(member)}</p>
      <span
        className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", ROLE_BADGE_CLASS[role])}
      >
        {ROLE_LABEL[role]}
      </span>
    </div>
  );
}
