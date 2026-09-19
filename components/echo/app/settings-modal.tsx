"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cn, safeChar } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { getDevices, deleteDevice, generateHWID, saveDevice, clearCryptoKeys, type Device } from "@/lib/db";
import { clearAuthProgress } from "@/lib/auth-storage";
import { registerNavLayer } from "@/lib/back-nav";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
  TbChevronDown as ChevronDownIcon,
  TbBell as Bell,
  TbDatabase as Database,
  TbShield as Shield,
  TbFolder as Folder,
  TbDeviceDesktop as HardDrive,
  TbGlobe as Globe,
  TbStar as Star,
  TbGift as Gift,
  TbEye as Eye,
  TbInfoCircle as Info,
  TbBoltOff as ZapOff,
  TbLogout as LogOut,
  TbShieldCheck as ShieldCheck,
  TbBrandWindows as BrandWindows,
  TbBrandApple as BrandApple,
  TbBrandAndroid as BrandAndroid,
  TbBrandUbuntu as BrandUbuntu,
  TbRefresh as RefreshCw,
  TbLanguage as Language,
  TbUser as User,
  TbPalette as Palette,
  TbWifi as Wifi,
  TbFingerprint as Fingerprint,
  TbAlertTriangle as AlertTriangle,
  TbUserPlus as UserPlus,
  TbCheck as Check,
  TbQrcode as QrCode,
  TbMapPin as TbMapPin,
} from "react-icons/tb";

import type { UserProfile } from "@/hooks/echo/types";
import { useNotificationSettings, type NotificationSettings } from "@/hooks/echo/use-notification-settings";
import { ProfileEditPanel, type EditableProfile } from "@/components/echo/app/profile-edit-panel";
import InterfaceSettings from "@/components/echo/app/interface-settings";
import { QrLoginScanner } from "@/components/echo/app/qr-login-scanner";
import { resolveDeviceGeo } from "@/lib/device-info";

interface SettingsModalProps {
  user: any;
  accounts?: any[];
  onClose: () => void;
  isQuarantined?: boolean;
  quarantineTime?: string;
  onUpdateUser?: (patch: Record<string, any>) => void;
}

const CornerBrackets = () => (
  <>
    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-primary/30 rounded-tl-sm pointer-events-none z-10" />
    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-primary/30 rounded-tr-sm pointer-events-none z-10" />
    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-primary/30 rounded-bl-sm pointer-events-none z-10" />
    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-primary/30 rounded-br-sm pointer-events-none z-10" />
  </>
);

const GlassPanel = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("bg-card/30 backdrop-blur-2xl border border-white/5 relative overflow-hidden", className)}>
    {children}
  </div>
);

const LANGUAGES = [
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

type ViewType = 'profile' | 'privacy' | 'devices' | 'language' | 'alerts' | 'interface' | 'security' | null;

interface MenuItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sublabel?: string;
  action?: ViewType;
  badge?: 'beta' | 'wip';
}

interface MenuSection {
  label: string;
  items: MenuItem[];
  isSecurity?: boolean;
}

const Badge = ({ type }: { type: 'beta' | 'wip' }) => (
  <span className={`text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${
    type === 'beta' ? 'text-primary border-primary/30 bg-primary/10' : 'text-amber-500 border-amber-500/30 bg-amber-500/10'
  }`}>
    {type === 'beta' ? 'Beta' : 'In Development'}
  </span>
);

