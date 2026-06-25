/** @type {import('next').NextConfig} */
const nextConfig = {
  // === SSG: Полный статический экспорт без сервера ===
  output: 'export',

  // === Оптимизация изображений для статики ===
  images: {
    unoptimized: true,
  },

  // === Оптимизация бандла ===
  experimental: {
    // Tree-shaking для react-icons — тянет только нужные SVG
    optimizePackageImports: ['react-icons'],
  },

  // Отключаем серверные функции (они не нужны при SSG)
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
};

module.exports = nextConfig;
