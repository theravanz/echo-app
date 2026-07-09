'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, animate } from 'framer-motion';
import { useTranslation } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import {
  TbArrowRight,
  TbGlobe,
  TbCheck,
  TbMessageCircle,
  TbLock,
  TbShieldCheck,
  TbWifi,
  TbWorld,
  TbSend,
  TbKey,
  TbFingerprint,
  TbBolt,
  TbUsers,
  TbMoodSmile,
  TbPaperclip,
} from 'react-icons/tb';

interface WelcomeScreenProps {
  onComplete: () => void;
}

interface LangEntry {
  code: string;
  label: string;
  local: string;
}

const LANGUAGES: LangEntry[] = [
  { code: 'en', label: 'English', local: 'EN' },
  { code: 'ru', label: 'Русский', local: 'RU' },
  { code: 'es', label: 'Español', local: 'ES' },
  { code: 'zh', label: '中文', local: 'ZH' },
];

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const DOODLE_ICONS = [
  TbMessageCircle, TbLock, TbShieldCheck, TbWifi, TbWorld, TbSend, TbKey, TbFingerprint,
  TbBolt, TbUsers, TbMoodSmile, TbPaperclip,
];

const DOODLE_LAYOUT: { icon: number; top: number; left: number; size: number; rot: number }[] = [
  { icon: 0, top: 8, left: 34, size: 16, rot: -14 },
  { icon: 1, top: 12, left: 6, size: 14, rot: 10 },
  { icon: 2, top: 18, left: 58, size: 15, rot: -8 },
  { icon: 3, top: 26, left: 8, size: 13, rot: 16 },
  { icon: 4, top: 32, left: 30, size: 14, rot: -20 },
  { icon: 5, top: 40, left: 6, size: 13, rot: 12 },
  { icon: 6, top: 48, left: 24, size: 14, rot: -6 },
  { icon: 7, top: 52, left: 90, size: 14, rot: 20 },
  { icon: 8, top: 62, left: 84, size: 15, rot: -10 },
  { icon: 9, top: 72, left: 92, size: 13, rot: 18 },
  { icon: 10, top: 82, left: 80, size: 14, rot: -16 },
];

const HEADLINE: { text: string; bold?: boolean; accent?: boolean }[][] = [
  [{ text: 'Общайся' }],
  [{ text: 'без границ,', bold: true }],
  [{ text: 'полностью', bold: true }, { text: ' защищённо', bold: true, accent: true }],
];

