"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import {
  TbChevronLeft as ChevronLeft,
  TbCamera as Camera,
  TbPalette as Palette,
  TbCheck as Check,
  TbMusic as Music,
  TbPencil as Pen,
  TbSpeakerphone as Megaphone,
  TbX as X,
  TbUpload as Upload,
  TbHash as Hash,
  TbPlus as Plus,
  TbCalendar as Calendar,
} from "react-icons/tb";
import { cn, safeChar } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import * as mm from "music-metadata-browser";

/* ─────────────────────────────────────────────────────────── */
/*  Types                                                       */
/* ─────────────────────────────────────────────────────────── */

export interface EditableProfile {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  background: string | null;
  status_emoji: string | null;
  birth_date?: string | null;
  activity_type: "music" | "custom" | null;
  activity_title: string | null;
  activity_subtitle: string | null;
  activity_cover_url?: string | null;
  activity_file_url?: string | null;
  activity_gradient?: string | null;
  share_listening_activity: boolean;
  channel_id?: string | null;
  channel_name?: string | null;
  channel_username?: string | null;
}

interface UserTrack {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  file_url: string;
  gradient: string | null;
}

interface Channel {
  id: string;
  name: string;
  username: string;
  avatar_url: string | null;
  subscribers_count: number;
}

/* ─────────────────────────────────────────────────────────── */
/*  Constants                                                   */
/* ─────────────────────────────────────────────────────────── */

const BACKGROUND_PRESETS = [
  { key: "violet", css: "radial-gradient(circle at 25% 20%,#4a3d8f,transparent 55%),radial-gradient(circle at 75% 70%,#2a2440,transparent 60%),#0d0d14", label: "Фиолетовый" },
  { key: "teal", css: "radial-gradient(circle at 70% 20%,#1a4a4a,transparent 55%),radial-gradient(circle at 20% 80%,#123028,transparent 60%),#0a1614", label: "Бирюзовый" },
  { key: "rose", css: "radial-gradient(circle at 30% 70%,#5a2a3a,transparent 55%),radial-gradient(circle at 80% 20%,#2a1420,transparent 60%),#150a10", label: "Розовый" },
  { key: "amber", css: "radial-gradient(circle at 50% 30%,#4a3a1a,transparent 55%),radial-gradient(circle at 20% 80%,#2a2010,transparent 60%),#14100a", label: "Янтарный" },
];

const STATUS_EMOJIS = ["🔥", "✨", "🎧", "💭", "🌙", "☕"];

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const GRADIENT_PALETTE = [
  ["#ff6b6b", "#ee5a6f"],
  ["#f093fb", "#f5576c"],
  ["#4facfe", "#00f2fe"],
  ["#43e97b", "#38f9d7"],
  ["#fa709a", "#fee140"],
  ["#30cfd0", "#330867"],
  ["#a8edea", "#fed6e3"],
  ["#ff9a9e", "#fecfef"],
  ["#667eea", "#764ba2"],
  ["#f6d365", "#fda085"],
];

const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear();

/* ─────────────────────────────────────────────────────────── */
/*  Helpers                                                     */
/* ─────────────────────────────────────────────────────────── */

function resolveBackground(bg: string | null) {
  const preset = BACKGROUND_PRESETS.find((p) => p.key === bg);
  if (preset) return preset.css;
  if (bg?.startsWith("http")) return `url(${bg}) center/cover`;
  return bg || BACKGROUND_PRESETS[0].css;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function gradientFromText(text: string): string {
  const idx = hashString(text) % GRADIENT_PALETTE.length;
  const [c1, c2] = GRADIENT_PALETTE[idx];
  return `linear-gradient(135deg, ${c1}, ${c2})`;
}

function validateUsername(u: string): { valid: boolean; error?: string } {
  if (!u) return { valid: true };
  if (u.length < 3) return { valid: false, error: "Минимум 3 символа" };
  if (u.length > 20) return { valid: false, error: "Максимум 20 символов" };
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return { valid: false, error: "Только латиница, цифры и _" };
  return { valid: true };
}

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function parseBirthDate(dateStr: string | null): { day: number; month: number; year: number } | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return {
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  };
}

