"use client";

// Devices-логика настроек: мёрж списка устройств из Supabase + нативного SQLite,
// HWID текущей сессии и terminate-действия.
// Гварды карантина и confirm()-диалоги остаются на стороне вьюхи.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getDevices, deleteDevice, generateHWID } from "@/lib/db";
import type { MergedDevice } from "@/components/echo/app/settings/settings-config";

export function useDevices(userId?: string) {
  const [devices, setDevices] = useState<MergedDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentHwid, setCurrentHwid] = useState('');

  // HWID текущего устройства — нативный generateHWID из db.ts
  useEffect(() => {
    (async () => {
      try {
        const hwid = await generateHWID();
        setCurrentHwid(hwid);
      } catch {
        const fallback = localStorage.getItem('echo_device_hwid');
        if (fallback) setCurrentHwid(fallback);
      }
    })();
  }, []);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      if (!userId) { setLoading(false); return; }

      // Merge devices from both sources
      const allDevices: Record<string, MergedDevice> = {};

      // 1. From Supabase
      try {
        const { data: supabaseDevices } = await supabase
          .from('devices')
          .select('*')
          .eq('user_id', userId)
          .order('last_active', { ascending: false });
        if (supabaseDevices) {
          supabaseDevices.forEach((d: any) => { allDevices[d.hwid || d.id] = d; });
        }
      } catch (e) { console.warn('[Settings] Supabase fetch failed:', e); }

      // 2. From SQLite (native)
      try {
        const nativeDevices = await getDevices(userId);
        if (nativeDevices) {
          nativeDevices.forEach((d: any) => { allDevices[d.hwid || d.id] = d; });
        }
      } catch (e) { console.warn('[Settings] SQLite fetch failed:', e); }

      setDevices(Object.values(allDevices));
    } catch (err) {
      console.error('[Settings] fetchDevices fatal:', err);
    }
    setLoading(false);
  };

  // Вьюха Devices монтируется ровно в момент открытия раздела — грузим сразу.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchDevices(); }, []);

  const terminateDevice = async (deviceId: string) => {
    // 1. Delete from native SQLite
    try { await deleteDevice(deviceId); } catch (e) { console.warn('[Settings] native deleteDevice failed:', e); }

    // 2. Try Supabase RPC
    try {
      const { error } = await supabase.rpc('terminate_device_session', {
        target_device_id: deviceId, requester_hwid: currentHwid
      });
      if (error) throw error;
    } catch {
      // 3. Fallback to direct Supabase delete
      try { await supabase.from('devices').delete().eq('id', deviceId); } catch {}
    }

    setDevices(prev => prev.filter(d => d.id !== deviceId));
  };

  const terminateOthers = async () => {
    setLoading(true);
    let hasError = false;
    for (const device of devices) {
      if (device.hwid !== currentHwid) {
        try { await deleteDevice(device.id); } catch (e) { hasError = true; }
        try {
          const { error } = await supabase.rpc('terminate_device_session', {
            target_device_id: device.id, requester_hwid: currentHwid
          });
          if (error) throw error;
        } catch {
          try { await supabase.from('devices').delete().eq('id', device.id); } catch { hasError = true; }
        }
      }
    }
    if (hasError) alert('Some sessions could not be terminated.');
    fetchDevices();
  };

  return { devices, loading, currentHwid, fetchDevices, terminateDevice, terminateOthers };
}
