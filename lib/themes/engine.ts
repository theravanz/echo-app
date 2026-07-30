// lib/themes/engine.ts
// Движок применения CSS-переменных и конвертации цветов для модульной системы тем Echo

import { EchoTheme, ThemeCSSVariables, EchoThemePreset, ThemeMetadata } from './types';
import { getDefaultTheme } from './defaults';

const ACTIVE_THEME_KEY = 'echo_active_theme';
const GLASS_KEY = 'echo_glass_settings';

// ════════════════════════════════════════════════════════════════════
// CSS Variable Application
// ════════════════════════════════════════════════════════════════════

/** Применяет все CSS-переменные темы к :root документа */
export function applyThemeToDOM(cssVars: ThemeCSSVariables): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(cssVars)) {
    if (value != null && value !== '') {
      root.style.setProperty(key, value);
    }
  }
}

/** Сбрасывает все CSS-переменные к значениям по умолчанию */
export function resetThemeToDefault(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const defaultTheme = getDefaultTheme();
  Object.keys(defaultTheme.cssVariables).forEach(key => {
    root.style.removeProperty(key);
  });
  applyThemeToDOM(defaultTheme.cssVariables);
}

/** Применяет настройки glassmorphism */
export function applyGlassSettings(enabled: boolean, blur: number, opacity: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--glass-blur', `${blur}px`);
  root.style.setProperty('--glass-opacity', String(opacity));
  root.style.setProperty('--glass-saturation', enabled ? '180%' : '0%');
  if (enabled) {
    document.body.classList.add('echo-glass-mode');
  } else {
    document.body.classList.remove('echo-glass-mode');
  }
}

/** Включает/выключает режим оверрайда хардкод-цветов (text-white → CSS переменные) */
export function applyColorOverride(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  if (enabled) {
    document.body.classList.add('echo-color-override');
  } else {
    document.body.classList.remove('echo-color-override');
  }
}

/** Применяет обои чата */
export function applyChatWallpaper(
  url: string | null,
  mode: 'cover' | 'repeat' | 'blur',
  blurAmount: number = 0,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (url) {
    root.style.setProperty('--chat-wallpaper', `url(${url})`);
    root.style.setProperty('--chat-wallpaper-size', mode === 'repeat' ? 'auto' : 'cover');
    root.style.setProperty('--chat-wallpaper-repeat', mode === 'repeat' ? 'repeat' : 'no-repeat');
    root.style.setProperty('--chat-wallpaper-blur', mode === 'blur' ? `${blurAmount}px` : '0px');
  } else {
    root.style.setProperty('--chat-wallpaper', '');
    root.style.setProperty('--chat-wallpaper-blur', '0px');
  }
}

// ════════════════════════════════════════════════════════════════════
// Color Conversion (oklch/rgb <-> hex)
// ════════════════════════════════════════════════════════════════════

/** Получает вычисленное значение CSS-переменной как hex (#rrggbb) */
export function getCssVarAsHex(varName: string): string {
  if (typeof document === 'undefined') return '#8b7aec';
  try {
    const root = document.documentElement;
    const temp = document.createElement('div');
    temp.style.color = `var(${varName})`;
    temp.style.display = 'none';
    root.appendChild(temp);
    const computed = getComputedStyle(temp).color;
    root.removeChild(temp);
    return rgbStringToHex(computed);
  } catch {
    return '#8b7aec';
  }
}

/** Конвертирует rgb()/rgba() строку в hex */
export function rgbStringToHex(rgb: string): string {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return '#8b7aec';
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/** Конвертирует hex в rgb компоненты */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return { r, g, b };
}