const menuSections: MenuSection[] = [
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

const SettingsModal: React.FC<SettingsModalProps> = ({ user, accounts = [], onClose, isQuarantined, quarantineTime, onUpdateUser }) => {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [activeView, setActiveView] = useState<ViewType>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentHwid, setCurrentHwid] = useState('');
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [isLastSeenVisible, setIsLastSeenVisible] = useState(user?.user_metadata?.privacy_last_seen !== false);
  const [currentLang, setCurrentLang] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('echo_language') || 'ru';
    }
    return 'ru';
  });

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[Settings] Logout failed', e);
    }

    // Очищаем всё локальное состояние, чтобы на /auth не висели старые прогрессы / ключи
    try {
      await clearAuthProgress();
    } catch {
      // ignore
    }
    try {
      await clearCryptoKeys();
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem('echo_public_key');
      localStorage.removeItem('echo_mnemonic_backup');
    } catch {
      // ignore
    }

    onClose?.();
    router.push('/auth');
  };

  // VPN Detection — check IP/timezone mismatch (через lib/device-info)
  const [isVpnDetected, setIsVpnDetected] = useState(false);
  const [currentGeo, setCurrentGeo] = useState<any>(null);
  const [securityExpanded, setSecurityExpanded] = useState(true);

  // ─── BACK-NAV: внутренние слои настроек в едином back-стеке ───
  // QR-сканер (120) над мобильным drill-down экраном (115), который выше
  // самой модалки настроек (110, зарегистрирована в app/page.tsx).
  // На iOS/Android edge-swipe и системный back отсюда поднимаются наверх:
  // sub-view → главное меню → закрыть настройки.
  useEffect(() => {
    if (!showQrScanner) return;
    return registerNavLayer({
      id: "settings-qr-scanner",
      priority: 120,
      isOpen: () => true,
      close: () => setShowQrScanner(false),
    });
  }, [showQrScanner]);

  useEffect(() => {
    if (!activeView) return;
    return registerNavLayer({
      id: "settings-sub-view",
      priority: 115,
      isOpen: () => true,
      close: () => setActiveView(null),
    });
  }, [activeView]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const geo = await resolveDeviceGeo();
        if (cancelled || !geo) return;
        setCurrentGeo(geo);
        if (geo.isVpn) {
          setIsVpnDetected(true);
          console.warn('[VPN] Timezone mismatch:', geo.ipTz, 'vs', geo.tz);
        }
      } catch { /* silent fail */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Notifications settings
  const { settings: notifSettings, updateSetting: updateNotifSetting } = useNotificationSettings(user || null);

  // Use native generateHWID from db.ts
  useEffect(() => {
    (async () => {
      try {
        const hwid = await generateHWID();
        setCurrentHwid(hwid);
      } catch {
        const fallback = localStorage.getItem('echo_device_hwid');
        if (fallback) setCurrentHwid(fallback);
      }
    })();
  }, []);

  useEffect(() => {
    if (activeView === 'devices') {
      fetchDevices();
      // Каждый раз при открытии Devices пере-определяем гео текущего устройства,
      // чтобы локация/VPN отображались даже если при регистрации гео-сервис не ответил.
      (async () => {
        try {
          const geo = await resolveDeviceGeo();
          if (!geo) return;
          setCurrentGeo(geo);
          if (geo.isVpn) setIsVpnDetected(true);
        } catch { /* silent */ }
      })();
    }
  }, [activeView]);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      if (!user?.id) { setLoading(false); return; }

      // Merge devices from both sources
      const allDevices: Record<string, any> = {};

      // 1. From Supabase
      try {
        const { data: supabaseDevices } = await supabase
          .from('devices')
          .select('*')
          .eq('user_id', user.id)
          .order('last_active', { ascending: false });
        if (supabaseDevices) {
          supabaseDevices.forEach(d => { allDevices[d.hwid || d.id] = d; });
        }
      } catch (e) { console.warn('[Settings] Supabase fetch failed:', e); }

      // 2. From SQLite (native)
      try {
        const nativeDevices = await getDevices(user.id);
        if (nativeDevices) {
          nativeDevices.forEach(d => { allDevices[d.hwid || d.id] = d; });
        }
      } catch (e) { console.warn('[Settings] SQLite fetch failed:', e); }

      setDevices(Object.values(allDevices));
    } catch (err) {
      console.error('[Settings] fetchDevices fatal:', err);
    }
    setLoading(false);
  };

  const toggleLastSeen = async () => {
    if (isQuarantined) {
      alert('Action limited. New devices must pass 32-hour quarantine before changing privacy settings.');
      return;
    }
    const newValue = !isLastSeenVisible;
    setIsLastSeenVisible(newValue);
    await supabase.from('profiles').update({
      user_metadata: { ...user.user_metadata, privacy_last_seen: newValue }
    }).eq('id', user.id);
  };

  const handleTerminateDevice = async (deviceId: string) => {
    if (isQuarantined) {
      alert('Action limited. New devices must pass 32-hour quarantine for session management.');
      return;
    }
    if (!window.confirm('Terminate this session?')) return;

    // 1. Delete from native SQLite
    try { await deleteDevice(deviceId); } catch (e) { console.warn('[Settings] native deleteDevice failed:', e); }

    // 2. Try Supabase RPC
    try {
      const { error } = await supabase.rpc('terminate_device_session', {
        target_device_id: deviceId, requester_hwid: currentHwid
      });
      if (error) throw error;
    } catch {
      // 3. Fallback to direct Supabase delete
      try { await supabase.from('devices').delete().eq('id', deviceId); } catch {}
    }

    setDevices(prev => prev.filter(d => d.id !== deviceId));
  };

  const handleTerminateOthers = async () => {
    if (isQuarantined) {
      alert('Action limited. New devices must pass 32-hour quarantine for session management.');
      return;
    }
    if (!window.confirm('Terminate all other sessions?')) return;
    setLoading(true);
    let hasError = false;
    for (const device of devices) {
      if (device.hwid !== currentHwid) {
        try { await deleteDevice(device.id); } catch (e) { hasError = true; }
        try {
          const { error } = await supabase.rpc('terminate_device_session', {
            target_device_id: device.id, requester_hwid: currentHwid
          });
          if (error) throw error;
        } catch {
          try { await supabase.from('devices').delete().eq('id', device.id); } catch { hasError = true; }
        }
      }
    }
    if (hasError) alert('Some sessions could not be terminated.');
    fetchDevices();
  };

  const getDeviceDisplayName = (device: any): string => {
    if (device.os_name) {
      let name = device.os_name;
      if (device.browser_name && device.browser_name !== 'Echo Web' && !device.browser_name.includes('Tauri')) {
        name += ' • ' + device.browser_name;
      }
      return name;
    }
    if (device.device_name && device.device_name !== 'Unknown Device') {
      const ua = device.device_name;
      if (ua.includes('Android')) return 'Android Device';
      if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS Device';
      if (ua.includes('Windows')) return 'Windows Desktop';
      if (ua.includes('Mac OS') || ua.includes('Macintosh')) return 'macOS Desktop';
      if (ua.includes('Linux') && !ua.includes('Android')) return 'Linux Desktop';
      if (ua.includes('Chrome')) return 'Chrome Browser';
      if (ua.includes('Firefox')) return 'Firefox Browser';
      if (ua.includes('Safari')) return 'Safari Browser';
      return 'Web Browser';
    }
    return device.platform || 'Unknown Device';
  };

  const getOSIcon = (device: any) => {
    const os = device.os_name || device.platform || device.device_name || '';
    if (os.includes('Android')) return <BrandAndroid className="w-5 h-5" />;
    if (os.includes('iOS') || os.includes('iPhone') || os.includes('iPad')) return <BrandApple className="w-5 h-5" />;
    if (os.includes('Windows')) return <BrandWindows className="w-5 h-5" />;
    if (os.includes('Mac') || os.includes('Darwin')) return <BrandApple className="w-5 h-5" />;
    if (os.includes('Linux') || os.includes('Ubuntu') || os.includes('ChromeOS')) return <BrandUbuntu className="w-5 h-5" />;
    return <Globe className="w-5 h-5" />;
  };

  // VPN-плашка: true если у устройства стоит is_vpn, таймзона/IP расходятся,
  // или гео текущего устройства (live) помечено как VPN.
  const deviceIsVpn = (device: any, liveGeo?: any): boolean => {
    if (device.is_vpn === true || device.is_vpn === 1 || device.is_vpn === 'true') return true;
    // Иногда is_vpn нет с прошлых версий — делаем лёгкую проверку по локации (два варианта через "/")
    if (typeof device.location === 'string' && device.location.includes(' / ')) return true;
    if (liveGeo?.isVpn) return true;
    return false;
  };

  // Локация: сначала из БД устройства, иначе — живое гео текущего устройства.
  const renderLocation = (device: any, liveGeo?: any): string | null => {
    const loc = device?.location;
    if (loc) return loc;
    if (device?.timezone && device?.location == null && !liveGeo) return device.timezone;
    if (liveGeo?.locationLabel) return liveGeo.locationLabel;
    if (device?.timezone) return device.timezone;
    return null;
  };

  // Подпись платформы под именем устройства. Имя уже содержит ОС/браузер,
  // поэтому здесь показываем тип устройства (mobile/tablet/desktop/app),
  // чтобы не дублировать "iOS Chrome iOS Chrome".
  const getPlatformLabel = (device: any, liveMeta?: any): string => {
    const os = device?.os_name || liveMeta?.os_name || '';
    const type: string = device?.device_type || liveMeta?.device_type || '';
    const typeLabels: Record<string, string> = { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop', app: 'App' };
    if (os) {
      return (type && typeLabels[type]) || device?.platform || 'Device';
    }
    const browser = device?.browser_name || '';
    if (browser && browser !== 'Echo Web' && !browser.includes('Tauri')) return `Browser · ${browser}`;
    return device?.platform || 'Device';
  };

  // --- Profile View ---
  const renderProfile = () => (
    <ProfileEditPanel
      profile={{
        id: user.id,
        display_name: user.user_metadata?.display_name || "",
        username: user.user_metadata?.username || "",
        avatar_url: user.user_metadata?.avatar_url ?? null,
        bio: user.user_metadata?.bio ?? null,
        background: user.user_metadata?.background ?? null,
        status_emoji: user.user_metadata?.status_emoji ?? null,
        birth_date: user.user_metadata?.birth_date ?? null,
        activity_type: user.user_metadata?.activity_type ?? null,
        activity_title: user.user_metadata?.activity_title ?? null,
        activity_subtitle: user.user_metadata?.activity_subtitle ?? null,
        activity_cover_url: user.user_metadata?.activity_cover_url ?? null,
        activity_file_url: user.user_metadata?.activity_file_url ?? null,
        activity_gradient: user.user_metadata?.activity_gradient ?? null,
        share_listening_activity: user.user_metadata?.share_listening_activity ?? false,
        channel_id: user.user_metadata?.channel_id ?? null,
        channel_name: user.user_metadata?.channel_name ?? null,
        channel_username: user.user_metadata?.channel_username ?? null,
      }}
      onClose={() => setActiveView(null)}
      onSaved={(patch) => {
        onUpdateUser?.({ user_metadata: { ...user.user_metadata, ...patch } });
      }}
    />
  );

  // --- Devices View ---
  const renderDevices = () => (
    <div className="p-4 md:p-10 space-y-6">
      <div className="flex items-center justify-between mb-4">
        {isMobile && (
          <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={() => setActiveView(null)}>
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <h2 className="text-2xl font-display font-bold tracking-tight">Devices</h2>
        <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <GlassPanel className="p-5 rounded-[28px]">
        <CornerBrackets />
        <div className="flex gap-4">
          <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-white/60 leading-relaxed">
            These devices have access to your account. New devices are limited for 32 hours.
          </p>
        </div>
      </GlassPanel>

      {isQuarantined && (
        <div className="flex gap-4 p-5 rounded-[28px] bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-white/70 leading-relaxed">
            This device is in a 32-hour quarantine. Ending sessions on other devices is locked until the period ends
            {quarantineTime ? ` (${quarantineTime} left)` : ''}.
          </p>
        </div>
      )}

      {/* Scan QR to authorize a new device (PC) */}
      <button
        onClick={() => setShowQrScanner(true)}
        className="w-full flex items-center gap-4 p-5 rounded-[28px] bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-all group"
      >
        <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shrink-0 group-hover:scale-110 transition-transform">
          <QrCode className="w-5 h-5" />
        </div>
        <div className="text-left flex-1">
          <div className="font-bold text-sm">Scan QR to Sign In</div>
          <div className="text-xs text-white/50 mt-0.5">Authorize a new device by scanning its QR code</div>
        </div>
      </button>

      {devices.filter(d => d.hwid === currentHwid).length === 0 && (
        <div className="flex items-center gap-4 p-5 rounded-[28px] bg-primary/10 border border-primary/20">
          <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <span className="font-bold text-sm">This Device (Current)</span>
              <span className="text-[9px] font-mono uppercase text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">online</span>
              {isVpnDetected && (
                <span className="text-[9px] font-mono uppercase text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> VPN
                </span>
              )}
            </div>
            <div className="text-xs text-white/30 font-mono">Current session</div>
            {currentGeo?.locationLabel && (
              <div className="text-[10px] text-white/40 font-mono mt-1 flex items-center gap-1">
                <TbMapPin className="w-3 h-3" /> {currentGeo.locationLabel}
              </div>
            )}
          </div>
        </div>
      )}

      {devices.filter(d => d.hwid === currentHwid).length > 0 && (
        <>
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 mb-4">Current Device</div>
          <div className="space-y-3 mb-10">
            {devices.filter(d => d.hwid === currentHwid).map(device => (
              <div key={device.id} className="flex items-center gap-4 p-5 rounded-[28px] bg-primary/10 border border-primary/20">
                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shrink-0">
                  {getOSIcon(device)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-sm">{getDeviceDisplayName(device)}</span>
                    <span className="text-[9px] font-mono uppercase text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">online</span>
                    {deviceIsVpn(device, currentGeo) && (
                      <span className="text-[9px] font-mono uppercase text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> VPN
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/30 font-mono">{getPlatformLabel(device)}</div>
                  {renderLocation(device, currentGeo) && (
                    <div className="text-[10px] text-white/40 font-mono mt-0.5 flex items-center gap-1">
                      <TbMapPin className="w-3 h-3" /> {renderLocation(device, currentGeo)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 mb-4">Active Sessions</div>
      <div className="space-y-3 mb-10">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-white/40">
            <RefreshCw className="w-5 h-5 animate-spin mr-3" />
            <span className="text-xs font-mono uppercase tracking-widest">Loading devices...</span>
          </div>
        ) : devices.filter(d => d.hwid !== currentHwid).length === 0 ? (
          <div className="text-center py-16 text-white/30 text-xs font-mono uppercase tracking-widest">
            No other active devices
          </div>
        ) : devices.filter(d => d.hwid !== currentHwid).map(device => (
          <div key={device.id} className="flex items-center gap-4 p-5 rounded-[28px] bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-all group">
            <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-white/40 shrink-0">
              {getOSIcon(device)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-bold text-sm">{getDeviceDisplayName(device)}</span>
                {deviceIsVpn(device) && (
                  <span className="text-[9px] font-mono uppercase text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> VPN
                  </span>
                )}
              </div>
              <div className="text-xs text-white/30 font-mono mb-0.5">{getPlatformLabel(device)}</div>
              {renderLocation(device) && (
                <div className="text-[10px] text-white/40 font-mono mb-0.5 flex items-center gap-1">
                  <TbMapPin className="w-3 h-3" /> {renderLocation(device)}
                </div>
              )}
              <div className="text-[10px] text-white/20 font-mono">
                Last active: {(() => {
                  if (!device.last_active) return 'Unknown';
                  const ts = typeof device.last_active === 'string'
                    ? new Date(device.last_active).getTime()
                    : device.last_active * 1000;
                  if (isNaN(ts)) return 'Unknown';
                  return new Date(ts).toLocaleDateString() + ' ' + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                })()}
              </div>
            </div>
            <button
              className={cn(
                "w-10 h-10 rounded-2xl shrink-0 flex items-center justify-center transition-all",
                isQuarantined ? "text-white/20 cursor-not-allowed" : "hover:bg-destructive/10 hover:text-destructive text-white/40"
              )}
              onClick={() => handleTerminateDevice(device.id)}
              title={isQuarantined ? "Locked during 32-hour quarantine" : "Terminate session"}
              disabled={isQuarantined}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Terminate Others */}
      {devices.filter(d => d.hwid !== currentHwid).length > 0 && (
        <div
          className={cn(
            "flex items-center justify-between p-5 rounded-[28px] bg-destructive/5 border border-destructive/10 transition-all",
            isQuarantined ? "opacity-40 cursor-not-allowed" : "group hover:bg-destructive/10 cursor-pointer"
          )}
          onClick={handleTerminateOthers}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-destructive/20 flex items-center justify-center text-destructive shrink-0 group-hover:scale-110 transition-transform">
              <LogOut className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-destructive">Terminate Other Sessions</div>
              <div className="text-xs text-destructive-foreground/60 mt-0.5">End all other active sessions</div>
            </div>
          </div>
          <LogOut className="w-4 h-4 text-destructive/60 group-hover:text-destructive transition-colors" />
        </div>
      )}
    </div>
  );

  // --- Privacy View ---
  const renderPrivacy = () => (
    <div className="p-4 md:p-10 space-y-6">
      <div className="flex items-center justify-between mb-4">
        {isMobile && (
          <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={() => setActiveView(null)}>
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <h2 className="text-2xl font-display font-bold tracking-tight">Privacy</h2>
        <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
      </div>

      {isQuarantined && (
        <div className="flex gap-4 p-5 rounded-[28px] bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-white/70 leading-relaxed">
            This device is in a 32-hour quarantine. Changing privacy settings is locked until the period ends
            {quarantineTime ? ` (${quarantineTime} left)` : ''}.
          </p>
        </div>
      )}

      <GlassPanel className="p-6 rounded-[28px]">
        <CornerBrackets />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#5856d6]/15 flex items-center justify-center" style={{ color: '#5856d6' }}>
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm">Last Seen</div>
              <div className="text-xs text-white/40 mt-0.5">Who can see your last active time</div>
            </div>
          </div>
          <div
            className={cn("w-14 h-8 rounded-full p-1 transition-colors duration-300 shrink-0", isLastSeenVisible ? "bg-primary" : "bg-white/10", isQuarantined ? "opacity-40 cursor-not-allowed" : "cursor-pointer")}
            onClick={toggleLastSeen}
          >
            <div className={cn("w-6 h-6 rounded-full bg-white shadow transition-transform duration-300", isLastSeenVisible ? "translate-x-6" : "translate-x-0")} />
          </div>
        </div>
      </GlassPanel>

      <div className="flex gap-4 p-5 rounded-[28px] bg-primary/5 border border-primary/10">
        <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-white/60 leading-relaxed">
          If you hide your last seen time, you also won&apos;t be able to see other users&apos; last seen times.
        </p>
      </div>
    </div>
  );

  // --- Language View ---
  const renderLanguage = () => {
    return (
      <div className="p-4 md:p-10 space-y-6">
        <div className="flex items-center justify-between mb-4">
          {isMobile && (
            <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={() => setActiveView(null)}>
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h2 className="text-2xl font-display font-bold tracking-tight">Language</h2>
          <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <GlassPanel className="p-6 rounded-[28px]">
          <CornerBrackets />
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-[#ff2d55]/15 flex items-center justify-center" style={{ color: '#ff2d55' }}>
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm">App Language</div>
              <div className="text-xs text-white/40 mt-0.5">Current: {currentLang.toUpperCase()}</div>
            </div>
          </div>
        </GlassPanel>

        <div className="space-y-1">
          {LANGUAGES.map(lang => {
            const isSelected = lang.code === currentLang;
            return (
              <button
                key={lang.code}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-[24px] transition-all",
                  isSelected ? "bg-primary/10 border border-primary/20" : "hover:bg-white/5 border border-transparent"
                )}
                onClick={() => {
                  setCurrentLang(lang.code);
                  localStorage.setItem('echo_language', lang.code);
                }}
              >
                <div className="flex-1 text-left">
                  <div className="text-sm font-bold">{lang.native}</div>
                  <div className="text-xs text-white/40">{lang.label}</div>
                </div>
                {isSelected && <Check className="w-5 h-5 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // --- Alerts View ---
  const renderAlerts = () => {
    const toggleSetting = (key: keyof NotificationSettings) => {
      updateNotifSetting(key as any, !notifSettings[key]);
    };

    const alertItems = [
      { key: 'enabled', label: 'Push Notifications', desc: 'Receive notifications for new messages' },
      { key: 'sound', label: 'Sound', desc: 'Play sound when receiving a notification' },
      { key: 'messagePreview', label: 'Message Preview', desc: 'Show message content in notifications' },
      { key: 'groupByChat', label: 'Group by Chat', desc: 'Group notifications by conversation' },
      { key: 'directMessagesOnly', label: 'Direct Messages Only', desc: 'Only notify for direct messages' },
      { key: 'pushNotifications', label: 'FCM Push', desc: 'Receive push notifications via Firebase (Android)' },
      { key: 'backgroundPolling', label: 'Background Polling', desc: 'Poll for new messages when app is in background' },
    ];

    return (
      <div className="p-4 md:p-10 space-y-6">
        <div className="flex items-center justify-between mb-4">
          {isMobile && (
            <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={() => setActiveView(null)}>
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h2 className="text-2xl font-display font-bold tracking-tight">Alerts &amp; Notifications</h2>
          <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <GlassPanel className="p-6 rounded-[28px]">
          <CornerBrackets />
          <div className="space-y-4">
            {alertItems.map((item) => {
              const isEnabled = (notifSettings as any)[item.key] ?? false;
              return (
                <div key={item.key} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="font-bold text-sm">{item.label}</div>
                      <div className="text-xs text-white/40 mt-0.5">{item.desc}</div>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "w-14 h-8 rounded-full p-1 transition-colors duration-300 cursor-pointer shrink-0",
                      isEnabled ? "bg-primary" : "bg-white/10"
                    )}
                    onClick={() => toggleSetting(item.key as keyof typeof notifSettings)}
                  >
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full bg-white shadow transition-transform duration-300",
                        isEnabled ? "translate-x-6" : "translate-x-0"
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassPanel>

        <div className="flex gap-4 p-5 rounded-[28px] bg-primary/5 border border-primary/10">
          <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-white/60 leading-relaxed">
            Notification settings are synced across your devices. Changes take effect immediately.
          </p>
        </div>
      </div>
    );
  };

  // --- Main Render ---
  // If a sub-view is active on mobile, show it fullscreen
  if (isMobile && activeView) {
    let viewContent: React.ReactNode;
    switch (activeView) {
      case 'profile':
        viewContent = renderProfile();
        break;
      case 'devices':
        viewContent = renderDevices();
        break;
      case 'privacy':
        viewContent = renderPrivacy();
        break;
      case 'alerts':
        viewContent = (
          <div className="p-4 md:p-10 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">Alerts <Badge type="beta" /></h2>
              <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40" onClick={onClose}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderAlerts()}
          </div>
        );
        break;
      case 'interface':
        viewContent = (
          <div className="p-4 md:p-10 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">Interface <Badge type="beta" /></h2>
              <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40" onClick={onClose}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <InterfaceSettings user={user} onBack={() => setActiveView(null)} onClose={onClose} />
          </div>
        );
        break;
      case 'security':
        viewContent = (
          <div className="p-4 md:p-10 space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-display font-bold tracking-tight">Security</h2>
              <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40" onClick={() => setActiveView(null)}>
                <ArrowLeft className="w-5 h-5" />
              </button>
            </div>
            {menuSections.find(s => s.isSecurity)?.items.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.id} onClick={() => item.action && setActiveView(item.action)} className="w-full flex items-center gap-4 p-5 rounded-[28px] border border-white/5 bg-white/[0.02] hover:bg-white/5 transition-all">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-white/60" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-bold">{item.label}</div>
                    <div className="text-xs text-white/40">Manage {item.label.toLowerCase()} settings</div>
                  </div>
                  <ArrowLeft className="w-4 h-4 text-white/20 rotate-180" />
                </button>
              );
            })}
          </div>
        );
        break;
      default:
        viewContent = (
          <div className="p-4 md:p-10 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl font-display font-bold tracking-tight">
                {activeView === 'language' ? 'Language' : activeView === 'network' ? 'Network' : 'Storage'} <Badge type="wip" />
              </h2>
              <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40" onClick={onClose}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {activeView === 'language' ? renderLanguage() : <div className="text-xs text-white/40 font-mono uppercase tracking-widest">Coming soon</div>}
          </div>
        );
    }

    return (
      <div className="fixed inset-0 z-[200] bg-background flex flex-col safe-top safe-bottom" onClick={onClose}>
        <div className="flex-1 overflow-y-auto" onClick={e => e.stopPropagation()}>
          {viewContent}
        </div>
        {showQrScanner && <QrLoginScanner onClose={() => setShowQrScanner(false)} />}
      </div>
    );
  }

  // Mobile: Main menu (full screen, categories list)
  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[200] bg-background flex flex-col safe-top safe-bottom" onClick={onClose}>
        <div className="flex-1 overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="p-4 pt-2">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-display font-bold tracking-tight">Settings</h1>
              <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40" onClick={onClose}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mobile Profile */}
            <div className="flex items-center gap-4 p-4 mb-6 bg-white/[0.02] border border-white/5 rounded-[28px]">
              <div className="w-14 h-14 rounded-[24px] bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold shadow-xl shrink-0">
                {safeChar(user?.user_metadata?.display_name || user?.email, 'E')}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold">{user?.user_metadata?.display_name || user?.email?.split('@')[0]}</div>
                <div className="text-xs text-white/40 font-mono">
                  @{user?.user_metadata?.username || (user?.id || '').substring(0, 8)}
                </div>
              </div>
            </div>

            {/* Menu Categories */}
            {menuSections.map(section => {
              if (section.isSecurity) {
                return (
                  <div key={section.label} className="mb-6">
                    <div className="text-[9px] font-mono uppercase tracking-[0.4em] text-white/30 px-2 mb-3">{section.label}</div>
                    <div className="space-y-1">
                      {section.items.map(item => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.id}
                            className="w-full flex items-center gap-4 p-4 rounded-[24px] hover:bg-white/5 transition-all"
                            onClick={() => item.action ? setActiveView(item.action) : undefined}
                          >
                            <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center shrink-0">
                              <Icon className="w-5 h-5 text-white/40" />
                            </div>
                            <div className="flex-1 text-left">
                              <div className="text-sm font-bold">{item.label}</div>
                            </div>
                            <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center">
                              <ArrowLeft className="w-3.5 h-3.5 text-white/20 rotate-180" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              return (
                <div key={section.label} className="mb-6">
                  <div className="text-[9px] font-mono uppercase tracking-[0.4em] text-white/30 px-2 mb-3">{section.label}</div>
                  <div className="space-y-1">
                    {section.items.map(item => {
                      const Icon = item.icon;
                      const sublabel = item.id === 'language' ? LANGUAGES.find(l => l.code === currentLang)?.native || currentLang : item.sublabel;
                      return (
                        <button
                          key={item.id}
                          className="w-full flex items-center gap-4 p-4 rounded-[24px] hover:bg-white/5 transition-all"
                          onClick={() => item.action ? setActiveView(item.action) : undefined}
                        >
                          <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center shrink-0">
                            <Icon className="w-5 h-5 text-white/40" />
                          </div>
                          <div className="flex-1 text-left">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-bold">{item.label}</div>
                              {item.badge && <Badge type={item.badge} />}
                            </div>
                            {sublabel && <div className="text-xs text-white/40">{sublabel}</div>}
                          </div>
                          {item.action && (
                            <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center">
                              <ArrowLeft className="w-3.5 h-3.5 text-white/20 rotate-180" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="pt-4 border-t border-white/5">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-4 p-4 rounded-[24px] text-destructive/80 hover:text-destructive hover:bg-destructive/10 transition-all"
              >
                <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center shrink-0">
                  <LogOut className="w-5 h-5" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-bold">Выйти</div>
                </div>
              </button>
            </div>
          </div>
        </div>
        {showQrScanner && <QrLoginScanner onClose={() => setShowQrScanner(false)} />}
      </div>
    );
  }

  // --- Desktop: Modal with sidebar + content ---
  return (
    <div className={cn("fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm", isMobile ? "p-0 safe-y" : "p-4")} onClick={onClose}>
      <div className={cn("w-full bg-background/95 border border-white/10 backdrop-blur-3xl shadow-2xl overflow-hidden noise-overlay", isMobile ? "h-full rounded-none" : "max-w-3xl rounded-[48px]")} onClick={e => e.stopPropagation()}>
        <div className="flex h-full md:h-[640px]">
          {/* Sidebar */}
          <aside className="w-56 border-r border-white/5 bg-black/20 p-8 space-y-8 shrink-0 hidden sm:block">
            {menuSections.map(section => {
              if (section.isSecurity) {
                const securityItems = section.items.filter(i => i.id !== 'security');
                return (
                  <div key={section.label}>
                    <div className="text-[9px] font-mono text-white/20 uppercase tracking-[0.4em] mb-5">{section.label}</div>
                    <div className="space-y-1">
                      <button
                        className="w-full flex items-center gap-3 py-3 px-4 rounded-2xl transition-all text-white/40 hover:text-white hover:bg-white/5"
                        onClick={() => setSecurityExpanded(v => !v)}
                      >
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        <div className="text-left flex-1">
                          <span className="text-xs uppercase tracking-widest block">Security</span>
                        </div>
                        <ChevronDownIcon className={`w-4 h-4 transition-transform duration-200 ${securityExpanded ? 'rotate-180' : ''}`} />
                      </button>
                      {securityExpanded && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-white/10 pl-3">
                          {securityItems.map(item => {
                            const Icon = item.icon;
                            const isActive = activeView === item.action;
                            return (
                              <button
                                key={item.id}
                                className={cn(
                                  "w-full flex items-center gap-3 py-2.5 px-3 rounded-2xl transition-all relative",
                                  isActive
                                    ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20 font-bold"
                                    : "text-white/40 hover:text-white hover:bg-white/5"
                                )}
                                onClick={() => item.action ? setActiveView(item.action) : undefined}
                              >
                                <Icon className="w-4 h-4 shrink-0" />
                                <div className="text-left">
                                  <span className="text-xs uppercase tracking-widest block">{item.label}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div key={section.label}>
                  <div className="text-[9px] font-mono text-white/20 uppercase tracking-[0.4em] mb-5">{section.label}</div>
                  <div className="space-y-1">
                    {section.items.map(item => {
                      const Icon = item.icon;
                      const isActive = activeView === item.action;
                      return (
                        <button
                          key={item.id}
                          className={cn(
                            "w-full flex items-center gap-3 py-3 px-4 rounded-2xl transition-all relative",
                            isActive
                              ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20 font-bold"
                              : "text-white/40 hover:text-white hover:bg-white/5"
                          )}
                          onClick={() => item.action ? setActiveView(item.action) : undefined}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <div className="text-left">
                            <span className="text-xs uppercase tracking-widest block">{item.label}</span>
                            {(item.id === 'language' ? currentLang : item.sublabel) && (
                              <span className="text-[8px] text-white/30 uppercase tracking-wider mt-0.5 block">
                                {item.id === 'language' ? LANGUAGES.find(l => l.code === currentLang)?.native || currentLang : item.sublabel}
                              </span>
                            )}
                          </div>
                          {item.badge && <Badge type={item.badge} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="pt-4 border-t border-white/5">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 py-3 px-4 rounded-2xl transition-all text-destructive/80 hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <div className="text-left">
                  <span className="text-xs uppercase tracking-widest block font-bold">Выйти</span>
                </div>
              </button>
            </div>
          </aside>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {activeView === 'profile' ? renderProfile() :
             activeView === 'devices' ? renderDevices() :
             activeView === 'privacy' ? renderPrivacy() :
             activeView === 'language' ? <div className="p-4 md:p-10 space-y-2"><div className="flex items-center justify-between mb-2"><h2 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">Language <Badge type="wip" /></h2><button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all" onClick={onClose}><X className="w-6 h-6" /></button></div>{renderLanguage()}</div> :
             activeView === 'alerts' ? <div className="p-4 md:p-10 space-y-2"><div className="flex items-center justify-between mb-2"><h2 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">Alerts <Badge type="beta" /></h2><button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all" onClick={onClose}><X className="w-6 h-6" /></button></div>{renderAlerts()}</div> :
             activeView === 'interface' ? <div className="p-4 md:p-10 space-y-2"><div className="flex items-center justify-between mb-2"><h2 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">Interface <Badge type="beta" /></h2><button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all" onClick={onClose}><X className="w-6 h-6" /></button></div><InterfaceSettings user={user} onBack={() => setActiveView(null)} onClose={onClose} /></div> :
            (
              <div className="p-10">
                <div className="flex items-center justify-between mb-10">
                  <div>
                    <h2 className="text-3xl font-display font-bold tracking-tight mb-2">Settings</h2>
                    <p className="text-muted-foreground text-xs font-mono uppercase tracking-widest">Protocol_Version: 2.4.0-Alpha</p>
                  </div>
                  <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all" onClick={onClose}>
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-10">
                  {/* Node Integrity */}
                  <section className="space-y-6">
                    <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">Node Integrity</h4>
                    <GlassPanel className="p-8 rounded-[36px]">
                      <CornerBrackets />
                      <div className="flex items-center gap-6">
                        <div className="w-20 h-20 rounded-[32px] bg-primary flex items-center justify-center text-primary-foreground font-display text-4xl font-bold shadow-2xl shadow-primary/30 shrink-0">
                          {safeChar(user?.user_metadata?.display_name || user?.email, 'E')}
                        </div>
                        <div className="flex-1">
                          <div className="text-xl font-bold mb-1">{user?.user_metadata?.display_name || user?.email?.split('@')[0]}</div>
                          <div className="text-xs text-white/40 font-mono tracking-widest mb-4">
                            UID: {(user?.id || '').substring(0, 16)}...
                          </div>
                          <button className="h-9 px-5 rounded-xl border border-white/10 hover:bg-white/5 text-[10px] uppercase tracking-widest font-bold transition-all">
                            <Fingerprint className="w-3.5 h-3.5 inline mr-2" />
                            Export Identity
                          </button>
                        </div>
                      </div>
                    </GlassPanel>
                  </section>

                  {/* Multi-Account Bridge */}
                  <section className="space-y-6">
                    <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">Multi-Account Bridge</h4>
                    <div className="space-y-3">
                      {accounts.map(acc => (
                        <div key={acc.uid} className={cn(
                          "flex items-center justify-between p-5 rounded-[28px] border transition-all duration-500",
                          acc.uid === user?.id ? "bg-primary/10 border-primary/20 shadow-xl" : "bg-white/[0.02] border-white/5 opacity-40 hover:opacity-100"
                        )}>
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-sm font-bold">
                              {safeChar(acc.displayName || acc.email)}
                            </div>
                            <div>
                              <div className="text-sm font-bold">{acc.displayName || acc.email}</div>
                              <div className="text-[10px] text-white/30 font-mono">
                                @{acc.username || (acc.uid ? acc.uid.substring(0, 8) : 'node')}
                              </div>
                            </div>
                          </div>
                          {acc.uid === user?.id
                            ? <ShieldCheck className="w-5 h-5 text-primary animate-pulse" />
                            : <div className="w-5 h-5" />
                          }
                        </div>
                      ))}
                      <button className="w-full rounded-[28px] border-2 border-dashed border-white/10 hover:border-primary/40 hover:bg-primary/5 h-16 text-xs uppercase tracking-widest font-bold transition-all flex items-center justify-center gap-3">
                        <UserPlus className="w-5 h-5" /> Connect New Node
                      </button>
                    </div>
                  </section>

                  {/* Advanced Protocol */}
                  <section className="space-y-6 pb-8">
                    <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">Advanced Protocol</h4>
                    <div className="p-6 bg-destructive/5 border border-destructive/10 rounded-[32px] flex gap-5 group hover:bg-destructive/10 transition-all duration-500">
                      <div className="w-12 h-12 bg-destructive/20 rounded-[20px] flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                        <AlertTriangle className="w-6 h-6 text-destructive" />
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-bold text-destructive uppercase tracking-widest">Master Termination</div>
                        <p className="text-xs text-destructive-foreground/60 leading-relaxed font-medium">
                          This will permanently purge your local node identity and revoke all E2EE session keys.
                        </p>
                        <button className="mt-3 h-10 px-6 rounded-xl bg-destructive text-destructive-foreground font-bold uppercase tracking-widest text-[10px] active:scale-95 transition-all hover:bg-destructive/90">
                          Execute Purge
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {showQrScanner && <QrLoginScanner onClose={() => setShowQrScanner(false)} />}
    </div>
  );
};

export default SettingsModal;