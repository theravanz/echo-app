"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getDevices, deleteDevice, generateHWID, saveDevice, type Device } from "@/lib/db";
import { cn, safeChar } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
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
  TbDeviceMobile as Smartphone,
  TbMoon as Moon,
} from "react-icons/tb";

import type { UserProfile } from "@/hooks/echo/types";
import { useNotificationSettings, type NotificationSettings } from "@/hooks/echo/use-notification-settings";
interface SettingsModalProps {
  user: any;
  accounts?: any[];
  onClose: () => void;
  isQuarantined?: boolean;
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

type ViewType = 'privacy' | 'devices' | 'language' | 'alerts' | null;

interface MenuItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sublabel?: string;
  action?: ViewType;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const menuSections: MenuSection[] = [
  {
    label: 'Core System',
    items: [
      { id: 'profile', icon: User, label: 'Identity' },
      { id: 'security', icon: ShieldCheck, label: 'Security' },
      { id: 'alerts', icon: Bell, label: 'Alerts', action: 'alerts' },
      { id: 'interface', icon: Palette, label: 'Interface' },
      { id: 'network', icon: Wifi, label: 'Network' },
      { id: 'storage', icon: HardDrive, label: 'Storage' },
    ]
  },
  {
    label: 'Advanced',
    items: [
      { id: 'privacy', icon: Shield, label: 'Privacy', action: 'privacy' },
      { id: 'devices', icon: HardDrive, label: 'Devices', action: 'devices' },
      { id: 'language', icon: Language, label: 'Language', action: 'language' },
    ]
  }
];

const SettingsModal: React.FC<SettingsModalProps> = ({ user, accounts = [], onClose, isQuarantined }) => {
  const isMobile = useIsMobile();
  const [activeView, setActiveView] = useState<ViewType>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentHwid, setCurrentHwid] = useState('');
  const [isLastSeenVisible, setIsLastSeenVisible] = useState(user?.user_metadata?.privacy_last_seen !== false);
  const [currentLang, setCurrentLang] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('echo_language') || 'ru';
    }
    return 'ru';
  });

  // Notifications settings (hook must be at component level)
  const { settings: notifSettings, updateSetting: updateNotifSetting } = useNotificationSettings(user || null);

  // Use native generateHWID from db.ts (SHA-256 based, consistent)
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
    }
  }, [activeView]);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      if (!user?.id) { setLoading(false); return; }
      // Priority: native SQLite (Rust backend)
      const nativeDevices = await getDevices(user.id);
      if (nativeDevices && nativeDevices.length > 0) {
        setDevices(nativeDevices);
      } else {
        // Fallback: Supabase
        const { data, error } = await supabase
          .from('devices')
          .select('*')
          .eq('user_id', user?.id)
          .order('last_active', { ascending: false });
        if (!error) setDevices(data || []);
      }
    } catch (err) {
      console.warn('[Settings] fetchDevices error:', err);
      // Final fallback
      try {
        const { data } = await supabase.from('devices').select('*').eq('user_id', user?.id);
        if (data) setDevices(data);
      } catch {}
    }
    setLoading(false);
  };

  const toggleLastSeen = async () => {
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
        // Delete from native SQLite
        try { await deleteDevice(device.id); } catch (e) { hasError = true; }
        // Try Supabase RPC
        try {
          const { error } = await supabase.rpc('terminate_device_session', {
            target_device_id: device.id, requester_hwid: currentHwid
          });
          if (error) throw error;
        } catch {
          // Fallback: direct Supabase delete
          try { await supabase.from('devices').delete().eq('id', device.id); } catch { hasError = true; }
        }
      }
    }
    if (hasError) alert('Some sessions could not be terminated.');
    fetchDevices();
  };

  const getDeviceDisplayName = (device: any): string => {
    if (device.device_name && device.device_name !== 'Unknown Device') {
      const ua = device.device_name;
      if (ua.includes('Windows')) return 'Windows Desktop';
      if (ua.includes('Mac OS') || ua.includes('Macintosh')) return 'macOS Desktop';
      if (ua.includes('Linux') && !ua.includes('Android')) return 'Linux Desktop';
      if (ua.includes('Android')) return 'Android Device';
      if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS Device';
      if (ua.includes('Chrome')) return 'Chrome Browser';
      if (ua.includes('Firefox')) return 'Firefox Browser';
      if (ua.includes('Safari')) return 'Safari Browser';
      return 'Web Browser';
    }
    return device.platform || 'Unknown Device';
  };

  const getOSIcon = (os: string) => {
    if (os.includes('Windows')) return <BrandWindows className="w-5 h-5" />;
    if (os.includes('Mac') || os.includes('iOS')) return <BrandApple className="w-5 h-5" />;
    if (os.includes('Linux')) return <BrandUbuntu className="w-5 h-5" />;
    if (os.includes('Android')) return <BrandAndroid className="w-5 h-5" />;
    return <Globe className="w-5 h-5" />;
  };

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

      <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 mb-4">Current Device</div>
      <div className="space-y-3 mb-10">
        {devices.filter(d => d.hwid === currentHwid).map(device => (
          <div key={device.id} className="flex items-center gap-4 p-5 rounded-[28px] bg-primary/10 border border-primary/20">
            <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shrink-0">
              {getOSIcon(device.platform || device.device_name || '')}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <span className="font-bold text-sm">{getDeviceDisplayName(device)}</span>
                <span className="text-[9px] font-mono uppercase text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">online</span>
              </div>
              <div className="text-xs text-white/30 font-mono">{device.platform || 'Unknown OS'}</div>
            </div>
          </div>
        ))}
      </div>

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
                {getOSIcon(device.platform || device.device_name || '')}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-sm">{getDeviceDisplayName(device)}</span>
                </div>
                <div className="text-xs text-white/30 font-mono mb-0.5">{device.platform || 'Unknown OS'}</div>
                <div className="text-[10px] text-white/20 font-mono">
                  Last active: {device.last_active ? new Date(device.last_active * 1000).toLocaleDateString() + ' ' + new Date(device.last_active * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unknown'}
                </div>
              </div>
              <button className="w-10 h-10 rounded-2xl hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-white/40 transition-all shrink-0" onClick={() => handleTerminateDevice(device.id)} title="Terminate session">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ))}
      </div>
    </div>
  );

  // --- Privacy View ---
  const renderPrivacy = () => (
    <div className="p-10 space-y-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-display font-bold tracking-tight">Privacy</h2>
        <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <GlassPanel className="p-5 rounded-[28px]">
        <CornerBrackets />
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Eye className="w-5 h-5 text-white/40" />
              <div>
                <div className="text-sm font-bold">Last Seen</div>
                <div className="text-[10px] text-white/30 font-mono">Who can see your last active time</div>
              </div>
            </div>
            <button
              className={cn(
                "w-12 h-7 rounded-full transition-all relative",
                isLastSeenVisible ? "bg-primary" : "bg-white/10"
              )}
              onClick={toggleLastSeen}
            >
              <div className={cn(
                "absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all",
                isLastSeenVisible ? "left-6" : "left-1"
              )} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Fingerprint className="w-5 h-5 text-white/40" />
              <div>
                <div className="text-sm font-bold">E2EE Fingerprint</div>
                <div className="text-[10px] text-white/30 font-mono">Verify encryption keys</div>
              </div>
            </div>
            <button className="text-[10px] text-primary font-mono uppercase tracking-widest hover:underline">
              Verify
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Shield className="w-5 h-5 text-white/40" />
              <div>
                <div className="text-sm font-bold">Forward Security</div>
                <div className="text-[10px] text-white/30 font-mono">Perfect Forward Secrecy active</div>
              </div>
            </div>
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
        </div>
      </GlassPanel>
    </div>
  );

  // --- Language View ---
  const renderLanguage = () => (
    <div className="p-10 space-y-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-display font-bold tracking-tight">Language</h2>
        <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-2">
        {LANGUAGES.map(lang => (
          <button
            key={lang.code}
            className={cn(
              "w-full flex items-center justify-between p-4 rounded-2xl transition-all",
              currentLang === lang.code
                ? "bg-primary/10 border border-primary/20"
                : "hover:bg-white/5 border border-transparent"
            )}
            onClick={() => {
              setCurrentLang(lang.code);
              localStorage.setItem('echo_language', lang.code);
            }}
          >
            <div className="text-left">
              <div className="text-sm font-bold">{lang.native}</div>
              <div className="text-[10px] text-white/30 font-mono">{lang.label}</div>
            </div>
            {currentLang === lang.code && <Check className="w-5 h-5 text-primary" />}
          </button>
        ))}
      </div>
    </div>
  );

  // --- Alerts View ---
  const renderAlerts = () => (
    <div className="p-10 space-y-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-display font-bold tracking-tight">Alerts</h2>
        <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <GlassPanel className="p-5 rounded-[28px]">
        <CornerBrackets />
        <p className="text-xs text-white/40 leading-relaxed">
          Notification and alert preferences will be available in the next update.
        </p>
      </GlassPanel>
    </div>
  );

  // --- Desktop: Modal with sidebar + content ---
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-3xl bg-background/95 border border-white/10 backdrop-blur-3xl rounded-[48px] shadow-2xl overflow-hidden noise-overlay" onClick={e => e.stopPropagation()}>
        <div className="flex h-[640px]">
          {/* Sidebar */}
          <aside className="w-56 border-r border-white/5 bg-black/20 p-8 space-y-8 shrink-0 hidden sm:block">
            {menuSections.map(section => (
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
                          "w-full flex items-center gap-4 py-3 px-4 rounded-2xl transition-all relative",
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
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </aside>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {activeView === 'devices' ? renderDevices() :
             activeView === 'privacy' ? renderPrivacy() :
             activeView === 'language' ? renderLanguage() :
             activeView === 'alerts' ? renderAlerts() :
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
    </div>
  );
};

export default SettingsModal;