function formatBirthDate(day: number, month: number, year: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function extractAudioMetadata(file: File): Promise<{ title: string; artist: string; coverDataUrl: string | null }> {
  try {
    const metadata = await mm.parseBlob(file);
    const title = metadata.common.title || file.name.replace(/\.[^/.]+$/, "");
    const artist = metadata.common.artist || "Неизвестный исполнитель";
    let coverDataUrl: string | null = null;

    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      const blob = new Blob([pic.data], { type: pic.format });
      coverDataUrl = URL.createObjectURL(blob);
    }

    return { title, artist, coverDataUrl };
  } catch (err) {
    console.error("Metadata extraction failed:", err);
    return {
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: "Неизвестный исполнитель",
      coverDataUrl: null,
    };
  }
}

/* ─────────────────────────────────────────────────────────── */
/*  iOS-style Date Picker (Scroll Wheel)                        */
/* ─────────────────────────────────────────────────────────── */

function DatePickerSheet({
  open,
  onClose,
  onSelect,
  initialDate,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (date: string) => void;
  initialDate: string | null;
}) {
  const initial = parseBirthDate(initialDate);
  const [selectedDay, setSelectedDay] = useState(initial?.day || 1);
  const [selectedMonth, setSelectedMonth] = useState(initial?.month || 1);
  const [selectedYear, setSelectedYear] = useState(initial?.year || MAX_YEAR);

  const daysInMonth = getDaysInMonth(selectedMonth, selectedYear);

  // Создаём массивы с правильными диапазонами
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MAX_YEAR - i);

  const y = useMotionValue(0);
  const sheetY = useTransform(y, [0, 400], [0, 400]);
  const backdropOpacity = useTransform(y, [0, 400], [0.6, 0]);

  function handleDragEnd(_: any, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    } else {
      y.set(0);
    }
  }

  function handleConfirm() {
    const dateStr = formatBirthDate(selectedDay, selectedMonth, selectedYear);
    onSelect(dateStr);
    onClose();
  }

  // Обновляем дни при смене месяца/года
  useEffect(() => {
    if (selectedDay > daysInMonth) {
      setSelectedDay(daysInMonth);
    }
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
          <motion.div
            style={{ opacity: backdropOpacity }}
            className="absolute inset-0 bg-black"
            onClick={onClose}
          />

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

            <div className="flex items-center justify-between px-5 pb-4 border-b border-white/5">
              <h2 className="text-lg font-bold">Дата рождения</h2>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleConfirm}
                className="text-primary font-semibold text-sm px-2 py-1"
              >
                Готово
              </motion.button>
            </div>

            <div className="flex h-64 relative bg-gradient-to-b from-[#1c1c1e] to-[#1c1c1e]">
              {/* Selection indicator */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 bg-white/5 pointer-events-none rounded-lg mx-2" />
              <div className="absolute inset-x-0 top-1/2 -translate-y-[calc(50%+20px)] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
              <div className="absolute inset-x-0 top-1/2 -translate-y-[calc(50%-20px)] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />

              {/* Day column */}
              <ScrollColumn
                items={days}
                selectedIndex={selectedDay - 1}
                onSelect={(idx) => setSelectedDay(idx + 1)}
                format={(d) => String(d)}
              />

              {/* Month column */}
              <ScrollColumn
                items={months}
                selectedIndex={selectedMonth - 1}
                onSelect={(idx) => setSelectedMonth(idx + 1)}
                format={(m) => MONTHS[m - 1]}
              />

              {/* Year column */}
              <ScrollColumn
                items={years}
                selectedIndex={years.indexOf(selectedYear)}
                onSelect={(idx) => setSelectedYear(years[idx])}
                format={(y) => String(y)}
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
}: {
  items: number[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  format: (item: number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ITEM_HEIGHT = 40;
  const isScrolling = useRef(false);
  const scrollTimeout = useRef<NodeJS.Timeout>();

  // Инициализация позиции при изменении selectedIndex
  useEffect(() => {
    if (containerRef.current && !isScrolling.current) {
      const targetScroll = selectedIndex * ITEM_HEIGHT;
      containerRef.current.scrollTo({
        top: targetScroll,
        behavior: 'auto',
      });
    }
  }, [selectedIndex]);

  function handleScroll() {
    if (!containerRef.current) return;

    isScrolling.current = true;

    // Очищаем предыдущий таймаут
    if (scrollTimeout.current) {
      clearTimeout(scrollTimeout.current);
    }

    const scrollTop = containerRef.current.scrollTop;
    const index = Math.round(scrollTop / ITEM_HEIGHT);

    // Устанавливаем таймаут для определения конца прокрутки
    scrollTimeout.current = setTimeout(() => {
      isScrolling.current = false;
      if (index >= 0 && index < items.length) {
        onSelect(index);
        // Плавная подгонка к ближайшему элементу
        containerRef.current?.scrollTo({
          top: index * ITEM_HEIGHT,
          behavior: 'smooth',
        });
      }
    }, 150);

    // Обновляем selection во время прокрутки
    if (index >= 0 && index < items.length) {
      onSelect(index);
    }
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto scrollbar-hide"
        style={{
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Top padding - 2 элемента */}
        <div style={{ height: ITEM_HEIGHT * 2 }} />

        {items.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center justify-center text-sm font-medium transition-all duration-150"
            style={{
              height: ITEM_HEIGHT,
              scrollSnapAlign: 'center',
              opacity: idx === selectedIndex ? 1 : 0.35,
              transform: `scale(${idx === selectedIndex ? 1.1 : 1})`,
              color: idx === selectedIndex ? '#ffffff' : '#8e8e93',
            }}
          >
            {format(item)}
          </div>
        ))}

        {/* Bottom padding - 2 элемента */}
        <div style={{ height: ITEM_HEIGHT * 2 }} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  Track Picker Sheet                                          */
/* ─────────────────────────────────────────────────────────── */

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
  const [extracting, setExtracting] = useState(false);

  const y = useMotionValue(0);
  const sheetY = useTransform(y, [0, 400], [0, 400]);
  const backdropOpacity = useTransform(y, [0, 400], [0.6, 0]);

  useEffect(() => {
    if (!open) return;
    loadTracks();
  }, [open, userId]);

  async function loadTracks() {
    setLoading(true);
    const { data } = await supabase
      .from("user_tracks")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });
    setTracks(data ?? []);
    setLoading(false);
  }

  function handleDragEnd(_: any, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    } else {
      y.set(0);
    }
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
    setExtracting(false);
  }

  function resetUploadForm() {
    setAudioFile(null);
    setTitle("");
    setArtist("");
    setCoverPreview(null);
    setShowUploadForm(false);
  }

  async function handleUpload() {
    if (!title || !audioFile) {
      toast.error("Укажи название и выбери аудио");
      return;
    }
    setUploading(true);

    try {
      const audioPath = `${userId}/track-${Date.now()}.mp3`;
      const { error: audioErr } = await supabase.storage
        .from("tracks")
        .upload(audioPath, audioFile, { upsert: true });
      if (audioErr) throw audioErr;

      const { data: audioPub } = supabase.storage.from("tracks").getPublicUrl(audioPath);
      let cover_url: string | null = null;

      if (coverPreview && coverPreview.startsWith("blob:")) {
        const response = await fetch(coverPreview);
        const blob = await response.blob();
        const coverPath = `${userId}/cover-${Date.now()}.jpg`;
        const { error: coverErr } = await supabase.storage
          .from("tracks")
          .upload(coverPath, blob, { upsert: true });
        if (!coverErr) {
          const { data: coverPub } = supabase.storage.from("tracks").getPublicUrl(coverPath);
          cover_url = coverPub.publicUrl;
        }
      }

      const gradient = gradientFromText(title + artist);

      const { data: inserted, error: insertErr } = await supabase
        .from("user_tracks")
        .insert({
          owner_id: userId,
          title,
          artist,
          file_url: audioPub.publicUrl,
          cover_url,
          gradient,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      setTracks((prev) => [inserted, ...prev]);
      resetUploadForm();
      toast.success("Трек загружен");
    } catch (err) {
      console.error(err);
      toast.error("Ошибка загрузки");
    } finally {
      setUploading(false);
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
          <motion.div
            style={{ opacity: backdropOpacity }}
            className="absolute inset-0 bg-black"
            onClick={onClose}
          />

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
            className="relative w-full max-w-lg bg-[#1c1c1e] rounded-t-3xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            <div className="flex items-center justify-between px-5 pb-4 border-b border-white/5">
              <h2 className="text-lg font-bold">Выбери трек</h2>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowUploadForm((v) => !v)}
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center"
              >
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
                      <Music className="w-4 h-4 text-white/50" />
                      <span className="text-sm text-white/70 truncate flex-1">
                        {audioFile?.name || "Выбери аудио файл"}
                      </span>
                      <input type="file" accept="audio/*" hidden onChange={handleAudioSelect} />
                    </label>

                    {extracting && (
                      <div className="text-xs text-white/40 text-center">Извлечение метаданных...</div>
                    )}

                    {audioFile && !extracting && (
                      <>
                        <input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Название трека"
                          className="w-full bg-white/5 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-white/30"
                        />
                        <input
                          value={artist}
                          onChange={(e) => setArtist(e.target.value)}
                          placeholder="Исполнитель"
                          className="w-full bg-white/5 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-white/30"
                        />
                        {coverPreview && (
                          <div className="flex items-center gap-3">
                            <img src={coverPreview} className="w-16 h-16 rounded-lg object-cover" alt="" />
                            <span className="text-xs text-white/50">Обложка извлечена из файла</span>
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex gap-2">
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={resetUploadForm}
                        className="flex-1 h-11 rounded-xl bg-white/5 text-sm font-semibold"
                      >
                        Отмена
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={handleUpload}
                        disabled={uploading || !audioFile}
                        className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {uploading ? "Загрузка..." : (
                          <>
                            <Upload className="w-4 h-4" /> Загрузить
                          </>
                        )}
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-white/40 text-sm">Загрузка...</div>
              ) : tracks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-white/40 text-sm gap-2">
                  <Music className="w-8 h-8" />
                  <p>У тебя пока нет треков</p>
                  <p className="text-xs">Нажми + чтобы загрузить</p>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {tracks.map((track) => (
                    <motion.button
                      key={track.id}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        onSelect(track);
                        onClose();
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-white/5 transition-colors text-left"
                    >
                      <div
                        className="w-14 h-14 rounded-xl shrink-0 overflow-hidden flex items-center justify-center"
                        style={{ background: track.gradient || gradientFromText(track.title) }}
                      >
                        {track.cover_url ? (
                          <img src={track.cover_url} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <Music className="w-6 h-6 text-white/80" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{track.title}</div>
                        <div className="text-xs text-white/50 truncate">{track.artist}</div>
                      </div>
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

/* ─────────────────────────────────────────────────────────── */
/*  Main Edit Panel                                             */
/* ─────────────────────────────────────────────────────────── */

export function ProfileEditPanel({
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
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const usernameValidation = useMemo(() => validateUsername(draft.username), [draft.username]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(profile) || avatarFile !== null,
    [draft, profile, avatarFile]
  );

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
    set("activity_file_url", track.file_url);
    set("activity_gradient", track.gradient);
    set("share_listening_activity", true);
  }

  function clearActivity() {
    set("activity_type", null);
    set("activity_title", null);
    set("activity_subtitle", null);
    set("activity_cover_url", null);
    set("activity_file_url", null);
    set("activity_gradient", null);
    set("share_listening_activity", false);
  }

  function formatBirthDateDisplay(dateStr: string | null): string {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }

  async function handleSave() {
    if (!usernameValidation.valid) {
      toast.error(usernameValidation.error || "Некорректный username");
      return;
    }

    setSaving(true);
    try {
      let avatar_url = draft.avatar_url;

      if (avatarFile) {
        const path = `${draft.id}/avatar-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
        avatar_url = pub.publicUrl;
      }

      let channel_id: string | null = null;
      if (draft.channel_username) {
        const { data: channel } = await supabase
          .from("channels")
          .select("id")
          .eq("username", draft.channel_username.replace(/^@/, ""))
          .maybeSingle();
        channel_id = channel?.id ?? null;
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
          activity_type: draft.share_listening_activity ? draft.activity_type : null,
          activity_title: draft.share_listening_activity ? draft.activity_title : null,
          activity_subtitle: draft.share_listening_activity ? draft.activity_subtitle : null,
          activity_cover_url: draft.share_listening_activity ? draft.activity_cover_url : null,
          activity_file_url: draft.share_listening_activity ? draft.activity_file_url : null,
          activity_gradient: draft.share_listening_activity ? draft.activity_gradient : null,
          share_listening_activity: draft.share_listening_activity,
          channel_id,
          avatar_url,
        })
        .eq("id", draft.id);

      if (error) throw error;

      toast.success("Профиль обновлён");
      onSaved?.({ ...draft, avatar_url });
      onClose();
    } catch (err) {
      console.error("Profile save error:", err);
      toast.error("Не удалось сохранить профиль");
    } finally {
      setSaving(false);
    }
  }

  const hasActivity = draft.share_listening_activity && draft.activity_title;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0d] text-white overflow-hidden">
      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
        <div className="relative h-[190px] overflow-hidden">
          <div className="absolute inset-0 transition-all duration-500" style={{ background: resolveBackground(draft.background) }} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0a0a0d]" />

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="absolute top-4 left-4 z-10 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
          >
            <ChevronLeft className="w-4 h-4" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setBgPickerOpen((v) => !v)}
            className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
          >
            <Palette className="w-4 h-4" />
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => fileInputRef.current?.click()}
            className="group absolute left-6 -bottom-8 z-[5] w-24 h-24 rounded-full overflow-hidden bg-[#252038] border-4 border-[#0a0a0d] flex items-center justify-center font-bold text-4xl text-primary"
          >
            {avatarPreview ? (
              <img src={avatarPreview} className="w-full h-full object-cover" alt="" />
            ) : (
              safeChar(draft.display_name)
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="w-5 h-5" />
            </div>
          </motion.button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarPick} />
        </div>

        <AnimatePresence>
          {bgPickerOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="overflow-hidden"
            >
              <div className="flex gap-2.5 px-5 pt-14 pb-1">
                {BACKGROUND_PRESETS.map((p) => (
                  <motion.button
                    key={p.key}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      set("background", p.key);
                      setBgPickerOpen(false);
                    }}
                    title={p.label}
                    className={cn(
                      "w-9 h-9 rounded-full shrink-0 border-2 transition-all",
                      draft.background === p.key ? "border-white scale-110" : "border-transparent"
                    )}
                    style={{ background: p.css }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={cn("px-6 pb-1", bgPickerOpen ? "pt-2" : "pt-12")}>
          <input
            value={draft.display_name}
            onChange={(e) => set("display_name", e.target.value)}
            placeholder="Имя"
            className="bg-transparent text-[23px] font-bold outline-none w-full placeholder:text-white/20"
          />

          <div className="flex items-center gap-1.5 mt-1">
            <Hash className="w-3.5 h-3.5 text-white/30" />
            <input
              value={draft.username}
              onChange={(e) => set("username", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              placeholder="username"
              className={cn(
                "bg-transparent text-sm outline-none flex-1 placeholder:text-white/20",
                !usernameValidation.valid && "text-red-400"
              )}
            />
            {!usernameValidation.valid && (
              <span className="text-xs text-red-400">{usernameValidation.error}</span>
            )}
          </div>

          <div className="relative mt-3">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setEmojiPickerOpen((v) => !v)}
              className="flex items-center gap-2 text-[13px] text-white/50"
            >
              <span className="text-lg leading-none">{draft.status_emoji || "💫"}</span>
              {draft.status_emoji ? "Изменить статус" : "Добавить статус-эмодзи"}
            </motion.button>
            <AnimatePresence>
              {emojiPickerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ type: "spring", damping: 30, stiffness: 300 }}
                  className="flex items-center gap-2 mt-2"
                >
                  {STATUS_EMOJIS.map((e) => (
                    <motion.button
                      key={e}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => {
                        set("status_emoji", e);
                        setEmojiPickerOpen(false);
                      }}
                      className="text-lg"
                    >
                      {e}
                    </motion.button>
                  ))}
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      set("status_emoji", null);
                      setEmojiPickerOpen(false);
                    }}
                    className="text-xs text-white/40 ml-1"
                  >
                    Убрать
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Birth date */}
        <div className="mx-5 mt-5 rounded-[20px] bg-[#131318] p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <Calendar className="w-4 h-4 text-blue-300" />
            <span className="text-sm font-semibold">Дата рождения</span>
          </div>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setDatePickerOpen(true)}
            className="w-full flex items-center justify-between bg-black/30 rounded-xl px-4 py-3"
          >
            <span className={cn("text-sm", draft.birth_date ? "text-white/80" : "text-white/30")}>
              {draft.birth_date ? formatBirthDateDisplay(draft.birth_date) : "Выбери дату"}
            </span>
            {draft.birth_date && (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                  e.stopPropagation();
                  set("birth_date", null);
                }}
              >
                <X className="w-4 h-4 text-white/30" />
              </motion.button>
            )}
          </motion.button>
        </div>

        <div className="px-5 pt-5">
          <div className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Pen className="w-3 h-3" /> О себе
          </div>
          <textarea
            value={draft.bio ?? ""}
            onChange={(e) => set("bio", e.target.value)}
            placeholder="Расскажи о себе..."
            rows={2}
            className="w-full bg-[#131318] rounded-2xl p-4 text-[13px] text-white/80 outline-none resize-none placeholder:text-white/20"
          />
        </div>

        <div className="mx-5 mt-5 rounded-[20px] bg-[#131318] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <Music className="w-4 h-4 text-amber-300" />
              <span className="text-sm font-semibold">Слушаю сейчас</span>
            </div>
            {hasActivity && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={clearActivity}
                className="text-xs text-white/40"
              >
                Очистить
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
                style={{ background: draft.activity_gradient || gradientFromText(draft.activity_title || "") }}
              >
                {draft.activity_cover_url && (
                  <div
                    className="absolute inset-0 opacity-40 blur-2xl scale-110"
                    style={{
                      backgroundImage: `url(${draft.activity_cover_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                )}
                <div className="relative flex items-center gap-3 p-3">
                  <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-black/20 flex items-center justify-center">
                    {draft.activity_cover_url ? (
                      <img src={draft.activity_cover_url} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <Music className="w-6 h-6 text-white/80" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate drop-shadow">{draft.activity_title}</div>
                    <div className="text-xs text-white/80 truncate drop-shadow">{draft.activity_subtitle}</div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setTrackPickerOpen(true)}
                    className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"
                  >
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
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-white/5 border border-dashed border-white/10 text-sm text-white/50"
              >
                <Plus className="w-4 h-4" /> Выбрать трек
              </motion.button>
            )}
          </AnimatePresence>

          <p className="text-xs text-white/30 mt-3 leading-relaxed">
            Друзья увидят, что ты слушаешь, в твоем профиле и в статусе.
          </p>
        </div>

        <div className="mx-5 mt-3 rounded-[20px] bg-[#131318] p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <Megaphone className="w-4 h-4 text-emerald-300" />
            <span className="text-sm font-semibold">Канал</span>
          </div>
          <div className="flex items-center gap-2 bg-black/30 rounded-xl px-3 py-2.5">
            <input
              value={draft.channel_username ?? ""}
              onChange={(e) => set("channel_username", e.target.value || null)}
              placeholder="username_канала"
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-white/20"
            />
            {draft.channel_username && (
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => set("channel_username", null)}>
                <X className="w-3.5 h-3.5 text-white/30" />
              </motion.button>
            )}
          </div>
        </div>

        <div className="h-24" />
      </div>

      <motion.div
        initial={false}
        animate={{ y: isDirty ? 0 : "100%" }}
        transition={{ type: "spring", damping: 35, stiffness: 300 }}
        className="shrink-0 px-5 pb-5 pt-3 border-t border-white/5 bg-[#0a0a0d]"
      >
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {saving ? "Сохранение..." : (
            <>
              <Check className="w-4 h-4" /> Сохранить изменения
            </>
          )}
        </motion.button>
      </motion.div>

      <TrackPickerSheet
        open={trackPickerOpen}
        onClose={() => setTrackPickerOpen(false)}
        onSelect={handleTrackSelect}
        userId={draft.id}
      />

      <DatePickerSheet
        open={datePickerOpen}
        onClose={() => setDatePickerOpen(false)}
        onSelect={(date) => set("birth_date", date)}
        initialDate={draft.birth_date}
      />
    </div>
  );
}