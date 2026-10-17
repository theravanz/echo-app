"use client";

import { cn } from "@/lib/utils";
import {
  TbX as X,
  TbArrowLeft as ArrowLeft,
  TbInfoCircle as Info,
} from "react-icons/tb";
import { GlassPanel, CornerBrackets } from "../settings-primitives";
import type { NotificationSettings } from "@/hooks/echo/use-notification-settings";
import type { ViewType } from "../settings-config";

interface AlertsViewProps {
  settings: NotificationSettings;
  updateSetting: (key: any, value: any) => void;
  isMobile: boolean;
  setActiveView: (v: ViewType) => void;
  onClose: () => void;
}

const AlertsView: React.FC<AlertsViewProps> = ({ settings, updateSetting, isMobile, setActiveView, onClose }) => {
  const toggleSetting = (key: keyof NotificationSettings) => {
    updateSetting(key as any, !settings[key]);
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
          <h2 className="text-2xl font-display font-bold tracking-tight">Alerts &amp; Notifications</h2>
        </div>
        <button className="w-10 h-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <GlassPanel className="p-6 rounded-[28px]">
        <CornerBrackets />
        <div className="space-y-4">
          {alertItems.map((item) => {
            const isEnabled = (settings as any)[item.key] ?? false;
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
                  onClick={() => toggleSetting(item.key as keyof typeof settings)}
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

export default AlertsView;
