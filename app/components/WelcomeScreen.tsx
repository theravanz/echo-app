// components/WelcomeScreen.tsx
'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import PixelBlast from './PixelBlast';

export default function WelcomeScreen({ onComplete }: { onComplete: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-between overflow-hidden bg-[#0a0a0c]"
    >
      {/* --- ФОН (без изменений) --- */}
      <div className="absolute inset-0 z-0">
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          <PixelBlast
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
          />
        </div>
      </div>

      {/* Лёгкое затемнение для читаемости (современный стандарт) */}
      <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-[2px]" />

      {/* --- КОНТЕНТ --- */}
      <div className="relative z-20 flex flex-1 flex-col items-center justify-center w-full px-6">
        
        {/* Логотип */}
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
            className="w-auto max-w-[220px] sm:max-w-[280px] md:max-w-[320px] opacity-90 hover:opacity-100 transition-opacity duration-300"
            priority
          />
        </motion.div>

        {/* Заголовок */}
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
          className="text-3xl sm:text-4xl md:text-5xl font-semibold text-white text-center tracking-tight mb-3"
        >
          Next-gen communication.
        </motion.h1>

        {/* Подзаголовок */}
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
          className="text-base sm:text-lg text-white/60 text-center max-w-md leading-relaxed"
        >
          Free expression. Total control.<br />
          All in one app.
        </motion.p>

        {/* Индикаторы */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="flex items-center gap-2 mt-10"
        >
          <div className="w-8 h-1 rounded-full bg-white" />
          <div className="w-1.5 h-1 rounded-full bg-white/30" />
          <div className="w-1.5 h-1 rounded-full bg-white/30" />
        </motion.div>
      </div>

      {/* --- НИЖНЯЯ ПАНЕЛЬ --- */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
        className="relative z-20 w-full max-w-sm px-6 pb-10 sm:pb-12"
      >
        <button
          onClick={onComplete}
          className="group relative w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-full bg-white/10 
                     text-white font-medium text-base tracking-wide
                     border border-white/10 transition-all duration-300
                     hover:bg-white/15 hover:border-white/20 hover:scale-[1.01]
                     active:scale-[0.99] active:bg-white/10"
        >
          <span className="mr-1">Get started</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </button>

        <button
          onClick={() => console.log('Language toggle')}
          className="mt-5 w-full text-center text-xs sm:text-sm text-white/50 hover:text-white/80 
                     transition-colors duration-300 font-medium"
        >
          Перевести на Русский
        </button>
      </motion.div>
    </motion.div>
  );
}