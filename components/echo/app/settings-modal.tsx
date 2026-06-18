"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { cn, safeChar } from "@/lib/utils";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
  TbBell as Bell,
  TbDatabase as Database,
  TbShield as Shield,
  TbSettings as Settings,
  TbFolder as Folder,
  TbDeviceDesktop as HardDrive,
  TbGlobe as Globe,
  TbStar as Star,
  TbGift as Gift,
  TbEye as Eye,
  TbPencil as Pen,
  TbInfoCircle as Info,
  TbBoltOff as ZapOff,
  TbLogout as LogOut,
  TbShieldCheck as ShieldCheck,
  TbBrandWindows as BrandWindows,
  TbBrandApple as BrandApple,
  TbBrandAndroid as BrandAndroid,
  TbBrandUbuntu as BrandUbuntu,
  TbRefresh as RefreshCw,
  TbAdjustments as Sliders,
  TbLanguage as Language,
  TbUser as User,
  TbPalette as Palette,
  TbWifi as Wifi,
  TbFingerprint as Fingerprint,
  TbAlertTriangle as AlertTriangle,
  TbUserPlus as UserPlus,
} from "react-icons/tb";

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

const GlassPanel = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "bg-card/30 backdrop-blur-2xl border border-white/5 relative overflow-hidden",
      className,
    )}
  >
    {children}
  </div>
);

const menuSections = [
  {
    label: "Core System",
    items: [
      { id: "profile", icon: User, label: "Identity" },
      { id: "security", icon: ShieldCheck, label: "Security" },
      { id: "alerts", icon: Bell, label: "Alerts" },
      { id: "interface", icon: Palette, label: "Interface" },
      { id: "network", icon: Wifi, label: "Network" },
      { id: "storage", icon: HardDrive, label: "Storage" },
    ],
  },
  {
    label: "Advanced",
    items: [
      { id: "privacy", icon: Shield, label: "Privacy", action: "privacy" },
      { id: "devices", icon: HardDrive, label: "Devices", action: "devices" },
      {
        id: "language",
        icon: Language,
        label: "Language",
        sublabel: "Русский",
      },
    ],
  },
];

