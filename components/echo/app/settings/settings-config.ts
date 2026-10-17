// Конфиг и типы модуля настроек.

import type { ComponentType } from "react";
import type { UserProfile } from "@/hooks/echo/types";
import {
  TbUser as User,
  TbBell as Bell,
  TbPalette as Palette,
  TbDeviceDesktop as HardDrive,
  TbWifi as Wifi,
  TbShield as Shield,
  TbLanguage as Language,
} from "react-icons/tb";

// ─── Типы вьюх ───
// 'security' удалён: ни один пункт меню не имел action: 'security',
// кейс в мобильном switch был недостижимым кодом.

export type ViewType =
  | 'profile'
  | 'privacy'
  | 'devices'
  | 'language'
  | 'alerts'
  | 'interface'
  | null;

// ─── Меню ───

export interface MenuItem {
  id: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  sublabel?: string;
  action?: ViewType;
  badge?: 'beta' | 'wip';
}

export interface MenuSection {
  label: string;
  items: MenuItem[];
  isSecurity?: boolean;
}

export const LANGUAGES = [
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'en', label: 'English', native: 'English' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'zh', label: 'Chinese', native: '中文' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'ar', label: 'Arabic', native: 'العربية' }
];

export const menuSections: MenuSection[] = [
  {
    label: 'Core System',
    items: [
      { id: 'profile', icon: User, label: 'Identity', action: 'profile' },
      { id: 'alerts', icon: Bell, label: 'Alerts', action: 'alerts', badge: 'beta' },
      { id: 'interface', icon: Palette, label: 'Interface', action: 'interface', badge: 'beta' },
      { id: 'storage', icon: HardDrive, label: 'Storage', badge: 'wip' },
      { id: 'network', icon: Wifi, label: 'Network', badge: 'wip' },
    ]
  },
  {
    label: 'Security',
    isSecurity: true,
    items: [
      { id: 'privacy', icon: Shield, label: 'Privacy', action: 'privacy' },
      { id: 'devices', icon: HardDrive, label: 'Devices', action: 'devices' },
    ]
  },
  {
    label: 'Advanced',
    items: [
      { id: 'language', icon: Language, label: 'Language', action: 'language', badge: 'wip' },
    ]
  }
];

// ─── Типы данных ───

// Пользователь — общий тип приложения UserProfile из @/hooks/echo/types.
// Свой структурный SettingsUser убран: его email: string | null | undefined
// был несовместим с UserProfile (email: string | undefined), из-за чего
// не проходил в useNotificationSettings, а не-nullable проп ломал место вызова
// в app/page.tsx, которое передаёт состояние как UserProfile | null.

// Устройство после мёржа источников (Supabase `devices` + нативный SQLite).
// Поля опциональны: старые записи из БД могут не содержать новых колонок.
export interface MergedDevice {
  id: string;
  hwid?: string | null;
  user_id?: string;
  device_name?: string | null;
  os_name?: string | null;
  browser_name?: string | null;
  platform?: string | null;
  device_type?: string | null;
  location?: string | null;
  timezone?: string | null;
  is_vpn?: boolean | number | string | null;
  last_active?: string | number | null;
  [key: string]: any;
}

// Аккаунт в Multi-Account Bridge.
export interface BridgeAccount {
  uid: string;
  email?: string | null;
  displayName?: string;
  username?: string;
}

export interface SettingsModalProps {
  user: UserProfile | null;
  accounts?: BridgeAccount[];
  onClose: () => void;
  isQuarantined?: boolean;
  quarantineTime?: string;
  onUpdateUser?: (patch: Record<string, any>) => void;
}
