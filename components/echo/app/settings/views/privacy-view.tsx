"use client";

import { cn } from "@/lib/utils";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
  TbEye as Eye,
  TbInfoCircle as Info,
  TbAlertTriangle as AlertTriangle,
} from "react-icons/tb";
import { GlassPanel, CornerBrackets } from "../settings-primitives";
import type { ViewType } from "../settings-config";

interface PrivacyViewProps {
  isMobile: boolean;
  setActiveView: (v: ViewType) => void;
  onClose: () => void;
  isQuarantined?: boolean;
  quarantineTime?: string;
  isLastSeenVisible: boolean;
  onToggleLastSeen: () => void;
}

const PrivacyView: React.FC<PrivacyViewProps> = ({
  isMobile,
  setActiveView,
  onClose,
  isQuarantined,
  quarantineTime,
  isLastSeenVisible,
  onToggleLastSeen,
}) => (
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
        <h2 className="text-2xl font-display font-bold tracking-tight">Privacy</h2>
      </div>
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
          onClick={onToggleLastSeen}
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

export default PrivacyView;