const SettingsModal: React.FC<SettingsModalProps> = ({
  user,
  accounts = [],
  onClose,
  isQuarantined,
}) => {
  const [activeView, setActiveView] = useState<string | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentHwid, setCurrentHwid] = useState("");
  const [isLastSeenVisible, setIsLastSeenVisible] = useState(
    user?.user_metadata?.privacy_last_seen !== false,
  );

  const generateLocalHWID = () => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    const renderer = gl
      ? gl.getParameter(gl.RENDERER) + gl.getParameter(gl.VENDOR)
      : "";
    const screenInfo = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
    const cpuInfo = navigator.hardwareConcurrency || "unknown";
    const rawId = `${renderer}-${screenInfo}-${cpuInfo}-${navigator.language}`;
    let hash = 0;
    for (let i = 0; i < rawId.length; i++) {
      const char = rawId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  };

  useEffect(() => {
    const hwid = generateLocalHWID();
    setCurrentHwid(hwid);
    if (activeView === "devices") fetchDevices();
  }, [activeView]);

  const fetchDevices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .order("last_active", { ascending: false });
    if (!error) setDevices(data || []);
    setLoading(false);
  };

  const toggleLastSeen = async () => {
    const newValue = !isLastSeenVisible;
    setIsLastSeenVisible(newValue);
    await supabase
      .from("profiles")
      .update({
        user_metadata: { ...user.user_metadata, privacy_last_seen: newValue },
      })
      .eq("id", user.id);
  };

  const handleTerminateDevice = async (deviceId: string) => {
    if (isQuarantined) {
      alert(
        "Действие ограничено. Новое устройство должно пройти 32-часовой карантин для управления сессиями.",
      );
      return;
    }
    if (!window.confirm("Завершить этот сеанс?")) return;
    const { error } = await supabase.rpc("terminate_device_session", {
      target_device_id: deviceId,
      requester_hwid: currentHwid,
    });
    if (error) {
      alert(`Ошибка: ${error.message}`);
      return;
    }
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
  };

  const handleTerminateOthers = async () => {
    if (isQuarantined) {
      alert(
        "Действие ограничено. Новое устройство должно пройти 32-часовой карантин для управления сессиями.",
      );
      return;
    }
    if (!window.confirm("Завершить все остальные сеансы?")) return;
    setLoading(true);
    let hasError = false;
    for (const device of devices) {
      if (device.hwid !== currentHwid) {
        const { error } = await supabase.rpc("terminate_device_session", {
          target_device_id: device.id,
          requester_hwid: currentHwid,
        });
        if (error) hasError = true;
      }
    }
    if (hasError) alert("Некоторые сеансы не удалось завершить.");
    fetchDevices();
  };

  const getOSIcon = (os: string) => {
    if (os.includes("Windows")) return <BrandWindows className="w-5 h-5" />;
    if (os.includes("Mac") || os.includes("iOS"))
      return <BrandApple className="w-5 h-5" />;
    if (os.includes("Linux")) return <BrandUbuntu className="w-5 h-5" />;
    if (os.includes("Android")) return <BrandAndroid className="w-5 h-5" />;
    return <Globe className="w-5 h-5" />;
  };

  // --- Devices View ---
  if (activeView === "devices") {
    return (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-3xl bg-background/95 border border-white/10 backdrop-blur-3xl rounded-[48px] shadow-2xl overflow-hidden noise-overlay"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-[640px]">
            <aside className="w-56 border-r border-white/5 bg-black/20 p-8 space-y-1 shrink-0">
              <div className="text-[9px] font-mono text-white/20 uppercase tracking-[0.4em] mb-6">
                Devices
              </div>
              <button
                className="w-full flex items-center gap-4 py-3 px-4 rounded-2xl transition-all text-white/40 hover:text-white hover:bg-white/5"
                onClick={() => setActiveView(null)}
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-xs uppercase tracking-widest">Back</span>
              </button>
            </aside>

            <div className="flex-1 p-10 overflow-y-auto">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-display font-bold tracking-tight">
                  Devices
                </h2>
                <button
                  className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all"
                  onClick={onClose}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <GlassPanel className="p-5 rounded-[28px] mb-8">
                <CornerBrackets />
                <div className="flex gap-4">
                  <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-white/60 leading-relaxed">
                    These devices have access to your account. New devices are
                    limited for 32 hours.
                  </p>
                </div>
              </GlassPanel>

              <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 mb-4">
                Current Device
              </div>
              <div className="space-y-3 mb-10">
                {devices
                  .filter((d) => d.hwid === currentHwid)
                  .map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center gap-4 p-5 rounded-[28px] bg-primary/10 border border-primary/20"
                    >
                      <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary">
                        {getOSIcon(device.os_name || "")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-bold text-sm">
                            {device.os_name} •{" "}
                            {device.browser_name || "Echo Web"}
                          </span>
                          <span className="text-[9px] font-mono uppercase text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">
                            online
                          </span>
                        </div>
                        <div className="text-xs text-white/30 font-mono">
                          {device.location_ip}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>

              <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 mb-4">
                Active Sessions
              </div>
              <div className="space-y-3 mb-10">
                {loading ? (
                  <div className="flex items-center justify-center py-10 text-white/40">
                    <RefreshCw className="w-5 h-5 animate-spin mr-3" />
                    <span className="text-xs font-mono uppercase tracking-widest">
                      Loading devices...
                    </span>
                  </div>
                ) : devices.filter((d) => d.hwid !== currentHwid).length ===
                  0 ? (
                  <div className="text-center py-10 text-white/30 text-xs font-mono uppercase tracking-widest">
                    No other active devices
                  </div>
                ) : (
                  devices
                    .filter((d) => d.hwid !== currentHwid)
                    .map((device) => {
                      const tzCountry =
                        device.location_tz?.split("/")[1]?.replace(/_/g, " ") ||
                        "Unknown";
                      const isMismatch =
                        device.location_ip &&
                        device.location_ip !== tzCountry &&
                        device.location_ip !== "Unknown";
                      return (
                        <div
                          key={device.id}
                          className="flex items-center gap-4 p-5 rounded-[28px] bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-all group"
                        >
                          <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-white/40">
                            {getOSIcon(device.os_name || "")}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-sm">
                                {device.os_name} •{" "}
                                {device.browser_name || "Echo Web"}
                              </span>
                              {isMismatch && (
                                <span className="text-[9px] font-mono uppercase text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
                                  VPN?
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-white/30 font-mono mb-0.5">
                              IP: {device.location_ip}
                            </div>
                            <div className="text-[10px] text-white/20 font-mono">
                              Active since{" "}
                              {new Date(device.created_at).toLocaleDateString()}{" "}
                              ·{" "}
                              {new Date(device.last_active).toLocaleTimeString(
                                [],
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </div>
                          </div>
                          <button
                            className="w-10 h-10 rounded-2xl hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-white/20 opacity-0 group-hover:opacity-100 transition-all"
                            onClick={() => handleTerminateDevice(device.id)}
                            title="Terminate session"
                          >
                            <LogOut className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })
                )}
              </div>

              <button
                className="w-full h-14 rounded-[28px] bg-destructive/10 border border-destructive/20 flex items-center justify-center gap-3 text-destructive text-sm font-bold hover:bg-destructive/20 transition-all uppercase tracking-widest"
                onClick={handleTerminateOthers}
              >
                <ZapOff className="w-5 h-5" /> Terminate Other Sessions
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Privacy View ---
  if (activeView === "privacy") {
    return (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-3xl bg-background/95 border border-white/10 backdrop-blur-3xl rounded-[48px] shadow-2xl overflow-hidden noise-overlay"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-[640px]">
            <aside className="w-56 border-r border-white/5 bg-black/20 p-8 space-y-1 shrink-0">
              <div className="text-[9px] font-mono text-white/20 uppercase tracking-[0.4em] mb-6">
                Privacy
              </div>
              <button
                className="w-full flex items-center gap-4 py-3 px-4 rounded-2xl transition-all text-white/40 hover:text-white hover:bg-white/5"
                onClick={() => setActiveView(null)}
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-xs uppercase tracking-widest">Back</span>
              </button>
            </aside>

            <div className="flex-1 p-10 overflow-y-auto">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-display font-bold tracking-tight">
                  Privacy
                </h2>
                <button
                  className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all"
                  onClick={onClose}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <GlassPanel className="p-6 rounded-[28px]">
                <CornerBrackets />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-12 h-12 rounded-2xl bg-[#5856d6]/15 flex items-center justify-center"
                      style={{ color: "#5856d6" }}
                    >
                      <Eye className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm">Last Seen</div>
                      <div className="text-xs text-white/40 mt-0.5">
                        Who can see your last active time
                      </div>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "w-14 h-8 rounded-full p-1 transition-colors duration-300 cursor-pointer",
                      isLastSeenVisible ? "bg-primary" : "bg-white/10",
                    )}
                    onClick={toggleLastSeen}
                  >
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full bg-white shadow transition-transform duration-300",
                        isLastSeenVisible ? "translate-x-6" : "translate-x-0",
                      )}
                    />
                  </div>
                </div>
              </GlassPanel>

              <div className="flex gap-4 p-5 rounded-[28px] bg-primary/5 border border-primary/10 mt-6">
                <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-white/60 leading-relaxed">
                  If you hide your last seen time, you also won&apos;t be able
                  to see other users&apos; last seen times.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Main Settings View ---
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-background/95 border border-white/10 backdrop-blur-3xl rounded-[48px] shadow-2xl overflow-hidden noise-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[640px]">
          {/* Sidebar */}
          <aside className="w-56 border-r border-white/5 bg-black/20 p-8 space-y-8 shrink-0 hidden sm:block">
            {menuSections.map((section) => (
              <div key={section.label}>
                <div className="text-[9px] font-mono text-white/20 uppercase tracking-[0.4em] mb-5">
                  {section.label}
                </div>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const iItem = item as any;
                    const Icon = iItem.icon;
                    const isActive = activeView === iItem.action;
                    return (
                      <button
                        key={iItem.id}
                        className={cn(
                          "w-full flex items-center gap-4 py-3 px-4 rounded-2xl transition-all relative",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20 font-bold"
                            : "text-white/40 hover:text-white hover:bg-white/5",
                        )}
                        onClick={() =>
                          iItem.action ? setActiveView(iItem.action) : undefined
                        }
                      >
                        <Icon className="w-4 h-4" />
                        <div className="text-left">
                          <span className="text-xs uppercase tracking-widest block">
                            {iItem.label}
                          </span>
                          {iItem.sublabel && (
                            <span className="text-[8px] text-white/30 uppercase tracking-wider mt-0.5 block">
                              {iItem.sublabel}
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
          <div className="flex-1 p-10 overflow-y-auto">
            <div className="flex items-center justify-between mb-10">
              <div>
                <h2 className="text-3xl font-display font-bold tracking-tight mb-2">
                  Settings
                </h2>
                <p className="text-muted-foreground text-xs font-mono uppercase tracking-widest">
                  Protocol_Version: 2.4.0-Alpha
                </p>
              </div>
              <button
                className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all"
                onClick={onClose}
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-10">
              {/* Node Integrity */}
              <section className="space-y-6">
                <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">
                  Node Integrity
                </h4>
                <GlassPanel className="p-8 rounded-[36px]">
                  <CornerBrackets />
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 rounded-[32px] bg-primary flex items-center justify-center text-primary-foreground font-display text-4xl font-bold shadow-2xl shadow-primary/30">
                      {safeChar(
                        user?.user_metadata?.display_name || user?.email,
                        "E",
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="text-xl font-bold mb-1">
                        {user?.user_metadata?.display_name ||
                          user?.email?.split("@")[0]}
                      </div>
                      <div className="text-xs text-white/40 font-mono tracking-widest mb-4">
                        UID: {(user?.id || "").substring(0, 16)}...
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
                <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">
                  Multi-Account Bridge
                </h4>
                <div className="space-y-3">
                  {accounts.map((acc) => (
                    <div
                      key={acc.uid}
                      className={cn(
                        "flex items-center justify-between p-5 rounded-[28px] border transition-all duration-500",
                        acc.uid === user?.id
                          ? "bg-primary/10 border-primary/20 shadow-xl"
                          : "bg-white/[0.02] border-white/5 opacity-40 hover:opacity-100",
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-sm font-bold">
                          {safeChar(acc.displayName || acc.email)}
                        </div>
                        <div>
                          <div className="text-sm font-bold">
                            {acc.displayName || acc.email}
                          </div>
                          <div className="text-[10px] text-white/30 font-mono">
                            @
                            {acc.username ||
                              (acc.uid ? acc.uid.substring(0, 8) : "node")}
                          </div>
                        </div>
                      </div>
                      {acc.uid === user?.id ? (
                        <ShieldCheck className="w-5 h-5 text-primary animate-pulse" />
                      ) : (
                        <div className="w-5 h-5" />
                      )}
                    </div>
                  ))}
                  <button className="w-full rounded-[28px] border-2 border-dashed border-white/10 hover:border-primary/40 hover:bg-primary/5 h-16 text-xs uppercase tracking-widest font-bold transition-all flex items-center justify-center gap-3">
                    <UserPlus className="w-5 h-5" /> Connect New Node
                  </button>
                </div>
              </section>

              {/* Advanced Protocol */}
              <section className="space-y-6 pb-8">
                <h4 className="text-[10px] font-mono uppercase tracking-[0.4em] text-primary/60">
                  Advanced Protocol
                </h4>
                <div className="p-6 bg-destructive/5 border border-destructive/10 rounded-[32px] flex gap-5 group hover:bg-destructive/10 transition-all duration-500">
                  <div className="w-12 h-12 bg-destructive/20 rounded-[20px] flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                    <AlertTriangle className="w-6 h-6 text-destructive" />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-bold text-destructive uppercase tracking-widest">
                      Master Termination
                    </div>
                    <p className="text-xs text-destructive-foreground/60 leading-relaxed font-medium">
                      This will permanently purge your local node identity and
                      revoke all E2EE session keys. This action cannot be
                      reversed.
                    </p>
                    <button className="mt-3 h-10 px-6 rounded-xl bg-destructive text-destructive-foreground font-bold uppercase tracking-widest text-[10px] active:scale-95 transition-all hover:bg-destructive/90">
                      Execute Purge
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
