import type { NextConfig } from "next";

// Адреса, с которых dev-server примет запрос из браузера/нативного WebView.
// ВНИМАНИЕ: IP твоего Mac по Wi-Fi — DHCP и может меняться между сетями.
// Если ошибка вернётся — добавь сюда актуальный IP (ipconfig getifaddr en0).
// В production (статика в bundle) этот список не используется.
const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost:3000",
    "127.0.0.1:3000",
    // Dev на физическом устройстве (iPhone/Android) того же LAN-ряда:
    "192.168.31.189:3000", // текущий IP Mac для iOS dev
    "192.168.0.100:3000", // прошлый IP (запас)
  ],
  images: {
    unoptimized: true,
  },
  output: 'export',
  experimental: {
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;