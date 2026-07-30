"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
  TbCloudUpload as CloudUpload,
  TbDownload as Download,
  TbUpload as Upload,
  TbPhoto as ImageIcon,
  TbTrash as Trash,
  TbCheck as Check,
  TbGlassFull as GlassIcon,
  TbAppWindow as AppWindowIcon,
  TbColorSwatch as ColorSwatchIcon,
  TbLoader2 as Loader,
  TbDeviceDesktop as DesktopIcon,
  TbType as TypeIcon,
  TbTextColor as TextColorIcon,
  TbContrast as ContrastIcon,
} from "react-icons/tb";

import {
  applyThemeToDOM,
  applyGlassSettings,
  applyColorOverride,
  applyChatWallpaper,
  getCssVarAsHex,
  hexToOklchString,
  createPresetFromTheme,
  downloadFile,
  parsePreset,
  generateThemeId,
  saveLocalThemeState,
  loadLocalThemeState,
  saveGlassSettings,
  loadGlassSettings,
  APP_ICONS,
  setAppIcon,
  type LocalThemeState,
} from "@/lib/themes/engine";
import {
  BUILTIN_THEMES,
  getDefaultTheme,
} from "@/lib/themes/defaults";
import type { ThemeCSSVariables, ThemeMetadata, EchoTheme } from "@/lib/themes/types";

// ─── Props ───────────────────────────────────────────────────────────
interface InterfaceSettingsProps {
  user: any;
  onBack: () => void;
  onClose: () => void;
}

// ─── Color palette config ────────────────────────────────────────────
interface ColorItem {
  label: string;
  varName: string;
}
const COLOR_ITEMS: ColorItem[] = [
  { label: "Accent / Primary", varName: "--primary" },
  { label: "Secondary", varName: "--secondary" },
  { label: "Background", varName: "--background" },
  { label: "Surface / Card", varName: "--card" },
  { label: "Sidebar", varName: "--sidebar" },
  { label: "Text", varName: "--foreground" },
];

// Text & Icon color items (for the override block)
const TEXT_ICON_ITEMS: ColorItem[] = [
  { label: "Primary Text", varName: "--foreground" },
  { label: "Muted Text", varName: "--muted-foreground" },
  { label: "Card Text", varName: "--card-foreground" },
  { label: "Sidebar Text", varName: "--sidebar-foreground" },
  { label: "Icon Primary", varName: "--icon-primary" },
  { label: "Icon Muted", varName: "--icon-muted" },
  { label: "Surface White", varName: "--surface-white" },
];

// ─── Small UI helpers ────────────────────────────────────────────────
const CornerBrackets = () => (
  <>
    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-primary/30 rounded-tl-sm pointer-events-none z-10" />
    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-primary/30 rounded-tr-sm pointer-events-none z-10" />
    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-primary/30 rounded-bl-sm pointer-events-none z-10" />
    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-primary/30 rounded-br-sm pointer-events-none z-10" />
  </>
);

const GlassPanel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-card/30 backdrop-blur-2xl border border-white/5 relative overflow-hidden", className)}>
    {children}
  </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">{children}</h4>
);

/** Custom styled toggle switch matching the app aesthetic */
const ToggleSwitch = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={cn(
      "w-14 h-8 rounded-full p-1 transition-colors duration-300 cursor-pointer shrink-0 relative",
      checked ? "bg-primary" : "bg-white/10",
    )}
  >
    <div
      className={cn(
        "w-6 h-6 rounded-full bg-white shadow transition-transform duration-300",
        checked ? "translate-x-6" : "translate-x-0",
      )}
    />
  </button>
);

/** Custom styled range slider */
const RangeSlider = ({
  value, min, max, step, onChange, disabled,
}: {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; disabled?: boolean;
}) => (
  <input
    type="range"
    min={min}
    max={max}
    step={step || 1}
    value={value}
    disabled={disabled}
    onChange={(e) => onChange(parseFloat(e.target.value))}
    className={cn(
      "w-full h-2 rounded-full appearance-none cursor-pointer bg-white/10 outline-none",
      "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4",
      "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-lg",
      "[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform",
      "[&::-webkit-slider-thumb]:hover:scale-125",
      "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full",
      "[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer",
      disabled && "opacity-30 cursor-not-allowed",
    )}
    style={{ accentColor: "var(--primary)" }}
  />
);

