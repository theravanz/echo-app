"use client";

import { useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { TbCheck as Check, TbUpload as Upload } from "react-icons/tb";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { ChatWallpaper, type WallpaperPreset } from "./chat-wallpaper";

const PRESETS: { key: WallpaperPreset; label: string }[] = [
  { key: "solid", label: "Тёмный" },
  { key: "doodle", label: "Узор" },
  { key: "photo", label: "Своё фото" },
];

export function ChatBackgroundPicker({
  open,
  onClose,
  chatId,
  accentColor,
  current,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  chatId: string;
  accentColor: string;
  current: { preset: WallpaperPreset; photoUrl: string | null };
  onChange: (next: { preset: WallpaperPreset; photoUrl: string | null }) => void;
}) {
  const [preset, setPreset] = useState<WallpaperPreset>(current.preset);
  const [photoUrl, setPhotoUrl] = useState<string | null>(current.photoUrl);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const y = useMotionValue(0);
  const sheetY = useTransform(y, [0, 400], [0, 400]);
  const backdropOpacity = useTransform(y, [0, 400], [0.6, 0]);

  function handleDragEnd(_: any, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
    else y.set(0);
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const path = `${chatId}/wallpaper-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("chat-wallpapers").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("chat-wallpapers").getPublicUrl(path);
      setPhotoUrl(data.publicUrl);
      setPreset("photo");
    } catch (err) {
      console.error(err);
      toast.error("Не удалось загрузить фото");
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("chats")
        .update({ wallpaper_preset: preset, wallpaper_photo_url: preset === "photo" ? photoUrl : null })
        .eq("id", chatId);
      if (error) throw error;
      onChange({ preset, photoUrl: preset === "photo" ? photoUrl : null });
      toast.success("Фон обновлён");
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("Не удалось сохранить фон");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          className="fixed inset-0 z-50 flex items-end justify-center"
        >
          <motion.div style={{ opacity: backdropOpacity }} className="absolute inset-0 bg-black" onClick={onClose} />
          <motion.div
            style={{ y: sheetY }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.15}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 35, stiffness: 300, mass: 0.8 }}
            className="relative w-full max-w-lg bg-[#1c1c1e] rounded-t-3xl overflow-hidden"
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
            <div className="px-5 pb-4 border-b border-white/5">
              <h2 className="text-lg font-bold">Фон чата</h2>
            </div>

            <div className="p-5 space-y-4">
              <div className="relative h-40 rounded-2xl overflow-hidden">
                <ChatWallpaper preset={preset} accentColor={accentColor} photoUrl={photoUrl} />
              </div>

              <div className="flex gap-2.5">
                {PRESETS.map((p) => (
                  <motion.button
                    key={p.key}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => (p.key === "photo" ? fileInputRef.current?.click() : setPreset(p.key))}
                    className={cn2(
                      "flex-1 py-3 rounded-2xl text-xs font-semibold border flex items-center justify-center gap-1.5",
                      preset === p.key ? "border-primary bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-white/60"
                    )}
                  >
                    {p.key === "photo" && preset === "photo" ? <Check className="w-3.5 h-3.5" /> : p.key === "photo" ? <Upload className="w-3.5 h-3.5" /> : null}
                    {p.label}
                  </motion.button>
                ))}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoSelect} />

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleSave}
                disabled={saving}
                className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? "Сохраняю..." : "Применить"}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// local alias to avoid importing the shared `cn` just for this file's one use-site name clash risk
function cn2(...args: (string | false | undefined)[]) {
  return args.filter(Boolean).join(" ");
}
