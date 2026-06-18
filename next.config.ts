import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.100", "localhost:3000", "127.0.0.1:3000"],
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