// ─── Main Component ──────────────────────────────────────────────────
const InterfaceSettings: React.FC<InterfaceSettingsProps> = ({ user, onBack, onClose }) => {
  const [presetName, setPresetName] = useState("Custom Echo Theme");
  const [themeId, setThemeId] = useState("custom");
  const [cssVariables, setCssVariables] = useState<ThemeCSSVariables>(() => ({ ...getDefaultTheme().cssVariables }));
  const [metadata, setMetadata] = useState<ThemeMetadata>(() => ({ ...getDefaultTheme().metadata }));
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [wallpaperMode, setWallpaperMode] = useState<"cover" | "repeat" | "blur">("cover");
  const [wallpaperBlur, setWallpaperBlur] = useState(8);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [glassEnabled, setGlassEnabled] = useState(false);
  const [glassBlur, setGlassBlur] = useState(12);
  const [glassOpacity, setGlassOpacity] = useState(0.6);
  const [selectedIconId, setSelectedIconId] = useState("default");
  const [colorOverrideEnabled, setColorOverrideEnabled] = useState(false);
  const [textSharpness, setTextSharpness] = useState(100); // 0-200, affects contrast via CSS
  const [colorHexes, setColorHexes] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const persistState = useCallback(() => {
    saveLocalThemeState({
      id: themeId, name: presetName, cssVariables, metadata,
      wallpaperUrl, wallpaperMode, wallpaperBlur,
      glassEnabled, glassBlur, glassOpacity, appIcon: selectedIconId,
      colorOverrideEnabled,
    });
  }, [themeId, presetName, cssVariables, metadata, wallpaperUrl, wallpaperMode, wallpaperBlur, glassEnabled, glassBlur, glassOpacity, selectedIconId, colorOverrideEnabled]);

  useEffect(() => {
    const saved = loadLocalThemeState();
    const glass = loadGlassSettings();
    if (saved) {
      setPresetName(saved.name || "Custom Echo Theme");
      setThemeId(saved.id || "custom");
      setCssVariables(saved.cssVariables);
      setMetadata(saved.metadata);
      setWallpaperUrl(saved.wallpaperUrl);
      setWallpaperMode(saved.wallpaperMode || "cover");
      setWallpaperBlur(saved.wallpaperBlur || 8);
      setSelectedIconId(saved.appIcon || "default");
      applyThemeToDOM(saved.cssVariables);
      applyChatWallpaper(saved.wallpaperUrl, saved.wallpaperMode || "cover", saved.wallpaperBlur || 0);
    }
    setGlassEnabled(glass.enabled);
    setGlassBlur(glass.blur);
    setGlassOpacity(glass.opacity);
    applyGlassSettings(glass.enabled, glass.blur, glass.opacity);
    if (saved) {
      setColorOverrideEnabled(saved.colorOverrideEnabled ?? false);
      applyColorOverride(saved.colorOverrideEnabled ?? false);
    } else {
      applyColorOverride(false);
    }
    const hexes: Record<string, string> = {};
    COLOR_ITEMS.forEach(item => { hexes[item.varName] = getCssVarAsHex(item.varName); });
    TEXT_ICON_ITEMS.forEach(item => { hexes[item.varName] = getCssVarAsHex(item.varName); });
    setColorHexes(hexes);
  }, []);

  useEffect(() => { persistState(); }, [persistState]);

  // ── Handlers ──────────────────────────────────────────────────────
  const handleColorChange = (varName: string, hex: string) => {
    const oklch = hexToOklchString(hex);
    document.documentElement.style.setProperty(varName, oklch);
    setCssVariables(prev => ({ ...prev, [varName]: oklch }));
    setColorHexes(prev => ({ ...prev, [varName]: hex }));
  };

  const updateGlass = (enabled: boolean, blur: number, opacity: number) => {
    setGlassEnabled(enabled); setGlassBlur(blur); setGlassOpacity(opacity);
    applyGlassSettings(enabled, blur, opacity);
    saveGlassSettings(enabled, blur, opacity);
  };

  const uploadWallpaper = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    setUploading(true);
    try {
      const fileName = `wallpaper_${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const { error: uploadError } = await supabase.storage.from("wallpapers").upload(fileName, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("wallpapers").getPublicUrl(fileName);
      setWallpaperUrl(data.publicUrl);
      applyChatWallpaper(data.publicUrl, wallpaperMode, wallpaperBlur);
      toast.success("Wallpaper uploaded to cloud");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload wallpaper");
    } finally { setUploading(false); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) uploadWallpaper(file); e.target.value = "";
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0]; if (file) uploadWallpaper(file);
  };
  const removeWallpaper = () => { setWallpaperUrl(null); applyChatWallpaper(null, wallpaperMode, 0); };
  const changeWallpaperMode = (mode: "cover" | "repeat" | "blur") => {
    setWallpaperMode(mode); applyChatWallpaper(wallpaperUrl, mode, wallpaperBlur);
  };

  const handleIconChange = (iconId: string) => {
    const icon = APP_ICONS.find(i => i.id === iconId);
    if (icon) { setSelectedIconId(iconId); setAppIcon(icon.iconSrc); }
  };

  const toggleColorOverride = (enabled: boolean) => {
    setColorOverrideEnabled(enabled);
    applyColorOverride(enabled);
  };

  /** Синхронизирует все -foreground переменные с --foreground */
  const syncAllTextColors = () => {
    const fgHex = colorHexes["--foreground"] || "#ffffff";
    const fgOklch = hexToOklchString(fgHex);
    const mutedHex = colorHexes["--muted-foreground"] || "#888888";
    const mutedOklch = hexToOklchString(mutedHex);
    const updates: Record<string, string> = {
      "--card-foreground": fgOklch,
      "--popover-foreground": fgOklch,
      "--sidebar-foreground": fgOklch,
      "--accent-foreground": fgOklch,
      "--secondary-foreground": fgOklch,
      "--destructive-foreground": fgOklch,
      "--icon-primary": fgOklch,
      "--icon-muted": mutedOklch,
      "--surface-white": fgOklch,
    };
    setCssVariables(prev => ({ ...prev, ...updates }));
    Object.entries(updates).forEach(([k, v]) => {
      document.documentElement.style.setProperty(k, v);
    });
    // Refresh hex display
    const hexes: Record<string, string> = {};
    [...COLOR_ITEMS, ...TEXT_ICON_ITEMS].forEach(item => { hexes[item.varName] = getCssVarAsHex(item.varName); });
    setColorHexes(hexes);
    toast.success("All text & icon colors synced");
  };

  const loadBuiltinTheme = (theme: EchoTheme) => {
    setThemeId(theme.id); setPresetName(theme.name);
    setCssVariables({ ...theme.cssVariables }); setMetadata({ ...theme.metadata });
    applyThemeToDOM(theme.cssVariables);
    const hexes: Record<string, string> = {};
    [...COLOR_ITEMS, ...TEXT_ICON_ITEMS].forEach(item => { hexes[item.varName] = getCssVarAsHex(item.varName); });
    setColorHexes(hexes);
    toast.success(`Theme "${theme.name}" applied`);
  };

  const saveToCloud = async () => {
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) { toast.error("Not authenticated. Please sign in first."); return; }
      const { error } = await supabase.from("user_themes").upsert({
        user_id: authData.user.id, theme_name: presetName,
        theme_data: JSON.stringify({ cssVariables, metadata }),
        icon: selectedIconId, wallpaper_url: wallpaperUrl,
        wallpaper_mode: wallpaperMode, wallpaper_blur: wallpaperBlur,
        glass_enabled: glassEnabled, glass_blur: glassBlur, glass_opacity: glassOpacity,
        color_override: colorOverrideEnabled,
        colors: cssVariables, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      toast.success("Theme saved to cloud");
    } catch (err: any) { toast.error(err.message || "Failed to save theme to cloud"); }
  };

  const exportPreset = () => {
    const preset = createPresetFromTheme({
      id: themeId, name: presetName, author: "Echo User",
      description: "Exported from Echo", isBuiltin: false,
      cssVariables, metadata, createdAt: Date.now(), updatedAt: Date.now(),
    });
    const fullExport = { ...preset, wallpaperUrl, wallpaperMode, wallpaperBlur, glassEnabled, glassBlur, glassOpacity, appIcon: selectedIconId, colorOverrideEnabled };
    const filename = `echo-${presetName.toLowerCase().replace(/\s+/g, "-")}.echo`;
    downloadFile(filename, JSON.stringify(fullExport, null, 2));
    toast.success(`Preset exported as ${filename}`);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const preset = parsePreset(text);
        setPresetName(preset.name); setCssVariables(preset.cssVariables);
        setMetadata(preset.metadata); setThemeId(generateThemeId());
        applyThemeToDOM(preset.cssVariables);
        const full = JSON.parse(text) as any;
        if (full.wallpaperUrl !== undefined) {
          setWallpaperUrl(full.wallpaperUrl); setWallpaperMode(full.wallpaperMode || "cover");
          setWallpaperBlur(full.wallpaperBlur || 0);
          applyChatWallpaper(full.wallpaperUrl, full.wallpaperMode || "cover", full.wallpaperBlur || 0);
        }
        if (full.glassEnabled !== undefined) updateGlass(full.glassEnabled, full.glassBlur || 12, full.glassOpacity || 0.6);
        if (full.appIcon) handleIconChange(full.appIcon);
        if (full.colorOverrideEnabled !== undefined) toggleColorOverride(full.colorOverrideEnabled);
        const hexes: Record<string, string> = {};
        [...COLOR_ITEMS, ...TEXT_ICON_ITEMS].forEach(item => { hexes[item.varName] = getCssVarAsHex(item.varName); });
        setColorHexes(hexes);
        toast.success(`Preset "${preset.name}" imported`);
      } catch (err: any) { toast.error(`Import failed: ${err.message}`); }
    };
    reader.readAsText(file); e.target.value = "";
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-10 space-y-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white sm:hidden" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-display font-bold tracking-tight">Interface</h2>
            <p className="text-muted-foreground text-[10px] font-mono uppercase tracking-[0.3em] mt-1">Modular Customizer · v1.0</p>
          </div>
        </div>
        <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ═══════════ BLOCK 1: PRESET MANAGEMENT ═══════════ */}
      <section className="space-y-6">
        <SectionLabel>Preset Management</SectionLabel>

        <GlassPanel className="p-6 rounded-[28px]">
          <CornerBrackets />
          <div className="space-y-5">
            {/* Preset name input */}
            <div className="space-y-2">
              <label className="text-[10px] font-mono uppercase tracking-widest text-white/40">Preset Name</label>
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="w-full h-12 px-4 rounded-2xl bg-white/5 border border-white/10 text-sm font-medium focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="My Custom Theme"
              />
            </div>

            {/* Built-in theme selector */}
            <div className="space-y-3">
              <label className="text-[10px] font-mono uppercase tracking-widest text-white/40">Built-in Themes</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {BUILTIN_THEMES.map(theme => (
                  <button
                    key={theme.id}
                    onClick={() => loadBuiltinTheme(theme)}
                    className={cn(
                      "p-3 rounded-2xl border transition-all text-left",
                      themeId === theme.id
                        ? "border-primary/50 bg-primary/10 shadow-lg shadow-primary/10"
                        : "border-white/5 bg-white/[0.02] hover:border-white/20 hover:bg-white/5",
                    )}
                  >
                    <div className="flex gap-1 mb-2">
                      <div className="w-5 h-5 rounded-md" style={{ background: theme.cssVariables['--primary'] }} />
                      <div className="w-5 h-5 rounded-md" style={{ background: theme.cssVariables['--background'] }} />
                      <div className="w-5 h-5 rounded-md" style={{ background: theme.cssVariables['--card'] }} />
                    </div>
                    <div className="text-xs font-bold truncate">{theme.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <button
                onClick={saveToCloud}
                className="h-12 rounded-2xl bg-primary/15 border border-primary/30 text-primary font-bold text-xs uppercase tracking-widest hover:bg-primary/25 transition-all flex items-center justify-center gap-2"
              >
                <CloudUpload className="w-4 h-4" /> Save to Cloud
              </button>
              <button
                onClick={exportPreset}
                className="h-12 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> Export Preset
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                className="h-12 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" /> Import Preset
              </button>
              <input ref={importInputRef} type="file" accept=".echo,.json" onChange={handleImport} className="hidden" />
            </div>
          </div>
        </GlassPanel>
      </section>

      {/* ═══════════ BLOCK 2: CHAT WALLPAPER ═══════════ */}
      <section className="space-y-6">
        <SectionLabel>Chat Wallpaper</SectionLabel>

        <GlassPanel className="p-6 rounded-[28px]">
          <CornerBrackets />
          <div className="space-y-5">
            {/* Drag-and-drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "rounded-[28px] border-2 border-dashed p-8 text-center cursor-pointer transition-all",
                dragOver ? "border-primary/50 bg-primary/5" : "border-white/10 hover:border-primary/30 hover:bg-white/[0.02]",
              )}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader className="w-8 h-8 text-primary animate-spin" />
                  <span className="text-xs font-mono uppercase tracking-widest text-white/40">Uploading...</span>
                </div>
              ) : wallpaperUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-24 h-24 rounded-2xl border-2 border-white/10 overflow-hidden bg-white/5">
                    <img src={wallpaperUrl} alt="Wallpaper preview" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-xs text-white/40 font-mono">Click to replace · Drag new image</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-4">
                  <ImageIcon className="w-8 h-8 text-white/30" />
                  <div className="text-xs font-mono uppercase tracking-widest text-white/40">
                    Drag image here or click to upload
                  </div>
                  <div className="text-[10px] text-white/20">.jpg · .png · .webp</div>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
            </div>

            {/* Remove button */}
            {wallpaperUrl && (
              <button
                onClick={removeWallpaper}
                className="w-full h-10 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive font-bold text-xs uppercase tracking-widest hover:bg-destructive/20 transition-all flex items-center justify-center gap-2"
              >
                <Trash className="w-4 h-4" /> Remove Wallpaper
              </button>
            )}

            {/* Display mode toggles */}
            <div className="space-y-2">
              <label className="text-[10px] font-mono uppercase tracking-widest text-white/40">Display Mode</label>
              <div className="grid grid-cols-3 gap-2">
                {(["cover", "repeat", "blur"] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => changeWallpaperMode(mode)}
                    className={cn(
                      "h-10 rounded-2xl border text-xs font-bold uppercase tracking-widest transition-all",
                      wallpaperMode === mode
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-white/10 bg-white/5 text-white/40 hover:text-white hover:bg-white/10",
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Blur slider (only in blur mode) */}
            {wallpaperMode === "blur" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-mono uppercase tracking-widest text-white/40">Background Blur</label>
                  <span className="text-xs font-mono text-primary">{wallpaperBlur}px</span>
                </div>
                <RangeSlider value={wallpaperBlur} min={0} max={20} onChange={(v) => { setWallpaperBlur(v); applyChatWallpaper(wallpaperUrl, "blur", v); }} />
              </div>
            )}
          </div>
        </GlassPanel>
      </section>
      {/* ═══════════ BLOCK 3: GLASSMORPHISM ═══════════ */}
      <section className="space-y-6">
        <SectionLabel>Glassmorphism &amp; Liquid Glass</SectionLabel>
        <GlassPanel className="p-6 rounded-[28px]">
          <CornerBrackets />
          <div className="space-y-5">
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-primary/15 flex items-center justify-center">
                  <GlassIcon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="font-bold text-sm">Enable Glassmorphism</div>
                  <div className="text-xs text-white/40 mt-0.5">Apply liquid glass to panels, cards &amp; sidebar</div>
                </div>
              </div>
              <ToggleSwitch checked={glassEnabled} onChange={(v) => updateGlass(v, glassBlur, glassOpacity)} />
            </div>
            <div className={cn("space-y-2 transition-opacity", !glassEnabled && "opacity-40")}>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono uppercase tracking-widest text-white/40">Background Blur</label>
                <span className="text-xs font-mono text-primary">{glassBlur}px</span>
              </div>
              <RangeSlider value={glassBlur} min={0} max={30} disabled={!glassEnabled}
                onChange={(v) => updateGlass(glassEnabled, v, glassOpacity)} />
            </div>
            <div className={cn("space-y-2 transition-opacity", !glassEnabled && "opacity-40")}>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono uppercase tracking-widest text-white/40">Panel Opacity</label>
                <span className="text-xs font-mono text-primary">{glassOpacity.toFixed(2)}</span>
              </div>
              <RangeSlider value={glassOpacity} min={0.1} max={0.9} step={0.05} disabled={!glassEnabled}
                onChange={(v) => updateGlass(glassEnabled, glassBlur, v)} />
            </div>
          </div>
        </GlassPanel>
      </section>

      {/* ═══════════ BLOCK 4: APPLICATION ICON ═══════════ */}
      <section className="space-y-6">
        <SectionLabel>Application Icon</SectionLabel>
        <GlassPanel className="p-6 rounded-[28px]">
          <CornerBrackets />
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl border-2 border-white/10 overflow-hidden bg-white/5 shrink-0">
              <img src={APP_ICONS.find(i => i.id === selectedIconId)?.iconSrc || APP_ICONS[0].iconSrc}
                alt="App icon" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 space-y-2">
              <label className="text-[10px] font-mono uppercase tracking-widest text-white/40">Icon Style</label>
              <div className="relative">
                <select value={selectedIconId} onChange={(e) => handleIconChange(e.target.value)}
                  className="w-full h-12 px-4 pr-10 rounded-2xl bg-white/5 border border-white/10 text-sm font-medium focus:outline-none focus:border-primary/50 transition-colors appearance-none cursor-pointer">
                  {APP_ICONS.map(icon => (
                    <option key={icon.id} value={icon.id} className="bg-background text-foreground">{icon.label}</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                  <AppWindowIcon className="w-4 h-4 text-white/30" />
                </div>
              </div>
            </div>
          </div>
        </GlassPanel>
      </section>

      {/* ═══════════ BLOCK 5: THEME COLOR PALETTE ═══════════ */}
      <section className="space-y-6">
        <SectionLabel>Theme Color Palette</SectionLabel>
        <GlassPanel className="p-6 rounded-[28px]">
          <CornerBrackets />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {COLOR_ITEMS.map(item => (
              <div key={item.varName} className="space-y-3">
                <label className="text-[10px] font-mono uppercase tracking-widest text-white/40 block">{item.label}</label>
                <div className="flex items-center gap-3">
                  <div className="relative w-12 h-12 rounded-2xl border-2 border-white/10 overflow-hidden shrink-0 cursor-pointer">
                    <div className="absolute inset-0" style={{ backgroundColor: colorHexes[item.varName] || "#8b7aec" }} />
                    <input type="color" value={colorHexes[item.varName] || "#8b7aec"}
                      onChange={(e) => handleColorChange(item.varName, e.target.value)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" aria-label={item.label} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-white/60 uppercase truncate">{colorHexes[item.varName] || "#8b7aec"}</div>
                    <div className="text-[9px] font-mono text-white/20 truncate">{item.varName}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-5 mt-5 border-t border-white/5">
            <button onClick={() => loadBuiltinTheme(getDefaultTheme())}
              className="h-10 px-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2">
              <ColorSwatchIcon className="w-4 h-4" /> Reset to Default
            </button>
          </div>
        </GlassPanel>
      </section>

    </div>
  );
};

export default InterfaceSettings;


