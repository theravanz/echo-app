// components/WelcomeScreen.tsx
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { useTranslation } from '@/hooks/use-translation';
import dynamic from 'next/dynamic';

const PixelBlast = dynamic(
  () => import('./PixelBlast'),
  { ssr: false, loading: () => <div className="w-full h-full bg-[#0a0a0c]" /> }
);

export default function WelcomeScreen({ onComplete }: { onComplete: () => void }) {
  const { t, language, setLanguage } = useTranslation();
  const [isWebGLReady, setIsWebGLReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsWebGLReady(true), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-between overflow-hidden bg-[#0a0a0c]"
    >
      {/* WebGL */}
      <div className="absolute inset-0 z-0">
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          {isWebGLReady && <PixelBlast
            variant="square"
            pixelSize={4}
            color="#B497CF"
            patternScale={2}
            patternDensity={1}
            pixelSizeJitter={0}
            enableRipples
            rippleSpeed={0.4}
            rippleThickness={0.12}
            rippleIntensityScale={1.5}
            liquid={false}
            liquidStrength={0.12}
            liquidRadius={1.2}
            liquidWobbleSpeed={5}
            speed={0.5}
            edgeFade={0.25}
            transparent
          />}
        </div>
      </div>

      {/* Затемнение */}
      <div className="absolute inset-0 z-10 bg-gradient-to-b from-black/60 via-transparent to-black/60" />

      {/* Контент */}
      <div className="relative z-20 flex flex-1 flex-col items-center justify-center w-full px-6">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mb-8"
        >
          <Image
            src="/logo-full.svg"
            alt="Echo"
            width={280}
            height={70}
            className="w-auto max-w-[220px] sm:max-w-[280px] md:max-w-[320px] drop-shadow-[0_0_60px_rgba(180,151,207,0.3)]"
            priority
          />
        </motion.div>

        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
          className="text-3xl sm:text-4xl md:text-5xl font-bold text-white text-center tracking-tight mb-3"
        >
          {t('welcome.title')}
        </motion.h1>

        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
          className="text-base sm:text-lg text-white/60 text-center max-w-md leading-relaxed whitespace-pre-line"
        >
          {t('welcome.subtitle')}
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="flex items-center gap-2 mt-10"
        >
          <div className="w-8 h-0.5 rounded-full bg-[#B497CF]" />
          <div className="w-1.5 h-1.5 rounded-full bg-[#B497CF]/50" />
          <div className="w-1.5 h-1.5 rounded-full bg-[#B497CF]/30" />
        </motion.div>
      </div>

      {/* Кнопки */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
        className="relative z-20 w-full max-w-sm px-6 pb-10 sm:pb-12"
      >
        <button
          onClick={onComplete}
          className="group w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-full
                     bg-[#B497CF] text-[#0a0a0c] font-bold text-base
                     hover:bg-[#C5A8E0] active:scale-[0.98] transition-all duration-300
                     shadow-[0_0_30px_rgba(180,151,207,0.3)] hover:shadow-[0_0_50px_rgba(180,151,207,0.5)]"
        >
          <span>{t('welcome.getStarted')}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
            className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </button>

        <button
          onClick={() => setLanguage(language === 'en' ? 'ru' : 'en')}
          className="mt-5 w-full text-center text-xs sm:text-sm text-white/30 hover:text-white/60
                     transition-colors duration-300 font-medium"
        >
          {t('welcome.switchLang')}
        </button>
      </motion.div>
    </motion.div>
  );
}