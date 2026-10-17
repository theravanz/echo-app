"use client";

// Гео/VPN-детект текущего устройства (бывший эффект монтирования модалки +
// ре-резолв при открытии Devices; теперь живёт внутри DevicesView).
// Тип DeviceGeo выводится из реального резолвера — без ручного дублирования.

import { useCallback, useEffect, useState } from "react";
import { resolveDeviceGeo } from "@/lib/device-info";

export type DeviceGeo = NonNullable<Awaited<ReturnType<typeof resolveDeviceGeo>>>;

export function useDeviceGeo() {
  const [isVpnDetected, setIsVpnDetected] = useState(false);
  const [currentGeo, setCurrentGeo] = useState<DeviceGeo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const geo = await resolveDeviceGeo();
      if (!geo) return;
      setCurrentGeo(geo);
      if (geo.isVpn) setIsVpnDetected(true);
    } catch { /* silent */ }
  }, []);

  // Первичный резолв при монтировании потребителя (DevicesView монтируется
  // ровно в момент открытия раздела Devices).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const geo = await resolveDeviceGeo();
        if (cancelled || !geo) return;
        setCurrentGeo(geo);
        if (geo.isVpn) {
          setIsVpnDetected(true);
          console.warn('[VPN] Timezone mismatch:', geo.ipTz, 'vs', geo.tz);
        }
      } catch { /* silent fail */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return { currentGeo, isVpnDetected, refresh };
}
