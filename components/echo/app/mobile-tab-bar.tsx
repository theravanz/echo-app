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
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 border-t transition-colors duration-500",
        "backdrop-blur-2xl"
      )}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        backgroundColor: 'color-mix(in oklch, var(--background, #000) 85%, transparent)',
        borderColor: 'color-mix(in oklch, var(--border, #fff) 15%, transparent)',
      }}
    >
      <div className="flex items-center justify-around h-14">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
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
                'relative flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-2xl transition-all duration-300 min-w-[4rem]',
              )}
            >
              {isActive && (
                <div
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-1 rounded-full"
                  style={{ backgroundColor: 'var(--primary, currentColor)' }}
                />
              )}
              <Icon
                className="w-5 h-5 transition-colors duration-300"
                style={{ color: isActive ? 'var(--primary, currentColor)' : 'var(--muted-foreground, #888)' }}
              />
              <span
                className="text-[8px] font-mono uppercase tracking-wider transition-colors duration-300"
                style={{ color: isActive ? 'var(--primary, currentColor)' : 'var(--muted-foreground, #888)' }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
