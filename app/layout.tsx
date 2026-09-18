import type { Metadata } from "next";
// Локальные Geist Sans / Geist Mono (те же шрифты, что в макете) — без обращения к
// fonts.gstatic.com на билде: офлайн/заблокированная сеть валила `next build`
// (Turbopack не мог скачать woff2 → Module not found в font CSS).
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { LogBridge } from "@/components/echo/app/log-bridge";
import { Toaster } from "@/components/ui/sonner";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Echo",
  description: "Secure Encrypted Messenger",
  icons: {
    icon: "/logo1.png",
    apple: "/logo1.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
    >
      <body className="min-h-full flex flex-col">
        {/* Мост console.* → logcat/Console (диагностика на устройстве). */}
        <LogBridge />
        {children}
        {/* Один mounted-тостер на всё приложение: без него все toast() из
            sonner (ошибки файлов, «Файл больше 10 МБ» и пр.) не показываются. */}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
