"use client";

/**
 * Универсальный экран ввода текста: название группы / описание.
 * Сохранение — кнопкой в шапке (или Enter для однострочного поля).
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ScreenShell } from "../screen-shell";

interface TextEditorScreenProps {
  title: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  submitLabel?: string;
  /** описание можно сохранить пустым, название — нет */
  allowEmpty?: boolean;
  onBack: () => void;
  onSubmit: (value: string) => void;
}

export function TextEditorScreen({
  title,
  value,
  placeholder,
  multiline,
  maxLength,
  submitLabel = "Сохранить",
  allowEmpty = false,
  onBack,
  onSubmit,
}: TextEditorScreenProps) {
  const [val, setVal] = useState(value);
  const canSave = allowEmpty || val.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
    onSubmit(multiline ? val.trim() : val.trim().slice(0, maxLength ?? 64));
  };

  return (
    <ScreenShell
      title={title}
      onBack={onBack}
      right={
        <button
          onClick={submit}
          disabled={!canSave}
          className={cn(
            "text-[14px] font-semibold transition",
            canSave ? "text-primary hover:opacity-80" : "text-muted-foreground/50",
          )}
        >
          {submitLabel}
        </button>
      }
    >
      <div className="px-5 pb-4 pt-3">
        {multiline ? (
          <textarea
            autoFocus
            value={val}
            maxLength={maxLength}
            rows={5}
            placeholder={placeholder}
            onChange={(e) => setVal(e.target.value)}
            className="w-full resize-none rounded-2xl bg-muted p-4 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
          />
        ) : (
          <input
            autoFocus
            value={val}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full rounded-2xl bg-muted px-4 py-3.5 text-[15px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
          />
        )}
        {maxLength != null && (
          <p className="mt-2 text-right text-[11px] text-muted-foreground">
            {val.length}/{maxLength}
          </p>
        )}
      </div>
    </ScreenShell>
  );
}
