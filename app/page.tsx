// app/page.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import WelcomeScreen from './components/WelcomeScreen';

export default function Home() {
  const router = useRouter();
  const [showWelcome, setShowWelcome] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    const init = async () => {
      let shouldShowWelcome = true;

      // 0. Показываем окно Taurи СРАЗУ — до любых async-вызовов,
      //    чтобы пользователь не видел чёрный экран, если init зависнет
      //    на supabase.getSession() или deep-link IPC.
      requestAnimationFrame(async () => {
        try {
          const window = getCurrentWindow();
          await window.show();
        } catch {
          // Не в Tauri-окружении (dev-режим в браузере)
        }
      });

      // 1. Проверка сессии. В supabase-js v2.108+ getSession() читает
      //    localStorage синхронно — быстро. Но если токен истёк и
      //    autoRefreshToken пытается его обновить, сетевой запрос
      //    может подвиснуть. Оборачиваем в таймаут 5с.
      let hasSession = false;
      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('auth timeout')), 5000),
          ),
        ]);
        hasSession = !!result.data?.session;
      } catch (error) {
        console.error('Auth check error:', error);
      }

      // 2. ВСЕГДА проверяем deep-link (до решения о роутинге).
      //    На Linux invoke('plugin:deep-link|get_current') может
      //    зависнуть на D-Bus — таймаут 3с спасает от вечного чёрного экрана.
      let deepLinkUsername: string | null = null;
      try {
        const deepLinkUrls = await Promise.race([
          invoke<string[]>('plugin:deep-link|get_current'),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('deep-link timeout')), 3000),
          ),
        ]);
        if (deepLinkUrls && deepLinkUrls.length > 0) {
          const url = deepLinkUrls[0];
          const match = url.match(/echomes:\/\/(?:@)?(.+)$/);
          if (match && match[1]) deepLinkUsername = match[1];
        }
      } catch {
        // Плагин недоступен, cold start без ссылки, или таймаут
      }

      // 3. Маршрутизация: deep-link имеет приоритет
      if (deepLinkUsername && isMountedRef.current) {
        if (hasSession) {
          router.push('/app?chat=' + deepLinkUsername);
        } else {
          router.push('/auth?returnTo=/app?chat=' + deepLinkUsername);
        }
        shouldShowWelcome = false;
      } else if (hasSession && isMountedRef.current) {
        router.push('/app');
        shouldShowWelcome = false;
      }

      // 4. Разрешаем показ WelcomeScreen если нет сессии и нет deep-link
      if (isMountedRef.current && shouldShowWelcome) {
        setShowWelcome(true);
      }
    };

    init();

    return () => { isMountedRef.current = false; };
  }, [router]);

  // Deep link listener — warm start (echomes://...): приложение уже открыто
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const fn = await listen<string[]>('deep-link://new-url', async (event) => {
          console.log('[DeepLink] Cold start received:', event.payload);
          
          // В Tauri v2 payload — это уже массив строк
          const urls = Array.isArray(event.payload) ? event.payload : [event.payload];
          const url = urls[0];
          if (!url) return;

          const match = url.match(/echomes:\/\/(?:@)?([^/?#\s]+)/);
          if (match && match[1] && isMountedRef.current) {
            router.push('/app?chat=' + match[1]);
          }
        });
        unlisten = fn;
      } catch {
        // Ignore if run outside Tauri or plugin is missing
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [router]);

  return (
    <main className="relative h-screen w-full overflow-hidden bg-[#0a0a0c] flex items-center justify-center">
      {showWelcome ? (
        <AnimatePresence>
          <WelcomeScreen onComplete={() => router.push('/auth')} />
        </AnimatePresence>
      ) : (
        <div className="w-10 h-10 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
      )}
    </main>
  );
}