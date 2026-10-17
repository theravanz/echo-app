"use client";

import { cn } from "@/lib/utils";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
  TbGlobe as Globe,
  TbCheck as Check,
} from "react-icons/tb";
import { GlassPanel, CornerBrackets } from "../settings-primitives";
import { LANGUAGES, type ViewType } from "../settings-config";

interface LanguageViewProps {
  currentLang: string;
  setCurrentLang: (code: string) => void;
  isMobile: boolean;
  setActiveView: (v: ViewType) => void;
  onClose: () => void;
}

const LanguageView: React.FC<LanguageViewProps> = ({ currentLang, setCurrentLang, isMobile, setActiveView, onClose }) => {
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
          <h2 className="text-2xl font-display font-bold tracking-tight">Language</h2>
        </div>
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

export default LanguageView;
