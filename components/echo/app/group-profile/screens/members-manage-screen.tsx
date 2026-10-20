"use client";

/**
 * Управление участниками: поиск по всем, бейджи ролей, онлайн-точка.
 * Для тех, кто может управлять (owner/admin) — меню «…» у строки:
 * сделать админом / разжаловать / удалить из группы.
 * Открытие: панель («Все · N») или редактор (папка «Управление»).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { TbDots, TbSearch, TbShieldCheck, TbUserMinus } from "react-icons/tb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { GroupMember, GroupRole } from "@/hooks/echo/types";
import { ScreenShell } from "../screen-shell";
import { MemberAvatar } from "../group-avatar";
import {
  ROLE_BADGE_CLASS,
  ROLE_LABEL,
  getMemberName,
  isMemberOnline,
} from "../lib/group-profile-utils";

interface MembersManageScreenProps {
  members: GroupMember[];
  myId: string | null;
  canManage: boolean;
  onBack: () => void;
}

export function MembersManageScreen({ members, myId, canManage, onBack }: MembersManageScreenProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? members.filter((m) => getMemberName(m).toLowerCase().includes(q))
      : members;
    const weight: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };
    return [...list].sort((a, b) => weight[a.role] - weight[b.role]);
  }, [members, query]);

  // TODO(backend): вместо toast дергать:
  //   useGroupMembers().setAdmin(chatId, memberId, true|false)
  //   useGroupMembers().removeMember(chatId, memberId)
  const dev = (label: string) => toast.info(`${label} — в разработке`);

  return (
    <ScreenShell title="Участники" onBack={onBack}>
      <div className="px-5 pb-3">
        <div className="relative">
          <TbSearch size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск участника"
            className="w-full rounded-2xl bg-muted py-2.5 pl-10 pr-4 text-[14px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>
      <p className="px-5 pb-2 text-[12px] text-muted-foreground">
        {filtered.length} из {members.length}
      </p>

      <div className="mx-5 divide-y divide-white/5 overflow-hidden rounded-[20px] bg-muted">
        {filtered.map((m) => {
          const role: GroupRole = m.role ?? "member";
          const isSelf = m.user_id === myId;
          const manageable = canManage && role !== "owner" && !isSelf;
          return (
            <div key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="relative shrink-0">
                <MemberAvatar member={m} size={38} />
                {isMemberOnline(m) && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-muted bg-emerald-500" />
                )}
              </div>
              <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{getMemberName(m)}</p>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  ROLE_BADGE_CLASS[role],
                )}
              >
                {ROLE_LABEL[role]}
              </span>
              {manageable && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-white/5 hover:text-foreground">
                      <TbDots size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="rounded-2xl border-white/10 bg-background/95 p-2 backdrop-blur-3xl"
                  >
                    {role === "member" ? (
                      <DropdownMenuItem onClick={() => dev("Назначение админом")} className="gap-2">
                        <TbShieldCheck size={15} />
                        Сделать админом
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => dev("Разжалование")} className="gap-2">
                        <TbShieldCheck size={15} />
                        Разжаловать в участники
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => dev("Удаление из группы")}
                      className="gap-2 text-red-400 focus:bg-red-500/10 focus:text-red-400"
                    >
                      <TbUserMinus size={15} />
                      Удалить из группы
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Никого не нашлось</p>
        )}
      </div>
    </ScreenShell>
  );
}