/** Конвертирует hex в oklch строку (приблизительно) */
export function hexToOklchString(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const R = lin(rn), G = lin(gn), B = lin(bn);
  const X = 0.4123908 * R + 0.3575843 * G + 0.1804808 * B;
  const Y = 0.2126390 * R + 0.7151687 * G + 0.0721923 * B;
  const Z = 0.0193308 * R + 0.1191948 * G + 0.9505322 * B;
  const l_ = Math.cbrt(0.8189110 * X + 0.3618624 * Y - 0.1288648 * Z);
  const m_ = Math.cbrt(0.0329846 * X + 0.9292380 * Y + 0.0361455 * Z);
  const s_ = Math.cbrt(0.0482002 * X + 0.2643673 * Y + 0.6334237 * Z);
  const L = 0.2104543 * l_ + 0.7936178 * m_ - 0.0040724 * s_;
  const a = 1.9779980 * l_ - 2.4285960 * m_ + 0.4505940 * s_;
  const b_ = 0.0259034 * l_ + 0.7829890 * m_ - 0.8088370 * s_;
  const C = Math.sqrt(a * a + b_ * b_);
  const H = Math.atan2(b_, a) * (180 / Math.PI);
  const h = H < 0 ? H + 360 : H;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`;
}

// ════════════════════════════════════════════════════════════════════
// Preset Export / Import
// ════════════════════════════════════════════════════════════════════

export function createPresetFromTheme(theme: EchoTheme): EchoThemePreset {
  return {
    echoThemeVersion: 1,
    name: theme.name,
    author: theme.author || 'Echo User',
    description: theme.description,
    cssVariables: { ...theme.cssVariables },
    metadata: { ...theme.metadata },
    exportedAt: new Date().toISOString(),
  };
}

export function downloadFile(filename: string, content: string, mimeType: string = 'application/json'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parsePreset(jsonString: string): EchoThemePreset {
  const data = JSON.parse(jsonString);
  if (!data.cssVariables || typeof data.cssVariables !== 'object') {
    throw new Error('Invalid preset: missing cssVariables');
  }
  return {
    echoThemeVersion: data.echoThemeVersion || 1,
    name: data.name || 'Imported Theme',
    author: data.author || 'Unknown',
    description: data.description || '',
    cssVariables: data.cssVariables,
    metadata: data.metadata || {},
    exportedAt: data.exportedAt || new Date().toISOString(),
  };
}

export function generateThemeId(): string {
  return `theme_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ════════════════════════════════════════════════════════════════════
// LocalStorage Persistence
// ════════════════════════════════════════════════════════════════════

export interface LocalThemeState {
  id: string;
  name: string;
  cssVariables: ThemeCSSVariables;
  metadata: ThemeMetadata;
  wallpaperUrl: string | null;
  wallpaperMode: 'cover' | 'repeat' | 'blur';
  wallpaperBlur: number;
  glassEnabled: boolean;
  glassBlur: number;
  glassOpacity: number;
  appIcon: string;
  colorOverrideEnabled: boolean;
  textSharpness: number;
}

export function saveLocalThemeState(state: LocalThemeState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_THEME_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('[Theme] Failed to save state:', e);
  }
}

export function loadLocalThemeState(): LocalThemeState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTIVE_THEME_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalThemeState;
  } catch {
    return null;
  }
}

export function saveGlassSettings(enabled: boolean, blur: number, opacity: number): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(GLASS_KEY, JSON.stringify({ enabled, blur, opacity }));
}

export function loadGlassSettings(): { enabled: boolean; blur: number; opacity: number } {
  if (typeof localStorage === 'undefined') return { enabled: false, blur: 12, opacity: 0.6 };
  try {
    const raw = localStorage.getItem(GLASS_KEY);
    if (!raw) return { enabled: false, blur: 12, opacity: 0.6 };
    return JSON.parse(raw);
  } catch {
    return { enabled: false, blur: 12, opacity: 0.6 };
  }
}

// ════════════════════════════════════════════════════════════════════
// Application Icon Management
// ════════════════════════════════════════════════════════════════════

export interface AppIconPreset {
  id: string;
  label: string;
  iconSrc: string;
}

export const APP_ICONS: AppIconPreset[] = [
  {
    id: 'default',
    label: 'Default Echo',
    iconSrc: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0a0a0c"/><path d="M30 35 Q30 28 37 28 L63 28 Q70 28 70 35 L70 55 Q70 62 63 62 L45 62 L35 72 L35 62 Q30 62 30 55 Z" fill="none" stroke="#8b7aec" stroke-width="3" stroke-linejoin="round"/><circle cx="42" cy="45" r="3" fill="#8b7aec"/><circle cx="58" cy="45" r="3" fill="#8b7aec"/></svg>`
    ),
  },
  {
    id: 'neon-cyber',
    label: 'Neon Cyber',
    iconSrc: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#050508"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00f0ff"/><stop offset="1" stop-color="#8b00ff"/></linearGradient></defs><path d="M30 35 Q30 28 37 28 L63 28 Q70 28 70 35 L70 55 Q70 62 63 62 L45 62 L35 72 L35 62 Q30 62 30 55 Z" fill="none" stroke="url(#g)" stroke-width="3.5" stroke-linejoin="round"/><circle cx="42" cy="45" r="3" fill="#00f0ff"/><circle cx="58" cy="45" r="3" fill="#8b00ff"/></svg>`
    ),
  },
  {
    id: 'minimal-dark',
    label: 'Minimal Dark',
    iconSrc: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="#111114"/><path d="M30 35 Q30 28 37 28 L63 28 Q70 28 70 35 L70 55 Q70 62 63 62 L45 62 L35 72 L35 62 Q30 62 30 55 Z" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round" opacity="0.7"/><circle cx="42" cy="45" r="2.5" fill="#ffffff" opacity="0.7"/><circle cx="58" cy="45" r="2.5" fill="#ffffff" opacity="0.7"/></svg>`
    ),
  },
];

export function setAppIcon(iconSrc: string): void {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = iconSrc;
  link.type = 'image/svg+xml';
}

