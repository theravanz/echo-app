"use client";

import { toast } from "sonner";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
  TbLogout as LogOut,
} from "react-icons/tb";
import { safeChar } from "@/lib/utils";
import type { UserProfile } from "@/hooks/echo/types";
import { menuSections, LANGUAGES, type ViewType } from "./settings-config";
import { Badge } from "./settings-primitives";

interface SettingsMenuMobileProps {
  user: UserProfile | null;
  currentLang: string;
  setActiveView: (v: ViewType) => void;
  onClose: () => void;
  onLogout: () => void;
}

const SettingsMenuMobile: React.FC<SettingsMenuMobileProps> = ({ user, currentLang, setActiveView, onClose, onLogout }) => {
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
                          onClick={() => item.action ? setActiveView(item.action) : toast(`${item.label} — скоро`, { description: 'Раздел в разработке' })}
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
                        onClick={() => item.action ? setActiveView(item.action) : toast(`${item.label} — скоро`, { description: 'Раздел в разработке' })}
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
              onClick={onLogout}
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
    </div>
  );
};

export default SettingsMenuMobile;
