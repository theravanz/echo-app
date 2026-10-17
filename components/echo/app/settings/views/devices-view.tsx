"use client";

import { cn } from "@/lib/utils";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
  TbDeviceDesktop as HardDrive,
  TbShieldCheck as ShieldCheck,
  TbRefresh as RefreshCw,
  TbLogout as LogOut,
  TbAlertTriangle as AlertTriangle,
  TbQrcode as QrCode,
  TbMapPin as TbMapPin,
} from "react-icons/tb";
import { GlassPanel, CornerBrackets } from "../settings-primitives";
import {
  getDeviceDisplayName,
  getOSIcon,
  deviceIsVpn,
  renderLocation,
  getPlatformLabel,
} from "../device-utils";
import { useDevices } from "@/hooks/echo/settings/use-devices";
import { useDeviceGeo } from "@/hooks/echo/settings/use-device-geo";
import type { UserProfile } from "@/hooks/echo/types";
import type { ViewType } from "../settings-config";

interface DevicesViewProps {
  user: UserProfile | null;
  isMobile: boolean;
  setActiveView: (v: ViewType) => void;
  onClose: () => void;
  isQuarantined?: boolean;
  quarantineTime?: string;
  onOpenQrScanner: () => void;
}

const DevicesView: React.FC<DevicesViewProps> = ({
  user,
  isMobile,
  setActiveView,
  onClose,
  isQuarantined,
  quarantineTime,
  onOpenQrScanner,
}) => {
  const { devices, loading, currentHwid, terminateDevice, terminateOthers } = useDevices(user?.id);
  const { currentGeo, isVpnDetected } = useDeviceGeo();

  const handleTerminateDevice = async (deviceId: string) => {
    if (isQuarantined) {
      alert('Action limited. New devices must pass 32-hour quarantine for session management.');
      return;
    }
    if (!window.confirm('Terminate this session?')) return;
    await terminateDevice(deviceId);
  };

  const handleTerminateOthers = async () => {
    if (isQuarantined) {
      alert('Action limited. New devices must pass 32-hour quarantine for session management.');
      return;
    }
    if (!window.confirm('Terminate all other sessions?')) return;
    await terminateOthers();
  };

  return (
    <div className="p-4 md:p-10 space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {!isMobile && (
            <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={() => setActiveView('profile')} aria-label="Back to settings" title="Back">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          {isMobile && (
            <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={() => setActiveView(null)}>
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h2 className="text-2xl font-display font-bold tracking-tight">Devices</h2>
        </div>
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
        onClick={onOpenQrScanner}
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
};

export default DevicesView;
