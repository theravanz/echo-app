"use client";

import {
  TbGlobe as Globe,
  TbBrandWindows as BrandWindows,
  TbBrandApple as BrandApple,
  TbBrandAndroid as BrandAndroid,
  TbBrandUbuntu as BrandUbuntu,
} from "react-icons/tb";
import type { MergedDevice } from "./settings-config";
import type { DeviceGeo } from "@/hooks/echo/settings/use-device-geo";

export const getDeviceDisplayName = (device: MergedDevice): string => {
  if (device.os_name) {
    let name = device.os_name;
    if (device.browser_name && device.browser_name !== 'Echo Web' && !device.browser_name.includes('Tauri')) {
      name += ' • ' + device.browser_name;
    }
    return name;
  }
  if (device.device_name && device.device_name !== 'Unknown Device') {
    const ua = device.device_name;
    if (ua.includes('Android')) return 'Android Device';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS Device';
    if (ua.includes('Windows')) return 'Windows Desktop';
    if (ua.includes('Mac OS') || ua.includes('Macintosh')) return 'macOS Desktop';
    if (ua.includes('Linux') && !ua.includes('Android')) return 'Linux Desktop';
    if (ua.includes('Chrome')) return 'Chrome Browser';
    if (ua.includes('Firefox')) return 'Firefox Browser';
    if (ua.includes('Safari')) return 'Safari Browser';
    return 'Web Browser';
  }
  return device.platform || 'Unknown Device';
};

export const getOSIcon = (device: MergedDevice) => {
  const os = device.os_name || device.platform || device.device_name || '';
  if (os.includes('Android')) return <BrandAndroid className="w-5 h-5" />;
  if (os.includes('iOS') || os.includes('iPhone') || os.includes('iPad')) return <BrandApple className="w-5 h-5" />;
  if (os.includes('Windows')) return <BrandWindows className="w-5 h-5" />;
  if (os.includes('Mac') || os.includes('Darwin')) return <BrandApple className="w-5 h-5" />;
  if (os.includes('Linux') || os.includes('Ubuntu') || os.includes('ChromeOS')) return <BrandUbuntu className="w-5 h-5" />;
  return <Globe className="w-5 h-5" />;
};

// VPN-плашка: true если у устройства стоит is_vpn, таймзона/IP расходятся,
// или гео текущего устройства (live) помечено как VPN.
export const deviceIsVpn = (device: MergedDevice, liveGeo?: DeviceGeo | null): boolean => {
  if (device.is_vpn === true || device.is_vpn === 1 || device.is_vpn === 'true') return true;
  // Иногда is_vpn нет с прошлых версий — делаем лёгкую проверку по локации (два варианта через "/")
  if (typeof device.location === 'string' && device.location.includes(' / ')) return true;
  if (liveGeo?.isVpn) return true;
  return false;
};

// Локация: сначала из БД устройства, иначе — живое гео текущего устройства.
export const renderLocation = (device: MergedDevice, liveGeo?: DeviceGeo | null): string | null => {
  const loc = device?.location;
  if (loc) return loc;
  if (device?.timezone && device?.location == null && !liveGeo) return device.timezone;
  if (liveGeo?.locationLabel) return liveGeo.locationLabel;
  if (device?.timezone) return device.timezone;
  return null;
};

export const getPlatformLabel = (device: MergedDevice, liveMeta?: Partial<MergedDevice> | null): string => {
  const os = device?.os_name || liveMeta?.os_name || '';
  const type: string = device?.device_type || liveMeta?.device_type || '';
  const typeLabels: Record<string, string> = { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop', app: 'App' };
  if (os) {
    return (type && typeLabels[type]) || device?.platform || 'Device';
  }
  const browser = device?.browser_name || '';
  if (browser && browser !== 'Echo Web' && !browser.includes('Tauri')) return `Browser · ${browser}`;
  return device?.platform || 'Device';
};
