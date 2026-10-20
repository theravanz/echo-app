"use client";

/**
 * Управление администраторами (папка «Управление» в редакторе).
 *  • Список: владелец + назначенные админы
 *  • Назначать может только владелец — секция «Назначить из участников»
 */
import { toast } from "sonner";
import type { GroupMember } from "@/hooks/echo/types";
import { ScreenShell, SectionTitle } from "../screen-shell";
import { MemberAvatar } from "../group-avatar";
import {
  ROLE_BADGE_CLASS,
  ROLE_LABEL,
  getMemberName,
} from "../lib/group-profile-utils";
import { cn } from "@/lib/utils";

interface AdminsManageScreenProps {
  members: GroupMember[];
  isOwner: boolean;
  onBack: () => void;
}

export function AdminsManageScreen({ members, isOwner, onBack }: AdminsManageScreenProps) {
  const admins = members.filter((m) => m.role === "owner" || m.role === "admin");
  const candidates = members.filter((m) => m.role === "member");

  // TODO(backend): useGroupMembers().setAdmin(chatId, memberId, true)
  const assign = () => toast.info("Назначение администратора — в разработке");

  return (
    <ScreenShell title="Администраторы" onBack={onBack}>
      <SectionTitle>Администраторы</SectionTitle>
      <div className="mx-5 divide-y divide-white/5 overflow-hidden rounded-[20px] bg-muted">
        {admins.map((m) => (
          <div key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
            <MemberAvatar member={m} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{getMemberName(m)}</p>
              <p className="text-[12px] text-muted-foreground">
                {m.role === "owner" ? "Полные права на группу" : "Все права · тонкая настройка скоро"}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                ROLE_BADGE_CLASS[m.role],
              )}
            >
              {ROLE_LABEL[m.role]}
            </span>
          </div>
        ))}
      </div>

      {isOwner ? (
        <>
          <SectionTitle>Назначить из участников</SectionTitle>
          <div className="mx-5 divide-y divide-white/5 overflow-hidden rounded-[20px] bg-muted">
            {candidates.map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
                <MemberAvatar member={m} size={38} />
                <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{getMemberName(m)}</p>
                <button
                  onClick={assign}
                  className="shrink-0 rounded-full bg-primary/15 px-3.5 py-1.5 text-[12px] font-semibold text-primary transition hover:bg-primary/25"
                >
                  Назначить
                </button>
              </div>
            ))}
            {candidates.length === 0 && (
              <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                Все участники уже администраторы
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="px-5 pt-4 text-[12px] text-muted-foreground">
          Назначать администраторов может только владелец группы.
        </p>
      )}
    </ScreenShell>
  );
}
