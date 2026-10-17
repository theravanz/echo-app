"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  TbX as X,
  TbChevronDown as ChevronDownIcon,
  TbShieldCheck as ShieldCheck,
  TbLogout as LogOut,
} from "react-icons/tb";
import { menuSections, LANGUAGES, type ViewType } from "./settings-config";
import { Badge } from "./settings-primitives";

interface SettingsSidebarProps {
  activeView: ViewType;
  setActiveView: (v: ViewType) => void;
  onClose: () => void;
  currentLang: string;
  onLogout: () => void;
}

const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ activeView, setActiveView, onClose, currentLang, onLogout }) => {
  const [securityExpanded, setSecurityExpanded] = useState(true);

  return (
    <aside className="w-56 border-r border-white/5 bg-black/20 p-8 space-y-8 shrink-0 hidden sm:block min-h-0 overflow-y-auto settings-scroll">
      {/* Header Sidebar*/}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-white/20 uppercase tracking-[0.4em]">Menu</span>
        <button
          className="w-8 h-8 rounded-xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-colors"
          onClick={onClose}
          aria-label="Close settings"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
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
                          // Security-подпункты без action — тоже с тостом, а не тишина.
                          onClick={() => item.action ? setActiveView(item.action) : toast(`${item.label} — скоро`, { description: 'Раздел в разработке' })}
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
                    onClick={() => item.action ? setActiveView(item.action) : toast(`${item.label} — скоро`, { description: 'Раздел в разработке' })}
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
          onClick={onLogout}
          className="w-full flex items-center gap-3 py-3 px-4 rounded-2xl transition-all text-destructive/80 hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <div className="text-left">
            <span className="text-xs uppercase tracking-widest block font-bold">Выйти</span>
          </div>
        </button>
      </div>
    </aside>
  );
};

export default SettingsSidebar;