export default function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const { t, language, setLanguage } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [languageKey, setLanguageKey] = useState(0);

  const dragX = useMotionValue(0);

  // Parallax for watermark
  const mvX = useMotionValue(0);
  const mvY = useMotionValue(0);
  const springX = useSpring(mvX, { stiffness: 30, damping: 20, restDelta: 0.001 });
  const springY = useSpring(mvY, { stiffness: 30, damping: 20, restDelta: 0.001 });
  const watermarkX = useTransform(springX, [-1, 1], [-10, 10]);
  const watermarkY = useTransform(springY, [-1, 1], [-10, 10]);

  const [constraints, setConstraints] = useState({ left: 0, right: 0 });

  // Progress and derived values
  const progress = useTransform(dragX, [0, constraints.right], [0, 1]);
  const fillWidth = useTransform(progress, [0, 1], ['0%', '100%']);
  const textOpacity = useTransform(progress, [0, 0.7], [1, 0]);
  const textX = useTransform(progress, [0, 0.7], [0, -8]);
  const dotWidth = useTransform(progress, [0, 0.5, 1], [6, 24, 24]);
  const dotColor = useTransform(
    progress,
    [0, 0.5],
    ['rgba(255,255,255,0.15)', 'rgba(255,255,255,1)']
  );
  const knobGlowScale = useTransform(dragX, [0, constraints.right], [0, 1]);
  const knobGlowOpacity = useTransform(dragX, [0, constraints.right], [0, 0.6]);

  useEffect(() => {
    setMounted(true);
    function handlePointerMove(e: PointerEvent) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      mvX.set(nx);
      mvY.set(ny);
    }
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [mvX, mvY]);

  const computeConstraints = useCallback(() => {
    if (!trackRef.current) return { left: 0, right: 0 };
    const trackRect = trackRef.current.getBoundingClientRect();
    const knobWidth = 60;
    const padding = 8;
    return {
      left: padding,
      right: trackRect.width - knobWidth - padding
    };
  }, []);

  useEffect(() => {
    if (mounted) {
      setConstraints(computeConstraints());
      const handleResize = () => setConstraints(computeConstraints());
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [mounted, computeConstraints]);

  const currentLang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  const handleLangSelect = (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLanguage(code);
    setLanguageKey(prev => prev + 1);
    setLangOpen(false);
  };

  const subtitleText =
    t('welcome.subtitle') || 'Свобода самовыражения. Полный контроль. Всё в одном приложении.';

  if (!mounted) return null;

  return (
    <div key={languageKey}>
    <div className="relative min-h-screen w-full flex flex-col overflow-hidden bg-black">
      {/* ================= BACKGROUND ================= */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#26262b_0%,#18181c_45%,#0c0c0e_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px]" />

        {/* Animated doodle icons with micro-interactions */}
        {DOODLE_LAYOUT.map((d, i) => {
          const Icon = DOODLE_ICONS[d.icon % DOODLE_ICONS.length];
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0 }}
              animate={{
                opacity: [0, 0.05, 0.08, 0.05],
                scale: 1,
                rotate: [d.rot - 5, d.rot + 5, d.rot - 5]
              }}
              transition={{
                delay: 0.3 + i * 0.03,
                duration: 0.8,
                rotate: {
                  repeat: Infinity,
                  duration: 8 + i * 0.5,
                  ease: "easeInOut"
                },
                opacity: {
                  repeat: Infinity,
                  duration: 4 + i,
                  ease: "easeInOut"
                }
              }}
              className="absolute text-white cursor-pointer"
              style={{ top: `${d.top}%`, left: `${d.left}%` }}
              whileHover={{ scale: 1.5, opacity: 0.15 }}
            >
              <Icon style={{ width: d.size, height: d.size }} />
            </motion.div>
          );
        })}

        {/* Logo - Enhanced visibility */}
        <div className="absolute top-[32%] right-[8%] md:top-[28%] md:right-[10%] lg:top-[22%] lg:right-[12%]">
          {/* Enhanced gradient backdrop with pulse */}
          <motion.div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-primary/[0.15] via-primary/[0.08] to-transparent"
            style={{
              width: '260px',
              height: '260px',
              filter: 'blur(70px)'
            }}
            animate={{
              scale: [1, 1.05, 1],
              opacity: [0.15, 0.2, 0.15]
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />

          {/* Logo with stronger visibility */}
          {!logoFailed && (
            <motion.div
              style={{ x: watermarkX, y: watermarkY }}
              className="relative"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.2, delay: 0.3 }}
            >
              {/* Mobile size */}
              <motion.img
                initial={{ opacity: 0, scale: 0.92, rotate: -8 }}
                animate={{ opacity: 0.35, scale: 1, rotate: 0 }}
                transition={{ duration: 1.4, ease: EASE, delay: 0.5 }}
                src="/logo.png"
                alt="Echo Logo"
                onError={() => setLogoFailed(true)}
                className="w-[220px] h-[220px] md:w-[340px] md:h-[340px] lg:w-[420px] lg:h-[420px] object-contain drop-shadow-[0_0_60px_rgba(255,255,255,0.2)] md:drop-shadow-[0_0_80px_rgba(255,255,255,0.25)]"
              />
            </motion.div>
          )}
        </div>
      </div>

      {/* ================= TOP BAR ================= */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-6 md:px-10 md:pt-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          whileHover={{ scale: 1.02 }}
        >
          <img
            src="/logo-full.svg"
            alt="Echo"
            className="h-6 md:h-7 w-auto"
          />
        </motion.div>

        <div className="relative">
          <motion.button
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
            onClick={(e) => { e.stopPropagation(); setLangOpen((v) => !v); }}
            whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.1)' }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs font-medium text-zinc-400 hover:text-white transition-colors"
          >
            <TbGlobe className="w-3.5 h-3.5" />
            {currentLang.local}
          </motion.button>

          <AnimatePresence>
            {langOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.96 }}
                animate={{ opacity: 1, y: 8, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.96 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="absolute top-full right-0 mt-2 w-40 rounded-xl bg-zinc-900/95 backdrop-blur-2xl border border-white/[0.1] p-1.5 shadow-2xl z-[100] flex flex-col gap-1 pointer-events-auto"
                style={{ pointerEvents: 'auto' }}
              >
                {LANGUAGES.map((lang, idx) => (
                  <motion.button
                    key={lang.code}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.04, duration: 0.18 }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('Selected:', lang.code);
                      handleLangSelect(lang.code, e);
                    }}
                    whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.08)' }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      'flex items-center justify-between w-full px-3 py-2 text-left text-sm font-medium rounded-lg transition-all cursor-pointer',
                      language === lang.code ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white'
                    )}
                    style={{ pointerEvents: 'auto' }}
                  >
                    <span>{lang.label}</span>
                    {language === lang.code && <TbCheck className="w-3.5 h-3.5" />}
                  </motion.button>
                ))}
                </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ================= MAIN CONTENT ================= */}
      <main className="relative z-10 flex-1 flex items-end md:items-center px-6 pb-8 md:px-10 md:pb-10">
        <div className="max-w-xl w-full">
          <h1 className="text-[2.8rem] leading-[1.05] md:text-5xl lg:text-6xl md:leading-[1.05] tracking-tight text-white">
            {HEADLINE.map((line, lineIdx) => (
              <span key={lineIdx} className="block overflow-hidden">
                <motion.span
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: '0%', opacity: 1 }}
                  transition={{ delay: 0.25 + lineIdx * 0.1, duration: 0.7, ease: EASE }}
                  className="block"
                >
                  {line.map((run, runIdx) => (
                    <motion.span
                      key={runIdx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + lineIdx * 0.1 + runIdx * 0.05, duration: 0.5 }}
                      className={cn(
                        'inline-block',
                        run.bold ? 'font-bold' : 'font-light',
                        run.accent && 'text-primary'
                      )}
                    >
                      {run.text}
                    </motion.span>
                  ))}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.6, ease: EASE }}
            className="mt-5 text-[15px] md:text-base text-zinc-400 max-w-md leading-relaxed font-light"
          >
            {subtitleText}
          </motion.p>
        </div>
      </main>

      {/* ================= BOTTOM CONTROL ================= */}
      <footer className="relative z-10 w-full px-6 pb-10 md:px-10 md:pb-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.6, ease: EASE }}
          ref={trackRef}
          className="relative w-full h-[72px] flex items-center rounded-full bg-white/[0.04] border border-white/[0.08] backdrop-blur-xl overflow-hidden"
        >
          {/* Smooth progress fill */}
          <motion.div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-white/[0.08] to-white/[0.04] rounded-full"
            style={{ width: fillWidth }}
          />

          {/* Track line */}
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 h-px bg-white/[0.06]" />

          <motion.div
            drag="x"
            dragConstraints={constraints}
            dragElastic={0.02}
            dragMomentum={false}
            onDragStart={() => setIsDragging(true)}
            onDrag={(_, info) => {
              const newX = Math.max(constraints.left, Math.min(constraints.right, info.point.x - (trackRef.current?.getBoundingClientRect().left || 0) - 30));
              dragX.set(newX);
            }}
            onDragEnd={() => {
              setIsDragging(false);
              const currentDrag = dragX.get();
              if (currentDrag >= constraints.right * 0.85) {
                setCompleted(true);
                onComplete();
              } else {
                animate(dragX, 0, { type: 'spring', stiffness: 400, damping: 35 });
              }
            }}
            style={{ x: dragX }}
            whileTap={{ scale: 0.95 }}
            className="relative z-20 w-[60px] h-[60px] flex items-center justify-center rounded-full bg-white shadow-[0_4px_32px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.1)] cursor-grab active:cursor-grabbing"
          >
            <motion.div
              animate={{ x: isDragging ? 2 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            >
              <TbArrowRight className="w-5 h-5 text-black" />
            </motion.div>

            {/* Subtle glow on drag */}
            <motion.div
              className="absolute inset-0 rounded-full bg-primary/30"
              style={{
                scale: knobGlowScale,
                opacity: knobGlowOpacity
              }}
            />
          </motion.div>

          <motion.span
            style={{
              opacity: textOpacity,
              x: textX
            }}
            className="flex-1 text-center pr-16 text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.2em] select-none pointer-events-none"
          >
            {t('welcome.swipe') || 'WELCOME.SWIPE'}
          </motion.span>
        </motion.div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 mt-5">
          <motion.div
            className="h-1.5 rounded-full bg-white/15"
            style={{
              width: dotWidth,
              backgroundColor: dotColor
            }}
          />
          <div className="h-1.5 w-1.5 rounded-full bg-white/15" />
          <div className="h-1.5 w-1.5 rounded-full bg-white/15" />
        </div>
      </footer>
    </div>
    </div>
  );
}