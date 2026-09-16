"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import {
  TbChevronLeft as ChevronLeft,
  TbChevronRight as ChevronRight,
  TbCamera as Camera,
  TbPalette as Palette,
  TbCheck as Check,
  TbMusic as Music,
  TbPencil as Pen,
  TbSpeakerphone as Megaphone,
  TbX as X,
  TbUpload as Upload,
  TbAt as At,
  TbPlus as Plus,
  TbCalendar as Calendar,
  TbTrash as Trash2,
  TbPhoto as ImageIcon,
  TbPlayerPlay as PlayIcon,
  TbGift as GiftIcon,
  TbSparkles as StoriesIcon,
  TbMessageCircle as MessageCircle,
  TbPhone as Phone,
  TbVideo as Video,
  TbBell as Bell,
  TbBellOff as BellOff,
  TbQrcode as QrCode,
  TbDotsVertical as MoreVertical,
  TbFlag as Flag,
  TbBan as Ban,
  TbPencil as Edit,
  TbShare2,
} from "react-icons/tb";
import { cn, safeChar } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import * as mm from "music-metadata";
import { base64ToBytes, compressAvatar, compressImage, encryptBlob } from "@/lib/media";
import { useSecureMediaUrl } from "@/hooks/echo/use-secure-media";
import { SecureImage } from "./secure-image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/* ============================================================= */
/*  Types                                                         */
/* ============================================================= */

export interface EditableProfile {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  avatar_color?: string | null;
  avatar_storage_path?: string | null;
  avatar_nonce?: string | null;
  avatar_mime?: string | null;
  bio: string | null;
  background: string | null;
  status_emoji: string | null;
  birth_date?: string | null;
  birth_date_hide_year?: boolean;
  activity_type: "music" | "custom" | null;
  activity_title: string | null;
  activity_subtitle: string | null;
  activity_cover_url?: string | null;
  activity_file_url?: string | null;
  activity_cover_path?: string | null;
  activity_cover_nonce?: string | null;
  activity_gradient?: string | null;
  share_listening_activity: boolean;
  channel_id?: string | null;
  channel_name?: string | null;
  channel_username?: string | null;
  channel_subscribers?: number | null;
  is_online?: boolean;
  last_seen_label?: string | null;
}

interface UserTrack {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  file_url: string;
  gradient: string | null;
  audio_path: string;
  cover_path: string | null;
  audio_nonce?: string | null;
  cover_nonce?: string | null;
  cover_mime?: string | null;
}

interface Channel {
  id: string;
  name: string;
  username: string;
  avatar_url: string | null;
  subscribers_count: number;
}

interface UserPublication {
  id: string;
  media_type: "image" | "video";
  media_url: string;
  thumbnail_url: string | null;
  storage_path: string;
  media_nonce?: string | null;
  thumbnail_nonce?: string | null;
  media_mime?: string | null;
}

interface UserGift {
  id: string;
  emoji: string;
  name: string;
}

interface UserStory {
  id: string;
  media_url: string;
  media_type: "image" | "video";
  storage_path: string;
  media_nonce?: string | null;
  media_mime?: string | null;
}

/* ============================================================= */
/*  Constants                                                     */
/* ============================================================= */

const BACKGROUND_PRESETS = [
  { key: "violet", css: "radial-gradient(circle at 25% 20%,#4a3d8f,transparent 55%),radial-gradient(circle at 75% 70%,#2a2440,transparent 60%),#0d0d14", label: "Фиолетовый" },
  { key: "teal", css: "radial-gradient(circle at 70% 20%,#1a4a4a,transparent 55%),radial-gradient(circle at 20% 80%,#123028,transparent 60%),#0a1614", label: "Бирюзовый" },
  { key: "rose", css: "radial-gradient(circle at 30% 70%,#5a2a3a,transparent 55%),radial-gradient(circle at 80% 20%,#2a1420,transparent 60%),#150a10", label: "Розовый" },
  { key: "amber", css: "radial-gradient(circle at 50% 30%,#4a3a1a,transparent 55%),radial-gradient(circle at 20% 80%,#2a2010,transparent 60%),#14100a", label: "Янтарный" },
];

const BACKGROUND_MAP: Record<string, string> = Object.fromEntries(BACKGROUND_PRESETS.map((p) => [p.key, p.css]));

const STATUS_EMOJIS = ["🩵", "🔥", "⭐", "🎧", "🌙", "✨"];

const MONTHS = ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"];

const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear();

/* ============================================================= */
/*  Helpers                                                       */
/* ============================================================= */

function resolveBackground(bg: string | null) {
  if (!bg) return BACKGROUND_PRESETS[0].css;
  if (BACKGROUND_MAP[bg]) return BACKGROUND_MAP[bg];
  if (bg.startsWith("http")) return `url(${bg}) center/cover`;
  return bg;
}

function validateUsername(u: string): { valid: boolean; error?: string } {
  if (!u) return { valid: true };
  if (u.length < 3) return { valid: false, error: "Минимум 3 символа" };
  if (u.length > 20) return { valid: false, error: "Максимум 20 символов" };
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return { valid: false, error: "Только буквы, цифры и _" };
  return { valid: true };
}

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function parseBirthDate(dateStr: string | null): { day: number; month: number; year: number } | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() };
}

function formatBirthDate(day: number, month: number, year: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatBirthDateDisplay(dateStr: string | null, hideYear?: boolean): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();

  if (hideYear) {
    return `${day} ${month}`;
  }
  return `${day} ${month} ${year}`;
}

function calculateAge(birthDate: string): number | null {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age > 0 ? age : null;
}

async function extractAudioMetadata(file: File): Promise<{ title: string; artist: string; coverDataUrl: string | null }> {
  try {
    const metadata = await mm.parseBlob(file);
    const title = metadata.common.title || file.name.replace(/\.[^/.]+$/, "");
    const artist = metadata.common.artist || "Неизвестный исполнитель";
    let coverDataUrl: string | null = null;

    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      const copy = new Uint8Array(pic.data.length);
      copy.set(pic.data);
      const blob = new Blob([copy as BlobPart], { type: pic.format });
      coverDataUrl = URL.createObjectURL(blob);
    }

    return { title, artist, coverDataUrl };
  } catch (err) {
    console.error("Metadata extraction failed:", err);
    return { title: file.name.replace(/\.[^/.]+$/, ""), artist: "Неизвестный исполнитель", coverDataUrl: null };
  }
}

