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

      // 1. Проверка сессии (асинхронно, не блокирует рендер)
      let session: Awaited<ReturnType<typeof supabase.auth.getSession>> | null = null;
      const hasSession = await (async () => {
        try {
          session = await supabase.auth.getSession();
          return !!session.data?.session;
        } catch (error) {
          console.error('Auth check error:', error);
          return false;
        }
      })();

      // 2. ВСЕГДА проверяем deep-link (до решения о роутинге),
      //    иначе авторизованный юзер никогда не попадёт в чат по ссылке.
      let deepLinkUsername: string | null = null;
      try {
        const deepLinkUrls = await invoke<string[]>('plugin:deep-link|get_current');
        if (deepLinkUrls && deepLinkUrls.length > 0) {
          const url = deepLinkUrls[0];
          const match = url.match(/echomes:\/\/(?:@)?(.+)$/);
          if (match && match[1]) deepLinkUsername = match[1];
        }
      } catch {
        // Плагин недоступен (не Tauri или cold start без ссылки)
      }

      // 3. Маршрутизация: deep-link имеет приоритет
      if (deepLinkUsername && isMountedRef.current) {
        if (hasSession) {
          // Авторизован → сразу в приложение, /app сам откроет чат
          router.push('/app?chat=' + deepLinkUsername);
        } else {
          // Не авторизован → на авторизацию с возвратом в чат
          router.push('/auth?returnTo=/app?chat=' + deepLinkUsername);
        }
        shouldShowWelcome = false;
      } else if (hasSession && isMountedRef.current) {
        // Нет deep-link, но есть сессия → в приложение
        router.push('/app');
        shouldShowWelcome = false;
      }

      // 4. Показываем окно Tauri только после того, как DOM отрисован
      requestAnimationFrame(async () => {
        try {
          const window = getCurrentWindow();
          await window.show();
        } catch {
          // Не в Tauri-окружении (dev-режим в браузере)
        }
      });

      // 5. Разрешаем показ WelcomeScreen если нет сессии и нет deep-link
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
    <main className="relative h-screen w-full overflow-hidden bg-[#0a0a0c]">
      {showWelcome && (
        <AnimatePresence>
          <WelcomeScreen onComplete={() => router.push('/auth')} />
        </AnimatePresence>
      )}
    </main>
  );
}