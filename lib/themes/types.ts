// lib/themes/types.ts
// Модульная система тем для Echo — типы данных

export interface ThemeCSSVariables {
  // Backgrounds
  '--background': string;
  '--foreground': string;
  '--card': string;
  '--card-foreground': string;
  '--popover': string;
  '--popover-foreground': string;
  '--muted': string;
  '--muted-foreground': string;
  '--accent': string;
  '--accent-foreground': string;
  // Interactive
  '--primary': string;
  '--primary-foreground': string;
  '--secondary': string;
  '--secondary-foreground': string;
  '--destructive': string;
  '--destructive-foreground': string;
  // Borders & Rings
  '--border': string;
  '--input': string;
  '--ring': string;
  // Sidebar
  '--sidebar': string;
  '--sidebar-foreground': string;
  '--sidebar-primary': string;
  '--sidebar-primary-foreground': string;
  '--sidebar-accent': string;
  '--sidebar-accent-foreground': string;
  '--sidebar-border': string;
  '--sidebar-ring': string;
  // Charts
  '--chart-1': string;
  '--chart-2': string;
  '--chart-3': string;
  '--chart-4': string;
  '--chart-5': string;
  // Radius
  '--radius': string;
  // Chat-specific
  '--chat-bubble-self'?: string;
  '--chat-bubble-other'?: string;
  '--chat-bubble-self-text'?: string;
  '--chat-bubble-other-text'?: string;
  '--chat-wallpaper'?: string;
  '--chat-wallpaper-overlay'?: string;
  // Icon & Text override colors
  '--icon-primary'?: string;
  '--icon-muted'?: string;
  '--surface-white'?: string;
  // Custom extras
  [key: `--${string}`]: string | undefined;
}

export interface ThemeMetadata {
  /** Общий фон для чатов (url, gradient, pattern) */
  chatWallpaperDefault?: string;
  chatWallpaperType?: 'solid' | 'gradient' | 'photo' | 'pattern';
  chatWallpaperBlur?: number;
  chatWallpaperOpacity?: number;
  chatWallpaperBrightness?: number;
  /** Фон для своего сообщения */
  bubbleSelfBg?: string;
  bubbleOtherBg?: string;
  /** Стиль скругления */
  bubbleStyle?: 'rounded' | 'pill' | 'square';
  /** Настройки сетки */
  messageSpacing?: 'compact' | 'normal' | 'comfortable';
  /** Доп. поля */
  [key: string]: unknown;
}

export interface EchoTheme {
  id: string;
  name: string;
  author: string;
  description: string;
  isBuiltin: boolean;
  cssVariables: ThemeCSSVariables;
  metadata: ThemeMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface ChatWallpaperSettings {
  chatId: string;
  wallpaperType: 'solid' | 'gradient' | 'photo' | 'pattern';
  wallpaperValue: string;
  blur: number;
  opacity: number;
  brightness: number;
  updatedAt: number;
}

/** Формат .echo-theme файла для экспорта/импорта */
export interface EchoThemePreset {
  echoThemeVersion: 1;
  name: string;
  author: string;
  description: string;
  cssVariables: ThemeCSSVariables;
  metadata: ThemeMetadata;
  exportedAt: string;
}

/** Категория настройки темы для редактора */
export type ThemeSettingCategory =
  | 'backgrounds'
  | 'interactive'
  | 'borders'
  | 'sidebar'
  | 'charts'
  | 'chat'
  | 'radius';

export const THEME_SETTING_CATEGORIES: Record<ThemeSettingCategory, { label: string; keys: (keyof ThemeCSSVariables)[] }> = {
  backgrounds: {
    label: 'Фоны',
    keys: ['--background', '--foreground', '--card', '--card-foreground', '--popover', '--popover-foreground', '--muted', '--muted-foreground', '--accent', '--accent-foreground'],
  },
  interactive: {
    label: 'Интерактивные',
    keys: ['--primary', '--primary-foreground', '--secondary', '--secondary-foreground', '--destructive', '--destructive-foreground'],
  },
  borders: {
    label: 'Границы и кольца',
    keys: ['--border', '--input', '--ring'],
  },
  sidebar: {
    label: 'Боковая панель',
    keys: ['--sidebar', '--sidebar-foreground', '--sidebar-primary', '--sidebar-primary-foreground', '--sidebar-accent', '--sidebar-accent-foreground', '--sidebar-border', '--sidebar-ring'],
  },
  charts: {
    label: 'Диаграммы',
    keys: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'],
  },
  chat: {
    label: 'Чат',
    keys: ['--chat-bubble-self', '--chat-bubble-other', '--chat-bubble-self-text', '--chat-bubble-other-text', '--chat-wallpaper', '--chat-wallpaper-overlay'],
  },
  radius: {
    label: 'Скругление',
    keys: ['--radius'],
  },
};
