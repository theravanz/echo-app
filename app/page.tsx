// app/page.tsx
'use client';

import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import WelcomeScreen from './components/WelcomeScreen';
import MainApp from './components/MainApp';

export default function Home() {
  // true = показываем заставку
  const [showWelcome, setShowWelcome] = useState(true);

  return (
    <main className="relative h-screen w-full overflow-hidden bg-zinc-900">
      
      {/* Основное приложение (всегда под низом, но активно, когда заставка ушла) */}
      <div className={`h-full transition-opacity duration-700 ${showWelcome ? 'opacity-0' : 'opacity-100'}`}>
        <MainApp />
      </div>

      {/* Слой приветствия (поверх всего) */}
      <AnimatePresence>
        {showWelcome && (
          <WelcomeScreen onComplete={() => setShowWelcome(false)} />
        )}
      </AnimatePresence>
      
    </main>
  );
}