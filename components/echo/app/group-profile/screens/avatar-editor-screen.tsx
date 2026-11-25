"use client";

/**
 * Экран «Аватар и фон»: загрузка фото группы + пресеты фона баннера.
 * Открытие: тап по аватарке в меню редактора.
 */
import type { ChangeEvent } from "react";
import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { TbCheck, TbLoader2, TbPhotoUp } from "react-icons/tb";
import { cn } from "@/lib/utils";
import type { Chat } from "@/hooks/echo/types";
import { ScreenShell, SectionTitle } from "../screen-shell";
import { GroupAvatar } from "../group-avatar";
import { GROUP_BG_PRESETS, type GroupDraftState } from "../lib/group-profile-utils";

interface AvatarEditorScreenProps {
  chat: Chat;
  draft: GroupDraftState;
  onBack: () => void;
  onPatch: (patch: Partial<GroupDraftState>) => void;
  /** Загрузка + перешифрование метаданных группы (RPC). */
  onSaveAvatar: (file: File) => Promise<void>;
}

export function AvatarEditorScreen({ chat, draft, onBack, onPatch, onSaveAvatar }: AvatarEditorScreenProps) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploading) return;
    const preview = URL.createObjectURL(file);
    onPatch({ avatarPreview: preview });
    setUploading(true);
    try {
      await onSaveAvatar(file);
      onPatch({ avatarPreview: null });
    } catch {
      // Текст ошибки показан в GroupProfilePanel; возвращаем старый аватар.
      onPatch({ avatarPreview: null });
    } finally {
      URL.revokeObjectURL(preview);
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <ScreenShell title="Аватар и фон" onBack={onBack}>
      <div className="flex flex-col items-center pt-4">
        <GroupAvatar
          chat={chat}
          preview={draft.avatarPreview}
          size={112}
          className="rounded-[32px] shadow-xl ring-4 ring-background"
        />
        <label
          className={cn(
            "mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-bold text-primary-foreground transition hover:opacity-90",
            uploading && "pointer-events-none opacity-60",
          )}
        >
          {uploading ? <TbLoader2 size={16} className="animate-spin" /> : <TbPhotoUp size={16} />}
          {uploading ? "Загрузка…" : "Загрузить фото"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => void handleFile(e)}
          />
        </label>
        {draft.avatarPreview && !uploading && (
          <button
            onClick={() => onPatch({ avatarPreview: null })}
            className="mt-2 text-[12px] text-muted-foreground transition hover:text-foreground"
          >
            Сбросить предпросмотр
          </button>
        )}
      </div>

      <SectionTitle>Фон баннера</SectionTitle>
      <div className="grid grid-cols-3 gap-3 px-5">
        {GROUP_BG_PRESETS.map((preset, i) => (
          <motion.button
            key={preset}
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              onPatch({ bgIndex: i });
              toast.success("Фон обновлён (локально)");
            }}
            className={cn(
              "relative h-16 rounded-2xl transition",
              preset,
              draft.bgIndex === i
                ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                : "opacity-80 hover:opacity-100",
            )}
          >
            {draft.bgIndex === i && <TbCheck size={16} className="absolute right-2 top-2 text-white" />}
          </motion.button>
        ))}
      </div>
      <p className="px-5 pb-4 pt-3 text-[11px] leading-relaxed text-muted-foreground">
        Фото группы сохраняется на сервере в зашифрованном виде. Фон баннера пока применяется только на этом устройстве.
      </p>
    </ScreenShell>
  );
}
