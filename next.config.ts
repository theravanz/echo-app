import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.100", "localhost:3000", "127.0.0.1:3000"],
  output: 'export',
  images: {
    unoptimized: true,
  },
  experimental: {
  },
};

export default nextConfig;