function averageColorFromImage(url: string): Promise<{ r: number; g: number; b: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        resolve({ r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function gradientFromColor(c: { r: number; g: number; b: number } | null): string {
  if (!c) return BACKGROUND_PRESETS[0].css;
  const light = `rgb(${Math.min(255, c.r + 35)}, ${Math.min(255, c.g + 35)}, ${Math.min(255, c.b + 35)})`;
  const dark = `rgb(${Math.round(c.r * 0.4)}, ${Math.round(c.g * 0.4)}, ${Math.round(c.b * 0.4)})`;
  return `linear-gradient(135deg, ${light}, ${dark})`;
}

/* ============================================================= */
/*  iOS-style Date Picker                                          */
/* ============================================================= */

const WHEEL_HEIGHT = 256;
const ITEM_HEIGHT = 40;
const WHEEL_PADDING = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

function DatePickerSheet({
  open,
  onClose,
  onSelect,
  initialDate,
  hideYear,
  onHideYearToggle,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (date: string) => void;
  initialDate: string | null;
  hideYear: boolean;
  onHideYearToggle: () => void;
}) {
  const initial = parseBirthDate(initialDate);
  const [selectedDay, setSelectedDay] = useState(initial?.day || 1);
  const [selectedMonth, setSelectedMonth] = useState(initial?.month || 1);
  const [selectedYear, setSelectedYear] = useState<number | string>(initial?.year || MAX_YEAR);

  const daysInMonth = getDaysInMonth(selectedMonth, typeof selectedYear === 'number' ? selectedYear : 2024);
  const days = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const years: string[] = ["—", ...Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => String(MAX_YEAR - i))];

  const y = useMotionValue(0);
  const sheetY = useTransform(y, [0, 400], [0, 400]);
  const backdropOpacity = useTransform(y, [0, 400], [0.6, 0]);

  function handleDragEnd(_: any, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
    else y.set(0);
  }

  function handleConfirm() {
    if (selectedYear === "—") {
      const dateStr = formatBirthDate(selectedDay, selectedMonth, 2000);
      if (!hideYear) onHideYearToggle();
      onSelect(dateStr);
    } else {
      onSelect(formatBirthDate(selectedDay, selectedMonth, Number(selectedYear)));
    }
    onClose();
  }

  useEffect(() => {
    if (selectedDay > daysInMonth) setSelectedDay(daysInMonth);
  }, [daysInMonth, selectedDay]);

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
            className="relative w-full max-w-lg bg-background rounded-t-3xl overflow-hidden"
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between px-5 pb-4 border-b border-white/5">
              <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} className="text-primary font-semibold text-sm">
                Отмена
              </motion.button>
              <h2 className="text-lg font-bold">Дата рождения</h2>
              <motion.button whileTap={{ scale: 0.9 }} onClick={handleConfirm} className="text-primary font-semibold text-sm">
                Готово
              </motion.button>
            </div>

            <div className="flex relative" style={{ height: WHEEL_HEIGHT }}>
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 bg-white/5 pointer-events-none rounded-lg mx-2" />
              <div className="absolute inset-x-0 top-1/2 -translate-y-[calc(50%+20px)] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
              <div className="absolute inset-x-0 top-1/2 -translate-y-[calc(50%-20px)] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />

              <ScrollColumn
                items={days}
                selectedIndex={selectedDay - 1}
                onSelect={(idx) => setSelectedDay(idx + 1)}
                format={(d) => String(d)}
              />
              <ScrollColumn
                items={months}
                selectedIndex={selectedMonth - 1}
                onSelect={(idx) => setSelectedMonth(idx + 1)}
                format={(m) => MONTHS[Number(m) - 1]}
              />
              <ScrollColumn
                items={years}
                selectedIndex={selectedYear === "—" ? 0 : years.indexOf(String(selectedYear))}
                onSelect={(idx) => {
                  const val = years[idx];
                  setSelectedYear(val === "—" ? "—" : Number(val));
                }}
                format={(yy) => String(yy)}
                hideColumn={hideYear}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScrollColumn({
  items,
  selectedIndex,
  onSelect,
  format,
  hideColumn = false,
}: {
  items: any[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  format: (item: any) => string;
  hideColumn?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);
  const scrollTimeout = useRef<number | null>(null);

  useEffect(() => {
    if (containerRef.current && !isScrolling.current) {
      containerRef.current.scrollTo({ top: selectedIndex * ITEM_HEIGHT, behavior: "auto" });
    }
  }, [selectedIndex]);

  function handleScroll() {
    if (!containerRef.current) return;
    isScrolling.current = true;
    if (scrollTimeout.current !== null) window.clearTimeout(scrollTimeout.current);

    const scrollTop = containerRef.current.scrollTop;
    const index = Math.round(scrollTop / ITEM_HEIGHT);

    scrollTimeout.current = window.setTimeout(() => {
      isScrolling.current = false;
      if (index >= 0 && index < items.length) {
        onSelect(index);
        containerRef.current?.scrollTo({ top: index * ITEM_HEIGHT, behavior: "smooth" });
      }
    }, 150);

    if (index >= 0 && index < items.length) onSelect(index);
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto scrollbar-hide"
        style={{ scrollSnapType: "y mandatory", WebkitOverflowScrolling: "touch" }}
      >
        <div style={{ height: WHEEL_PADDING }} />
        {items.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center justify-center text-sm font-medium transition-all duration-150"
            style={{
              height: ITEM_HEIGHT,
              scrollSnapAlign: "center",
              opacity: idx === selectedIndex ? 1 : 0.35,
              transform: `scale(${idx === selectedIndex ? 1.1 : 1})`,
              color: idx === selectedIndex ? "#ffffff" : "#8e8e93",
            }}
          >
            {format(item)}
          </div>
        ))}
        <div style={{ height: WHEEL_PADDING }} />
      </div>
    </div>
  );
}

/* ============================================================= */
/*  Track Picker Sheet                                             */
/* ============================================================= */

function TrackListItem({ track, onSelect, onDelete }: { track: UserTrack; onSelect: () => void; onDelete: () => void }) {
  const x = useMotionValue(0);
  const deleteOpacity = useTransform(x, [-80, -20], [1, 0]);
  const [confirming, setConfirming] = useState(false);

  // Обложка зашифрована -> резолвим blob: URL из приватного bucket (с кэшем).
  const secureCover = useSecureMediaUrl(
    "tracks",
    track.cover_path,
    track.cover_nonce,
    track.cover_mime || "image/webp",
    Boolean(track.cover_path && !track.cover_url),
  );
  const coverSrc = track.cover_url || secureCover;

  function handleDragEnd(_: any, info: PanInfo) {
    if (info.offset.x < -80) {
      setConfirming(true);
      x.set(-88);
    } else {
      x.set(0);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <motion.div style={{ opacity: deleteOpacity }} className="absolute inset-y-0 right-0 w-20 flex items-center justify-center bg-red-500/90">
        <button onClick={() => onDelete()} className="flex flex-col items-center gap-1 text-foreground">
          <Trash2 className="w-4 h-4" />
          <span className="text-[10px] font-semibold">Удалить</span>
        </button>
      </motion.div>

      <motion.button
        drag="x"
        dragConstraints={{ left: -88, right: 0 }}
        dragElastic={0.05}
        dragMomentum={false}
        style={{ x }}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (confirming) {
            x.set(0);
            setConfirming(false);
            return;
          }
          onSelect();
        }}
        whileTap={{ scale: confirming ? 1 : 0.97 }}
        className="relative w-full flex items-center gap-3 p-2 bg-background text-left"
      >
        <div className="w-14 h-14 rounded-xl shrink-0 overflow-hidden flex items-center justify-center" style={{ background: track.gradient || BACKGROUND_PRESETS[0].css }}>
          {coverSrc ? <img src={coverSrc} className="w-full h-full object-cover" alt="" /> : <Music className="w-6 h-6 text-muted-foreground/80" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{track.title}</div>
          <div className="text-xs text-muted-foreground/50 truncate">{track.artist}</div>
        </div>
      </motion.button>
    </div>
  );
}

function TrackPickerSheet({
  open,
  onClose,
  onSelect,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (track: UserTrack) => void;
  userId: string;
}) {
  const [tracks, setTracks] = useState<UserTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const y = useMotionValue(0);
  const sheetY = useTransform(y, [0, 400], [0, 400]);
  const backdropOpacity = useTransform(y, [0, 400], [0.6, 0]);

  useEffect(() => {
    if (!open) return;
    loadTracks();
  }, [open, userId]);

  async function loadTracks() {
    setLoading(true);
    const { data } = await supabase.from("user_tracks").select("*").eq("owner_id", userId).order("created_at", { ascending: false });
    setTracks(data ?? []);
    setLoading(false);
  }

  function handleDragEnd(_: any, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
    else y.set(0);
  }

  async function handleAudioSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    setExtracting(true);
    const metadata = await extractAudioMetadata(file);
    setTitle(metadata.title);
    setArtist(metadata.artist);
    setCoverPreview(metadata.coverDataUrl);
    setCoverFile(null);
    setExtracting(false);
  }

  function handleCustomCoverSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  function resetUploadForm() {
    setAudioFile(null);
    setTitle("");
    setArtist("");
    setCoverPreview(null);
    setCoverFile(null);
    setShowUploadForm(false);
  }

  async function handleUpload() {
    if (!title || !audioFile) {
      toast.error("Нужны название и сам файл");
      return;
    }
    setUploading(true);

    try {
      // === Аудио: шифруем до загрузки, грузим конверт в приватный bucket ===
      const audioEnv = await encryptBlob(audioFile);
      const audio_path = `${userId}/track-${Date.now()}.enc`;
      const { error: audioErr } = await supabase.storage
        .from("tracks")
        .upload(
          audio_path,
          new Blob([base64ToBytes(audioEnv.data) as unknown as BlobPart], { type: "application/octet-stream" }),
          { upsert: true, contentType: "application/octet-stream" },
        );
      if (audioErr) throw audioErr;

      let cover_path: string | null = null;
      let cover_nonce: string | null = null;
      let compressedCover: Blob | null = null;

      if (coverPreview) {
        const blob = coverFile ?? (await (await fetch(coverPreview)).blob());
        // Обложка: лёгкое сжатие + шифрование.
        compressedCover = await compressImage(blob, { maxSize: 1000, quality: 0.82 });
        const coverEnv = await encryptBlob(compressedCover);
        cover_path = `${userId}/cover-${Date.now()}.enc`;
        const { error: coverErr } = await supabase.storage
          .from("tracks")
          .upload(
            cover_path,
            new Blob([base64ToBytes(coverEnv.data) as unknown as BlobPart], { type: "application/octet-stream" }),
            { upsert: true, contentType: "application/octet-stream" },
          );
        if (!coverErr) cover_nonce = coverEnv.nonce;
      }

      // Средний цвет для градиента считаем по локальному blob (без публичного URL).
      let avgColor: { r: number; g: number; b: number } | null = null;
      if (compressedCover && cover_path) {
        avgColor = await averageColorFromImage(URL.createObjectURL(compressedCover));
      }
      const gradient = gradientFromColor(avgColor);

      const { data: inserted, error: insertErr } = await supabase
        .from("user_tracks")
        .insert({
          owner_id: userId,
          title,
          artist,
          file_url: null,
          cover_url: null,
          gradient,
          audio_path,
          cover_path,
          audio_nonce: audioEnv.nonce,
          cover_nonce,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      setTracks((prev) => [inserted, ...prev]);
      resetUploadForm();
      toast.success("Трек добавлен");
    } catch (err) {
      console.error(err);
      toast.error("Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteTrack(track: UserTrack) {
    const paths = [track.audio_path, track.cover_path].filter(Boolean) as string[];
    setTracks((prev) => prev.filter((t) => t.id !== track.id));
    try {
      if (paths.length) await supabase.storage.from("tracks").remove(paths);
      await supabase.from("user_tracks").delete().eq("id", track.id);
      toast.success("Трек удалён");
    } catch (err) {
      console.error(err);
      toast.error("Не удалось удалить — попробуй ещё раз");
      loadTracks();
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
            style={{ y: sheetY, willChange: "transform" }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.15}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 35, stiffness: 300, mass: 0.8 }}
            className="relative w-full max-w-lg bg-background rounded-t-3xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between px-5 pb-4 border-b border-white/5">
              <h2 className="text-lg font-bold">Выбор трека</h2>
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowUploadForm((v) => !v)} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </motion.button>
            </div>

            <AnimatePresence>
              {showUploadForm && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", damping: 30, stiffness: 300 }}
                  className="overflow-hidden border-b border-white/5"
                >
                  <div className="p-5 space-y-3">
                    <label className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 cursor-pointer">
                      <Music className="w-4 h-4 text-muted-foreground/50" />
                      <span className="text-sm text-foreground/80 truncate flex-1">{audioFile?.name || "Выбрать файл трека"}</span>
                      <input type="file" accept="audio/*" hidden onChange={handleAudioSelect} />
                    </label>

                    {extracting && <div className="text-xs text-muted-foreground/40 text-center">Считываю метаданные...</div>}

                    {audioFile && !extracting && (
                      <>
                        <input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Название трека"
                          className="w-full bg-white/5 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/30"
                        />
                        <input
                          value={artist}
                          onChange={(e) => setArtist(e.target.value)}
                          placeholder="Исполнитель"
                          className="w-full bg-white/5 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/30"
                        />

                        <div className="flex items-center gap-3">
                          <div className="w-16 h-16 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center shrink-0">
                            {coverPreview ? <img src={coverPreview} className="w-full h-full object-cover" alt="" /> : <ImageIcon className="w-5 h-5 text-muted-foreground/20" />}
                          </div>
                          <div className="flex-1">
                            <div className="text-xs text-muted-foreground/50 mb-1.5">
                              {coverPreview ? (coverFile ? "Своя обложка" : "Обложка найдена в файле") : "Обложка не найдена"}
                            </div>
                            <button onClick={() => coverInputRef.current?.click()} className="text-xs font-semibold text-primary">
                              {coverPreview ? "Заменить обложку" : "Загрузить обложку"}
                            </button>
                            <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCustomCoverSelect} />
                          </div>
                        </div>
                      </>
                    )}

                    <div className="flex gap-2">
                      <motion.button whileTap={{ scale: 0.97 }} onClick={resetUploadForm} className="flex-1 h-11 rounded-xl bg-white/5 text-sm font-semibold">
                        Отмена
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={handleUpload}
                        disabled={uploading || !audioFile}
                        className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {uploading ? "Загрузка..." : (<><Upload className="w-4 h-4" /> Загрузить</>)}
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground/40 text-sm">Загрузка...</div>
              ) : tracks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground/40 text-sm gap-2">
                  <Music className="w-8 h-8" />
                  <p>У тебя пока нет треков</p>
                  <p className="text-xs">Нажми + чтобы добавить</p>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground/30 px-2 pb-1">Свайпни трек влево, чтобы удалить</p>
                  {tracks.map((track) => (
                    <TrackListItem key={track.id} track={track} onSelect={() => { onSelect(track); onClose(); }} onDelete={() => handleDeleteTrack(track)} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============================================================= */
/*  Channel Picker Sheet                                           */
/* ============================================================= */

function ChannelPickerSheet({
  open,
  onClose,
  onSelect,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (channel: Channel) => void;
  userId: string;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);

  const y = useMotionValue(0);
  const sheetY = useTransform(y, [0, 400], [0, 400]);
  const backdropOpacity = useTransform(y, [0, 400], [0.6, 0]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("channels").select("*").eq("owner_id", userId).order("created_at", { ascending: false });
      setChannels(data ?? []);
      setLoading(false);
    })();
  }, [open, userId]);

  function handleDragEnd(_: any, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
    else y.set(0);
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
            className="relative w-full max-w-lg bg-background rounded-t-3xl overflow-hidden flex flex-col max-h-[75vh]"
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="px-5 pb-4 border-b border-white/5">
              <h2 className="text-lg font-bold">Выбор канала</h2>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground/40 text-sm">Загрузка...</div>
              ) : channels.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground/40 text-sm gap-2 px-6 text-center">
                  <Megaphone className="w-8 h-8" />
                  <p>У тебя нет своих каналов</p>
                  <p className="text-xs">Создай канал, чтобы привязать его к профилю</p>
                </div>
              ) : (
                <div className="p-3 space-y-1">
                  {channels.map((ch) => (
                    <motion.button key={ch.id} whileTap={{ scale: 0.97 }} onClick={() => { onSelect(ch); onClose(); }} className="w-full flex items-center gap-3 p-2.5 rounded-2xl hover:bg-white/5 text-left">
                      <div className="w-11 h-11 rounded-xl overflow-hidden bg-muted flex items-center justify-center shrink-0">
                        {ch.avatar_url ? <img src={ch.avatar_url} className="w-full h-full object-cover" alt="" /> : <Megaphone className="w-4 h-4 text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{ch.name}</div>
                        <div className="text-xs text-muted-foreground/40 truncate">@{ch.username} · {ch.subscribers_count.toLocaleString("ru-RU")} подписчиков</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/20 shrink-0" />
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============================================================= */
/*  Main Profile Panel — unified view/edit                         */
/* ============================================================= */

export function ProfilePanel({
  profile,
  isOwn = false,
  onClose,
  onSaved,
  onMuteToggle,
  onBlock,
  onReport,
  onClearHistory,
  isMuted,
}: {
  profile: EditableProfile;
  isOwn?: boolean;
  onClose: () => void;
  onSaved?: (patch: Partial<EditableProfile>) => void;
  onMuteToggle?: () => void;
  onBlock?: () => void;
  onReport?: () => void;
  onClearHistory?: () => void;
  isMuted?: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit">(isOwn ? "view" : "view");

  if (mode === "edit" && isOwn) {
    return (
      <ProfileEditor
        profile={profile}
        onClose={() => setMode("view")}
        onSaved={(patch) => {
          onSaved?.(patch);
        }}
      />
    );
  }

  return (
    <ProfileViewer
      profile={profile}
      isOwn={isOwn}
      onClose={onClose}
      onEdit={() => setMode("edit")}
      onMuteToggle={onMuteToggle}
      onBlock={onBlock}
      onReport={onReport}
      onClearHistory={onClearHistory}
      isMuted={isMuted}
    />
  );
}

/* ============================================================= */
/*  Profile Viewer (shared for own + others)                       */
/* ============================================================= */

function ProfileViewer({
  profile,
  isOwn,
  onClose,
  onEdit,
  onMuteToggle,
  onBlock,
  onReport,
  onClearHistory,
  isMuted,
}: {
  profile: EditableProfile;
  isOwn: boolean;
  onClose: () => void;
  onEdit: () => void;
  onMuteToggle?: () => void;
  onBlock?: () => void;
  onReport?: () => void;
  onClearHistory?: () => void;
  isMuted?: boolean;
}) {
  const [avatarLevel, setAvatarLevel] = useState<0 | 1 | 2>(0);
  const isMobile = typeof window !== "undefined" && "ontouchstart" in window;
  const [publications, setPublications] = useState<UserPublication[]>([]);
  const [gifts, setGifts] = useState<UserGift[]>([]);
  const [stories, setStories] = useState<UserStory[]>([]);
  const publicationInputRef = useRef<HTMLInputElement>(null);
  const storyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const [{ data: pubs }, { data: giftRows }, { data: storyRows }] = await Promise.all([
        supabase.from("publications").select("*").eq("owner_id", profile.id).order("created_at", { ascending: false }),
        supabase.from("gifts").select("*").eq("owner_id", profile.id),
        supabase.from("stories").select("*").eq("owner_id", profile.id).order("created_at", { ascending: false }),
      ]);
      setPublications(pubs ?? []);
      setGifts(giftRows ?? []);
      setStories(storyRows ?? []);
    })();
  }, [profile.id]);

  async function handleAddPublication(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const media_type: "image" | "video" = file.type.startsWith("video") ? "video" : "image";
    const storage_path = `${profile.id}/pub-${Date.now()}.enc`;

    try {
      // Изображения сжимаем, видео — только шифруем (canvas не нужен).
      const source = media_type === "image"
        ? await compressImage(file, { maxSize: 1440, quality: 0.82 })
        : file;
      const env = await encryptBlob(source);
      const { error: upErr } = await supabase.storage
        .from("publications")
        .upload(
          storage_path,
          new Blob([base64ToBytes(env.data) as unknown as BlobPart], { type: "application/octet-stream" }),
          { upsert: true, contentType: "application/octet-stream" },
        );
      if (upErr) throw upErr;

      const { data: inserted, error: insErr } = await supabase
        .from("publications")
        .insert({
          owner_id: profile.id,
          media_type,
          media_url: null,
          thumbnail_url: null,
          storage_path,
          media_nonce: env.nonce,
          thumbnail_nonce: media_type === "image" ? env.nonce : null,
          media_mime: source.type || "application/octet-stream",
        })
        .select()
        .single();
      if (insErr) throw insErr;

      setPublications((prev) => [inserted, ...prev]);
      toast.success("Публикация добавлена");
    } catch (err: any) {
          console.error("Publication error:", err?.message || JSON.stringify(err));
          toast.error(err?.message || "Не удалось загрузить публикацию");
    }
    e.target.value = "";
  }

  async function handleDeletePublication(pub: UserPublication) {
    setPublications((prev) => prev.filter((p) => p.id !== pub.id));
    try {
      await supabase.storage.from("publications").remove([pub.storage_path]);
      await supabase.from("publications").delete().eq("id", pub.id);
    } catch (err: any) {
      console.error("Publication error:", err?.message || JSON.stringify(err));
      toast.error(err?.message || "Не удалось загрузить публикацию");
    }
  }

  async function handleAddStory(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const media_type: "image" | "video" = file.type.startsWith("video") ? "video" : "image";
    const storage_path = `${profile.id}/story-${Date.now()}.enc`;

    try {
      const source = media_type === "image"
        ? await compressImage(file, { maxSize: 1440, quality: 0.82 })
        : file;
      const env = await encryptBlob(source);
      const { error: upErr } = await supabase.storage
        .from("stories")
        .upload(
          storage_path,
          new Blob([base64ToBytes(env.data) as unknown as BlobPart], { type: "application/octet-stream" }),
          { upsert: true, contentType: "application/octet-stream" },
        );
      if (upErr) throw upErr;

      const { data: inserted, error: insErr } = await supabase
        .from("stories")
        .insert({ owner_id: profile.id, media_type, media_url: null, storage_path, media_nonce: env.nonce, media_mime: source.type || "application/octet-stream" })
        .select()
        .single();
      if (insErr) throw insErr;

      setStories((prev) => [inserted, ...prev]);
      toast.success("История добавлена");
    } catch (err) {
      console.error(err);
      toast.error("Не удалось загрузить историю");
    }
    e.target.value = "";
  }

  const hasActivity = profile.share_listening_activity && profile.activity_title;
  const age = profile.birth_date && !profile.birth_date_hide_year ? calculateAge(profile.birth_date) : null;

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
        {/* Banner + avatar */}
        <div
          className={cn(
            "relative overflow-hidden transition-[height] duration-500 ease-out",
            avatarLevel > 0 ? "h-[280px]" : "h-[190px]"
          )}
        >
          <div className="absolute inset-0" style={{ background: resolveBackground(profile.background) }} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0a0a0d]" />

          <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} className="absolute top-4 left-4 z-10 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <ChevronLeft className="w-4 h-4" />
          </motion.button>

          {isOwn ? (
            <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => storyInputRef.current?.click()}
                className="w-9 h-9 rounded-full bg-primary flex items-center justify-center"
                title="Добавить историю"
              >
                <Plus className="w-4 h-4 text-primary-foreground" />
              </motion.button>
              <motion.button whileTap={{ scale: 0.9 }} onClick={onEdit} className="h-9 px-4 rounded-full bg-black/40 backdrop-blur-sm flex items-center gap-1.5 text-xs font-semibold">
                <Edit className="w-3.5 h-3.5" />
                Изм.
              </motion.button>
            </div>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/40 flex items-center justify-center">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-2xl border-white/10 bg-background/95 backdrop-blur-3xl p-2">
                <DropdownMenuItem onClick={onMuteToggle} className="rounded-xl gap-3 py-2.5 cursor-pointer">
                  {isMuted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                  {isMuted ? "Включить уведомления" : "Отключить уведомления"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onClearHistory} className="rounded-xl gap-3 py-2.5 cursor-pointer">
                  <Trash2 className="w-4 h-4" />
                  Очистить историю переписки
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/5" />
                <DropdownMenuItem onClick={onReport} className="rounded-xl gap-3 py-2.5 cursor-pointer text-amber-400">
                  <Flag className="w-4 h-4" />
                  Пожаловаться
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onBlock} className="rounded-xl gap-3 py-2.5 cursor-pointer text-destructive">
                  <Ban className="w-4 h-4" />
                  Заблокировать
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Avatar — interactive expand */}
          <AnimatePresence>
            {avatarLevel === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute left-1/2 -translate-x-1/2 bottom-6 z-[5] flex flex-col items-center"
              >
                <div className="rounded-full p-[3px]" style={{ background: stories.length > 0 ? "conic-gradient(from 0deg, var(--primary), #7dd3fc, var(--primary))" : "transparent" }}>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      if (isMobile) setAvatarLevel(1);
                      else setAvatarLevel(2); // PC — сразу fullscreen
                    }}
                    className="group relative w-[92px] h-[92px] rounded-full overflow-hidden bg-muted border-4 border-[#0a0a0d] flex items-center justify-center font-bold text-4xl text-primary"
                  >
                    {profile.avatar_url ? (
                      <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                    ) : (
                      safeChar(profile.display_name || profile.username)
                    )}
                    <div className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera className="w-5 h-5" />
                    </div>
                  </motion.button>
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 text-center px-4"
                >
                  <div className="text-[20px] font-bold flex items-center justify-center gap-1.5">
                    {profile.display_name}
                    {profile.status_emoji && <span className="text-base leading-none">{profile.status_emoji}</span>}
                  </div>
                  <div className="text-[13px] text-muted-foreground/40 mt-1">
                    {profile.is_online ? "в сети" : profile.last_seen_label || "не в сети"}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Avatar overlay — level 1 (banner fill) */}
          <AnimatePresence>
            {avatarLevel === 1 && (
              <motion.div
                initial={{ y: "100%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "100%", opacity: 0 }}
                transition={{ type: "spring", damping: 30, stiffness: 280 }}
                drag="y"
                dragConstraints={{ top: 0 }}
                dragElastic={0.1}
                onDragEnd={(_, info) => {
                  if (info.offset.y < -150 || info.velocity.y < -500) setAvatarLevel(2);
                  else if (info.offset.y > 80) setAvatarLevel(0);
                }}
                className="absolute inset-0 z-40 bg-background"
              >
                <div className="absolute inset-0">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center text-6xl font-bold text-primary">
                      {safeChar(profile.display_name || profile.username)}
                    </div>
                  )}
                </div>
                {/* Блюр-градиент снизу */}
                <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0a0d] via-[#0a0a0d]/60 to-transparent backdrop-blur-sm" />
                {/* Ник и статус плавно уезжают влево */}
                <motion.div
                  initial={{ x: "-50%", opacity: 0, scale: 0.9 }} // было по центру
                  animate={{ x: 0, opacity: 1, scale: 1 }} // уехало влево
                  transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 30 }}
                  className="absolute bottom-6 left-5 right-5 flex items-end justify-between"
                >
                  <div>
                    <div className="text-[22px] font-bold flex items-center gap-1.5">
                      {profile.display_name}
                      {profile.status_emoji && <span className="text-lg">{profile.status_emoji}</span>}
                    </div>
                    <div className="text-[13px] text-muted-foreground/60 mt-1">
                      {profile.is_online ? "в сети" : profile.last_seen_label || "не в сети"}
                    </div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setAvatarLevel(0)}
                    className="w-10 h-10 rounded-full bg-background/50 backdrop-blur flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </motion.div>
                {/* Подсказка свайпа */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground/40">
                  свайп вверх — на весь экран
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Avatar fullscreen — level 2 (gallery) */}
          <AnimatePresence>
            {avatarLevel === 2 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="fixed inset-0 z-[60] bg-black flex items-center justify-center"
              >
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.9 }}
                  transition={{ type: "spring", damping: 25 }}
                  className="relative w-full h-full"
                >
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} className="w-full h-full object-contain" alt="" />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center text-8xl font-bold text-primary">
                      {safeChar(profile.display_name || profile.username)}
                    </div>
                  )}
                  {/* Header как в Telegram */}
                  <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setAvatarLevel(0)}
                      className="w-10 h-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </motion.button>
                    <div className="text-center">
                      <div className="text-sm font-semibold">{profile.display_name}</div>
                      <div className="text-[11px] text-muted-foreground/50">@{profile.username}</div>
                    </div>
                    <div className="w-10" />
                  </div>
                  {/* Footer с действиями */}
                  <div className="absolute bottom-0 inset-x-0 p-4 flex items-center justify-center gap-4 bg-gradient-to-t from-black/70 to-transparent">
                    <button className="w-12 h-12 rounded-full bg-white/10 backdrop-blur flex items-center justify-center">
                      <TbShare2 className="w-5 h-5" />
                    </button>
                    <button className="w-12 h-12 rounded-full bg-white/10 backdrop-blur flex items-center justify-center">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Quick actions (only for viewing others) */}
        {!isOwn && (
          <div className="flex px-2 pt-5 pb-2">
            {[
              { icon: MessageCircle, label: "Чат" },
              { icon: Phone, label: "Звонок" },
              { icon: Video, label: "Видео" },
              { icon: isMuted ? BellOff : Bell, label: isMuted ? "Включить" : "Звук", onClick: onMuteToggle },
            ].map((a, i) => (
              <button key={i} onClick={a.onClick} className="flex-1 flex flex-col items-center gap-1.5">
                <a.icon className="w-[22px] h-[22px]" />
                <span className="text-[11px] text-muted-foreground/60 font-semibold">{a.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Activity - just track name, no "currently listening" */}
        {hasActivity && (
          <div className="mx-5 mt-5 rounded-[20px] p-3.5 flex items-center gap-3 bg-gradient-to-br from-[#4a3d1a] to-[#2e2510]">
            <div className="w-[42px] h-[42px] rounded-xl bg-black/20 flex items-center justify-center shrink-0">
              {profile.activity_cover_url ? (
                <img src={profile.activity_cover_url} className="w-full h-full object-cover rounded-xl" alt="" />
              ) : (
                <Music className="w-[18px] h-[18px] text-amber-200" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-amber-100 truncate">{profile.activity_title}</div>
              {profile.activity_subtitle && (
                <div className="text-[11px] text-amber-300/60 truncate">{profile.activity_subtitle}</div>
              )}
            </div>
            {profile.activity_type === "music" && (
              <div className="flex items-end gap-[2px] h-4 shrink-0">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-[3px] h-full bg-amber-200 rounded-sm origin-bottom animate-pulse"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Channel */}
        {profile.channel_name && (
          <div className="mx-5 mt-3 rounded-[20px] p-3.5 flex items-center gap-3 bg-gradient-to-br from-[#123028] to-[#0d1f1a]">
            <div className="w-[42px] h-[42px] rounded-xl bg-black/20 flex items-center justify-center shrink-0">
              <Megaphone className="w-[18px] h-[18px] text-emerald-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-emerald-300/80">Канал автора</div>
              <div className="text-sm font-bold text-emerald-100 truncate">{profile.channel_name}</div>
              {profile.channel_subscribers != null && (
                <div className="text-[11px] text-emerald-300/60">
                  {profile.channel_subscribers.toLocaleString("ru-RU")} подписчиков
                </div>
              )}
            </div>
            <ChevronRight className="w-4 h-4 text-emerald-300/60 shrink-0" />
          </div>
        )}

        {/* Unified info card */}
        <div className="mx-5 mt-5 rounded-[20px] bg-muted overflow-hidden divide-y divide-border">
          {/* Username row */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-[34px] h-[34px] rounded-[11px] bg-muted flex items-center justify-center shrink-0">
                <At className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-bold truncate">@{profile.username}</div>
                <div className="text-xs text-muted-foreground/40 mt-0.5">Имя пользователя</div>
              </div>
            </div>
            <div className="w-[34px] h-[34px] rounded-[11px] bg-muted flex items-center justify-center shrink-0">
              <QrCode className="w-4 h-4 text-primary" />
            </div>
          </div>

          {/* Bio row */}
          {profile.bio && (
            <div className="p-4">
              <div className="text-[11px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-2">О себе</div>
              <p className="text-[13px] text-muted-foreground/60 leading-relaxed">{profile.bio}</p>
            </div>
          )}

          {/* Birth date row */}
          {profile.birth_date && (
            <div className="flex items-center gap-3 p-4">
              <div className="w-[34px] h-[34px] rounded-[11px] bg-muted flex items-center justify-center shrink-0">
                <Calendar className="w-4 h-4 text-blue-300" />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-bold">
                  {formatBirthDateDisplay(profile.birth_date, profile.birth_date_hide_year)}
                  {age && <span className="text-muted-foreground/40 font-normal"> ({age} {age % 10 === 1 && age % 100 !== 11 ? 'год' : age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 10 || age % 100 >= 20) ? 'года' : 'лет'})</span>}
                </div>
                <div className="text-xs text-muted-foreground/40 mt-0.5">Дата рождения</div>
              </div>
            </div>
          )}
        </div>

        {/* Publications */}
        <div className="flex items-center justify-between px-5 pt-6 pb-2">
          <span className="text-[13px] font-bold text-muted-foreground/50">Публикации</span>
          {!isOwn && publications.length > 0 && <span className="text-xs text-muted-foreground/30">Все</span>}
        </div>

        {publications.length === 0 ? (
          <div className="px-5 pb-6">
            <div className="rounded-[20px] bg-muted border border-dashed border-border p-6 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
              </div>
              <div className="text-sm font-semibold text-foreground/80 mb-1">
                {isOwn ? "Публикаций пока нет" : "Пользователь ещё ничего не публиковал"}
              </div>
              <div className="text-xs text-muted-foreground/40 mb-4 max-w-[220px]">
                {isOwn ? "Публикуйте фотографии и видео в своём профиле" : "Здесь будут фотографии и видео"}
              </div>
              {isOwn && (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => publicationInputRef.current?.click()}
                  className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Добавить публикацию
                </motion.button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 px-5 pb-6">
            {isOwn && (
              <button onClick={() => publicationInputRef.current?.click()} className="aspect-square rounded-2xl bg-muted border border-dashed border-border flex items-center justify-center">
                <Plus className="w-5 h-5 text-muted-foreground/30" />
              </button>
            )}
            {publications.map((p) => (
              <div key={p.id} className="aspect-square rounded-2xl bg-muted overflow-hidden relative group">
                {p.thumbnail_url || p.thumbnail_nonce ? (
                  <SecureImage src={p.thumbnail_url} bucket="publications" path={p.storage_path} nonce={p.thumbnail_nonce} mime={p.media_mime} className="w-full h-full object-cover" fallback={<div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-muted-foreground/20" /></div>} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="w-5 h-5 text-muted-foreground/20" />
                  </div>
                )}
                {p.media_type === "video" && <PlayIcon className="w-4 h-4 text-foreground absolute bottom-2 right-2 drop-shadow" />}
                {isOwn && (
                  <button
                    onClick={() => handleDeletePublication(p)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <input ref={publicationInputRef} type="file" accept="image/*,video/*" hidden onChange={handleAddPublication} />

        {/* Gifts */}
        {gifts.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-5 pt-6 pb-2 text-[13px] font-bold text-muted-foreground/50">
              <GiftIcon className="w-3.5 h-3.5" /> Подарки
            </div>
            <div className="flex gap-2.5 px-5 pb-1 overflow-x-auto scrollbar-hide">
              {gifts.map((g) => (
                <div key={g.id} title={g.name} className="shrink-0 w-14 h-14 rounded-2xl bg-muted flex items-center justify-center text-2xl">
                  {g.emoji}
                </div>
              ))}
            </div>
            {isOwn && <p className="px-5 text-[11px] text-muted-foreground/25 mt-1">Дарят другие пользователи — сам себе подарить нельзя</p>}
          </>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}

/* ============================================================= */
/*  Profile Editor (extracted from old ProfileEditPanel)           */
/* ============================================================= */

function ProfileEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: EditableProfile;
  onClose: () => void;
  onSaved?: (patch: Partial<EditableProfile>) => void;
}) {
  const [draft, setDraft] = useState<EditableProfile>(profile);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatar_url);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [trackPickerOpen, setTrackPickerOpen] = useState(false);
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const usernameValidation = useMemo(() => validateUsername(draft.username), [draft.username]);
  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(profile) || avatarFile !== null, [draft, profile, avatarFile]);

  const anySheetOpen = trackPickerOpen || channelPickerOpen || datePickerOpen;

  // Безопасная аватарка: если новый формат (storage_path+nonce) — резолвим blob: URL.
  const secureAvatarUrl = useSecureMediaUrl(
    "avatars",
    draft.avatar_storage_path,
    draft.avatar_nonce,
    draft.avatar_mime || "image/webp",
    Boolean(draft.avatar_storage_path),
  );
  const shownAvatar = avatarPreview ?? secureAvatarUrl;

  function set<K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  function handleTrackSelect(track: UserTrack) {
    set("activity_type", "music");
    set("activity_title", track.title);
    set("activity_subtitle", track.artist);
    set("activity_cover_url", track.cover_url);
    set("activity_cover_path", track.cover_path);
    set("activity_cover_nonce", track.cover_nonce);
    set("activity_file_url", track.file_url);
    set("activity_gradient", track.gradient);
    set("share_listening_activity", true);
  }

  function clearActivity() {
    set("activity_type", null);
    set("activity_title", null);
    set("activity_subtitle", null);
    set("activity_cover_url", null);
    set("activity_cover_path", null);
    set("activity_cover_nonce", null);
    set("activity_file_url", null);
    set("activity_gradient", null);
    set("share_listening_activity", false);
  }

  function handleChannelSelect(channel: Channel) {
    set("channel_id", channel.id);
    set("channel_name", channel.name);
    set("channel_username", channel.username);
    set("channel_subscribers", channel.subscribers_count);
  }

  function clearChannel() {
    set("channel_id", null);
    set("channel_name", null);
    set("channel_username", null);
    set("channel_subscribers", null);
  }

  async function handleSave() {
    if (!usernameValidation.valid) {
      toast.error(usernameValidation.error || "Некорректный username");
      return;
    }
    setSaving(true);
    try {
      let avatar_url = draft.avatar_url;
      let avatar_storage_path = draft.avatar_storage_path;
      let avatar_nonce = draft.avatar_nonce;
      let avatar_mime = draft.avatar_mime;
      if (avatarFile) {
        // 1) Лёгкое сжатие "как в Telegram" (WebP Q82, ≤512px).
        const compressed = await compressAvatar(avatarFile);
        // 2) Шифрование до загрузки (AES-256-GCM, ключ в Rust).
        const env = await encryptBlob(compressed);
        const path = `${draft.id}/avatar-${Date.now()}.enc`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(
            path,
            new Blob([base64ToBytes(env.data) as unknown as BlobPart], { type: "application/octet-stream" }),
            { upsert: true, contentType: "application/octet-stream" },
          );
        if (uploadError) throw uploadError;
        avatar_storage_path = path;
        avatar_nonce = env.nonce;
        avatar_mime = compressed.type || "image/webp";
        avatar_url = null;
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          username: draft.username,
          display_name: draft.display_name,
          bio: draft.bio,
          background: draft.background,
          status_emoji: draft.status_emoji,
          birth_date: draft.birth_date,
          birth_date_hide_year: draft.birth_date_hide_year,
          activity_type: draft.share_listening_activity ? draft.activity_type : null,
          activity_title: draft.share_listening_activity ? draft.activity_title : null,
          activity_subtitle: draft.share_listening_activity ? draft.activity_subtitle : null,
          activity_cover_url: draft.share_listening_activity ? draft.activity_cover_url : null,
          activity_cover_path: draft.share_listening_activity ? draft.activity_cover_path : null,
          activity_cover_nonce: draft.share_listening_activity ? draft.activity_cover_nonce : null,
          activity_file_url: draft.share_listening_activity ? draft.activity_file_url : null,
          activity_gradient: draft.share_listening_activity ? draft.activity_gradient : null,
          share_listening_activity: draft.share_listening_activity,
          channel_id: draft.channel_id ?? null,
          avatar_url,
          avatar_storage_path,
          avatar_nonce,
          avatar_mime,
        })
        .eq("id", draft.id);

      if (error) throw error;

      toast.success("Профиль обновлён");
      onSaved?.({
        ...draft,
        avatar_url,
        avatar_storage_path,
        avatar_nonce,
        avatar_mime,
      });
      onClose();
    } catch (err) {
      console.error("Profile save error:", err);
      console.error("Full error:", JSON.stringify(err, null, 2));
      toast.error("Не удалось сохранить профиль");
    } finally {
      setSaving(false);
    }
  }

  const hasActivity = draft.share_listening_activity && draft.activity_title;

  return (
    <div className="relative flex flex-col h-full bg-background text-foreground overflow-hidden">
      <motion.div
        animate={{
          scale: anySheetOpen ? 0.95 : 1,
          y: anySheetOpen ? 10 : 0,
          filter: anySheetOpen ? "brightness(0.65)" : "brightness(1)",
        }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        style={{ transformOrigin: "top center" }}
        className="flex flex-col h-full rounded-[28px] overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
          <div className="relative h-[190px] overflow-hidden">
            <div className="absolute inset-0 transition-all duration-500" style={{ background: resolveBackground(draft.background) }} />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0a0a0d]" />

            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              className="absolute z-10 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
              style={{ top: 'calc(var(--safe-area-top) + 1rem)', left: '1rem' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setBgPickerOpen((v) => !v)}
              className="absolute z-10 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
              style={{ top: 'calc(var(--safe-area-top) + 1rem)', right: '1rem' }}
            >
              <Palette className="w-4 h-4" />
            </motion.button>

            <div className="absolute left-6 bottom-6 z-[5]">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => fileInputRef.current?.click()}
                className="group relative w-[92px] h-[92px] rounded-full overflow-hidden bg-muted border-4 border-[#0a0a0d] flex items-center justify-center font-bold text-4xl text-primary"
              >
                {shownAvatar ? <img src={shownAvatar} className="w-full h-full object-cover" alt="" /> : safeChar(draft.display_name)}
                <div className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="w-5 h-5" />
                </div>
              </motion.button>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarPick} />
          </div>

          <AnimatePresence>
            {bgPickerOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", damping: 30, stiffness: 300 }} className="overflow-hidden">
                <div className="flex gap-2.5 px-5 pt-14 pb-1">
                  {BACKGROUND_PRESETS.map((p) => (
                    <motion.button
                      key={p.key}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => { set("background", p.key); setBgPickerOpen(false); }}
                      title={p.label}
                      className={cn("w-9 h-9 rounded-full shrink-0 border-2 transition-all", draft.background === p.key ? "border-white scale-110" : "border-transparent")}
                      style={{ background: p.css }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={cn("px-6 pb-1", bgPickerOpen ? "pt-2" : "pt-12")}>
            <div className="flex items-center gap-2">
              <input
                value={draft.display_name}
                onChange={(e) => set("display_name", e.target.value)}
                placeholder="Имя"
                className="bg-transparent text-[23px] font-bold outline-none flex-1 min-w-0 placeholder:text-muted-foreground/20"
              />
              <button onClick={() => setEmojiPickerOpen((v) => !v)} className="shrink-0 text-xl leading-none w-8 h-8 flex items-center justify-center rounded-full bg-white/5">
                {draft.status_emoji || <span className="text-muted-foreground/25 text-sm">＋</span>}
              </button>
            </div>

            <AnimatePresence>
              {emojiPickerOpen && (
                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ type: "spring", damping: 30, stiffness: 300 }} className="flex items-center gap-2 mt-2">
                  {STATUS_EMOJIS.map((e) => (
                    <motion.button key={e} whileTap={{ scale: 0.85 }} onClick={() => { set("status_emoji", e); setEmojiPickerOpen(false); }} className="text-lg">
                      {e}
                    </motion.button>
                  ))}
                  <motion.button whileTap={{ scale: 0.95 }} onClick={() => { set("status_emoji", null); setEmojiPickerOpen(false); }} className="text-xs text-muted-foreground/40 ml-1">
                    Убрать
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Username and Bio cards in editor */}
            <div className="mt-3 space-y-2">
              {/* Username card - beautiful @ style */}
              <div className="rounded-[20px] bg-muted overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <div className="w-[34px] h-[34px] rounded-[11px] bg-muted flex items-center justify-center shrink-0">
                    <At className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <input
                      value={draft.username}
                      onChange={(e) => set("username", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      placeholder="username"
                      className={cn("bg-transparent text-[15px] font-bold outline-none w-full", !usernameValidation.valid && "text-red-400")}
                    />
                    <div className="text-xs text-muted-foreground/40 mt-0.5">Имя пользователя</div>
                  </div>
                </div>
              </div>
              {!usernameValidation.valid && <div className="text-xs text-red-400 ml-1">{usernameValidation.error}</div>}

              {/* Bio card */}
              <div className="rounded-[20px] bg-muted overflow-hidden">
                <div className="p-4">
                  <textarea
                    value={draft.bio ?? ""}
                    onChange={(e) => set("bio", e.target.value)}
                    placeholder="Расскажи о себе..."
                    rows={2}
                    className="w-full bg-transparent text-[13px] text-muted-foreground/60 outline-none resize-none placeholder:text-muted-foreground/20"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mx-5 mt-5 rounded-[20px] bg-muted p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <Calendar className="w-4 h-4 text-blue-300" />
              <span className="text-sm font-semibold">Дата рождения</span>
            </div>
            <div onClick={() => setDatePickerOpen(true)} className="w-full flex items-center justify-between bg-black/30 rounded-xl px-4 py-3 cursor-pointer">
              <span className={cn("text-sm", draft.birth_date ? "text-muted-foreground/80" : "text-muted-foreground/30")}>
                {draft.birth_date ? formatBirthDateDisplay(draft.birth_date, draft.birth_date_hide_year) : "Выбрать дату"}
              </span>
              {draft.birth_date && (
                <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); set("birth_date", null); }}>
                  <X className="w-4 h-4 text-muted-foreground/30" />
                </motion.button>
              )}
            </div>
          </div>

          <div className="mx-5 mt-3 rounded-[20px] bg-muted p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <Music className="w-4 h-4 text-amber-300" />
                <span className="text-sm font-semibold">Текущий трек</span>
              </div>
              {hasActivity && (
                <motion.button whileTap={{ scale: 0.95 }} onClick={clearActivity} className="text-xs text-muted-foreground/40">
                  Убрать
                </motion.button>
              )}
            </div>

            <AnimatePresence mode="wait">
              {hasActivity ? (
                <motion.div
                  key="track-card"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", damping: 30, stiffness: 300 }}
                  className="relative rounded-2xl overflow-hidden"
                  style={{ background: draft.activity_gradient || BACKGROUND_PRESETS[0].css }}
                >
                  <div className="relative flex items-center gap-3 p-3">
                    <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-black/20 flex items-center justify-center">
                      {draft.activity_cover_url ? <img src={draft.activity_cover_url} className="w-full h-full object-cover" alt="" /> : <Music className="w-6 h-6 text-muted-foreground/80" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate drop-shadow">{draft.activity_title}</div>
                      <div className="text-xs text-muted-foreground/80 truncate drop-shadow">{draft.activity_subtitle}</div>
                    </div>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={() => setTrackPickerOpen(true)} className="w-9 h-9 rounded-full bg-muted-foreground/30 backdrop-blur-sm flex items-center justify-center">
                      <Pen className="w-3.5 h-3.5" />
                    </motion.button>
                  </div>
                </motion.div>
              ) : (
                <motion.button
                  key="pick-track"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setTrackPickerOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-white/5 border border-dashed border-border text-sm text-muted-foreground/50"
                >
                  <Plus className="w-4 h-4" /> Выбрать трек
                </motion.button>
              )}
            </AnimatePresence>

            <p className="text-xs text-muted-foreground/30 mt-3 leading-relaxed">Собеседники увидят, что ты слушаешь, в твоём профиле.</p>
          </div>

          <div className="mx-5 mt-3 rounded-[20px] bg-muted p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <Megaphone className="w-4 h-4 text-emerald-300" />
              <span className="text-sm font-semibold">Канал</span>
            </div>
            {draft.channel_name ? (
              <div className="flex items-center gap-3 bg-black/30 rounded-xl px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{draft.channel_name}</div>
                  <div className="text-xs text-muted-foreground/40 truncate">@{draft.channel_username}</div>
                </div>
                <button onClick={() => setChannelPickerOpen(true)} className="text-xs font-semibold text-primary shrink-0">Сменить</button>
                <button onClick={clearChannel} className="shrink-0"><X className="w-3.5 h-3.5 text-muted-foreground/30" /></button>
              </div>
            ) : (
              <motion.button whileTap={{ scale: 0.98 }} onClick={() => setChannelPickerOpen(true)} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white/5 border border-dashed border-border text-sm text-muted-foreground/50">
                <Plus className="w-4 h-4" /> Привязать канал
              </motion.button>
            )}
          </div>

          <div className="h-24" />
        </div>

        <motion.div initial={false} animate={{ y: isDirty ? 0 : "100%" }} transition={{ type: "spring", damping: 35, stiffness: 300 }} className="shrink-0 px-5 pb-5 pt-3 border-t border-white/5 bg-background">
          <motion.button whileTap={{ scale: 0.98 }} onClick={handleSave} disabled={!isDirty || saving} className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40">
            {saving ? "Сохраняю..." : (<><Check className="w-4 h-4" /> Сохранить изменения</>)}
          </motion.button>
        </motion.div>
      </motion.div>

      <TrackPickerSheet open={trackPickerOpen} onClose={() => setTrackPickerOpen(false)} onSelect={handleTrackSelect} userId={draft.id} />
      <ChannelPickerSheet open={channelPickerOpen} onClose={() => setChannelPickerOpen(false)} onSelect={handleChannelSelect} userId={draft.id} />
      <DatePickerSheet
        open={datePickerOpen}
        onClose={() => setDatePickerOpen(false)}
        onSelect={(date) => set("birth_date", date)}
        initialDate={draft.birth_date ?? null}
        hideYear={draft.birth_date_hide_year ?? false}
        onHideYearToggle={() => set("birth_date_hide_year", !(draft.birth_date_hide_year ?? false))}
      />
    </div>
  );
}

/* ============================================================= */
/*  Backwards-compatible alias for existing imports                */
/* ============================================================= */

/**
 * @deprecated Use `<ProfilePanel profile={...} isOwn />` instead.
 * Kept so existing call-sites (e.g. settings-modal.tsx) keep working.
 */
export function ProfileEditPanel({
  profile,
  onClose,
  onSaved,
}: {
  profile: EditableProfile;
  onClose: () => void;
  onSaved?: (patch: Partial<EditableProfile>) => void;
}) {
  return <ProfilePanel profile={profile} isOwn onClose={onClose} onSaved={onSaved} />;
}