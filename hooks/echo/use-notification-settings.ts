"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { UserProfile } from "./types";

const STORAGE_KEY = "echo_notification_settings";

export interface NotificationSettings {
  enabled: boolean;
  sound: boolean;
  messagePreview: boolean;
  groupByChat: boolean;
  directMessagesOnly: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  sound: true,
  messagePreview: true,
  groupByChat: true,
  directMessagesOnly: false,
};

interface UseNotificationSettingsReturn {
  settings: NotificationSettings;
  updateSetting: <K extends keyof NotificationSettings>(
    key: K,
    value: NotificationSettings[K],
  ) => void;
  resetSettings: () => void;
  isLoaded: boolean;
}

export function useNotificationSettings(
  user: UserProfile | null,
): UseNotificationSettingsReturn {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load settings on mount
  useEffect(() => {
    if (!user) {
      // Load from localStorage only if not logged in
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
        }
      } catch { /* ignore */ }
      setIsLoaded(true);
      return;
    }

    // Try Supabase first, fallback to localStorage
    const metaSettings = (user as any).user_metadata?.notification_settings;
    if (metaSettings) {
      setSettings({ ...DEFAULT_SETTINGS, ...metaSettings });
      setIsLoaded(true);
    } else {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
        }
      } catch { /* ignore */ }
      setIsLoaded(true);
    }
  }, [user?.id]);

  // Persist settings
  const persistSettings = useCallback(
    async (newSettings: NotificationSettings) => {
      // Always save to localStorage for fast access
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));

      // Sync to Supabase if user is logged in
      if (user?.id) {
        try {
          await supabase.auth.updateUser({
            data: {
              notification_settings: newSettings,
            },
          });
        } catch (err) {
          console.error("[NotificationSettings] Supabase sync failed:", err);
        }
      }
    },
    [user?.id],
  );

  const updateSetting = useCallback(
    <K extends keyof NotificationSettings>(
      key: K,
      value: NotificationSettings[K],
    ) => {
      setSettings((prev) => {
        const newSettings = { ...prev, [key]: value };

        // Debounce persistence (300ms)
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          persistSettings(newSettings);
        }, 300);

        return newSettings;
      });
    },
    [persistSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    persistSettings(DEFAULT_SETTINGS);
  }, [persistSettings]);

  return { settings, updateSetting, resetSettings, isLoaded };
}
