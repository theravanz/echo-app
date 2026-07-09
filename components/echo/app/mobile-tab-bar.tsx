"use client";

import { TbUsers as Users, TbMessage as MessageSquare, TbCompass as Compass, TbSettings as Settings } from "react-icons/tb";
import { cn } from "@/lib/utils";
import type { AppTab } from "@/hooks/echo/types";

interface MobileTabBarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  onOpenSettings: () => void;
}

export function MobileTabBar({ activeTab, setActiveTab, onOpenSettings }: MobileTabBarProps) {
  const tabs: { id: AppTab | 'settings'; icon: typeof Users; label: string }[] = [
    { id: 'community', icon: Users, label: 'Community' },
    { id: 'chats', icon: MessageSquare, label: 'Chats' },
    { id: 'feed', icon: Compass, label: 'Feed' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-2xl border-t border-white/5" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center justify-around h-14">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              if (tab.id === 'settings') {
                onOpenSettings();
              } else {
                setActiveTab(tab.id);
              }
            }}
            className={cn(
              'flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-all',
              tab.id === 'settings'
                ? 'text-white/30'
                : activeTab === tab.id ? 'text-primary' : 'text-white/30'
            )}
          >
            <tab.icon className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase tracking-wider">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
