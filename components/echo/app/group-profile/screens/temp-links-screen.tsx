"use client";

/**
 * Временные ссылки — экран в разработке.
 * Планируется: генерация кода из случайных символов, полное управление
 * (статистика переходов, срок действия, удаление).
 * Сейчас доступен только предпросмотр генерации кода.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { TbLinkPlus } from "react-icons/tb";
import { ScreenShell } from "../screen-shell";
import { ECHO_LINK_PREFIX, randomLinkCode } from "../lib/group-profile-utils";

interface TempLinksScreenProps {
  onBack: () => void;
}

export function TempLinksScreen({ onBack }: TempLinksScreenProps) {
  const [preview, setPreview] = useState<string | null>(null);

  const create = () => {
    setPreview(randomLinkCode(10));
    toast.info("Это предпросмотр — сохранение скоро будет доступно");
  };

  return (
    <ScreenShell title="Временные ссылки" onBack={onBack}>
      <div className="mx-5 mt-2 rounded-[20px] bg-muted p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/5 text-muted-foreground">
          <TbLinkPlus size={22} />
        </span>
        <h3 className="mt-3 text-[15px] font-bold">В разработке</h3>
        <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">
          Временные ссылки будут генерироваться из случайных символов. Ты сможешь полностью
          управлять ими: смотреть статистику переходов, задавать срок действия и удалять.
        </p>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={create}
          className="mt-4 rounded-full bg-primary px-5 py-2.5 text-[13px] font-bold text-primary-foreground transition hover:opacity-90"
        >
          Создать временную ссылку
        </motion.button>
      </div>

      {preview && (
        <div className="mx-5 mt-3 rounded-[20px] border border-dashed border-white/15 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-[13px]">
              {ECHO_LINK_PREFIX}i/{preview}
            </p>
            <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">
              Предпросмотр
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Не сохранён. Статистика и срок действия появятся вместе с релизом.
          </p>
        </div>
      )}
    </ScreenShell>
  );
}
