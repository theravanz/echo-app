// app/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { getPersistedSession } from '@/lib/db';
import { getCurrentWindow } from '@tauri-apps/api/window';
import WelcomeScreen from './components/WelcomeScreen';

export default function Home() {
  const router = useRouter();
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      // 1. Проверка сессии через SQLite + Supabase (асинхронно)
      let shouldShowWelcome = true;
      try {
        const session = await getPersistedSession();
        if (session && isMounted) {
          router.push('/app');
          shouldShowWelcome = false;
        }
      } catch (error) {
        console.error('Auth check error:', error);
      }

      // 2. Показываем окно Tauri только после того, как DOM отрисован
      requestAnimationFrame(async () => {
        try {
          const window = getCurrentWindow();
          await window.show();
        } catch {
          // Не в Tauri-окружении (dev-режим в браузере)
        }
      });

      // 3. Разрешаем показ WelcomeScreen если нет сессии
      if (isMounted && shouldShowWelcome) {
        setShowWelcome(true);
      }
    };

    init();

    return () => { isMounted = false; };
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