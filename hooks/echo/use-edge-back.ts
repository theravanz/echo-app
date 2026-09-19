// ─────────────────────────────────────────────────────────────────────
// Edge-swipe назад (iOS + Android): свайп вправо от левого края (≤30px)
// анимированно закрывает верхний слой через onCommit → closeTopLayer().
//
// Жест:
//   • активируется только когда enabled = true (навигатор сам решает —
//     напр. открытый чат на мобильном; нет чата → жест не работает);
//   • горизонтальная интенция: dx > 10px и |dx| > |dy| — иначе это скролл;
//   • touchmove делается preventDefault() (passive:false), чтобы iOS Safari
//     bounce не дёргал страницу при активном жесте;
//   • коммит: dx > ширины/3 ИЛИ velocity > 0.5 px/ms → спринт-анимация
//     ChatArea за правый край → onCommit(); иначе спринт-возврат в 0.
//
// Инвариант: жест «домой» iOS (нижний край) не трогаем — стартуем только
// от левого края.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { useMotionValue, animate, type MotionValue } from "framer-motion";

const EDGE_START_PX = 30;    // старт жеста только от левого края ≤30px
const INTENT_PX = 10;        // горизонтальная интенция до «перехвата»
const VELOCITY_COMMIT = 0.5; // px/ms

export interface EdgeBackGesture {
  /** Сдвиг ChatArea (0…ширина) во время жеста. */
  dragX: MotionValue<number>;
  /** Сдвиг сайдбара (подъезжает слева синхронно с dragX). */
  sidebarX: MotionValue<number>;
  /** Активен ли перехваченный жест (после интенции). */
  gestureActive: boolean;
}

export function useEdgeBackGesture(
  enabled: boolean,
  onCommit: () => void,
  /** Сайдбар скрыт за экраном (открыт чат) и должен подъезжать при жесте. */
  sidebarOffscreen = false,
): EdgeBackGesture {
  const dragX = useMotionValue(0);
  // Сайдбар живёт постоянно (не монтируется по hidden-классу в момент
  // жеста: mount давал «моргание» списка). Пока чат открыт — за левым
  // краем (x = -W), при жесте едет -W → 0, при откате — обратно.
  const sidebarX = useMotionValue(0);
  const [gestureActive, setGestureActive] = useState(false);

  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastRef = useRef<{ x: number; t: number } | null>(null);
  const activeRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const sidebarOffscreenRef = useRef(sidebarOffscreen);
  sidebarOffscreenRef.current = sidebarOffscreen;

  useEffect(() => {
    // База сайдбара: за экраном при открытом чате, на месте — иначе.
    // Меняется синхронно, без mount/unmount сайдбара.
    const width = typeof window !== "undefined" ? window.innerWidth : 1024;
    if (!enabled) {
      dragX.set(0);
      sidebarX.set(0);
      return;
    }
    sidebarX.set(sidebarOffscreen ? -width : 0);
  }, [enabled, dragX, sidebarX, sidebarOffscreen]);

  useEffect(() => {
    if (!enabled) return;
    const offscreenX = () => -(typeof window !== "undefined" ? window.innerWidth : 1024);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_START_PX) return;
      startRef.current = { x: t.clientX, y: t.clientY, t: performance.now() };
      lastRef.current = { x: t.clientX, t: performance.now() };
      activeRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      const start = startRef.current;
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;

      if (!activeRef.current) {
        if (dx > INTENT_PX && Math.abs(dx) > Math.abs(dy)) {
          activeRef.current = true;
          setGestureActive(true);
        } else if (Math.abs(dy) > INTENT_PX || dx < -INTENT_PX) {
          startRef.current = null; // вертикальный скролл или свайп влево — не наш жест
        }
        if (!activeRef.current) return;
      }

      // preventDefault при активном жесте: iOS bounce не должен дёргать страницу.
      if (e.cancelable) e.preventDefault();
      const dxClamped = Math.max(0, dx);
      dragX.set(dxClamped);
      if (sidebarOffscreenRef.current) sidebarX.set(offscreenX() + dxClamped);
      lastRef.current = { x: t.clientX, t: performance.now() };
    };

    const onTouchEnd = () => {
      const start = startRef.current;
      const last = lastRef.current;
      startRef.current = null;
      if (!activeRef.current || !start || !last) {
        activeRef.current = false;
        setGestureActive(false);
        dragX.set(0);
        sidebarX.set(sidebarOffscreenRef.current ? offscreenX() : 0);
        return;
      }
      activeRef.current = false;
      setGestureActive(false);

      const width = typeof window !== "undefined" ? window.innerWidth : 0;
      const dx = dragX.get();
      const dt = Math.max(1, last.t - start.t);
      const velocity = (last.x - start.x) / dt; // px/ms

      if (width > 0 && (dx > width / 3 || velocity > VELOCITY_COMMIT)) {
        // Коммит: спринт за правый край → закрыть слой → сброс.
        animate(dragX, width, {
          type: "spring",
          stiffness: 380,
          damping: 32,
          onComplete: () => {
            dragX.set(0);
            if (sidebarOffscreenRef.current) sidebarX.set(0); // список на месте — чат закрывается
            try {
              commitRef.current();
            } catch (err) {
              console.error("[BACK-NAV] edge-swipe commit failed:", err);
            }
          },
        });
        if (sidebarOffscreenRef.current) {
          animate(sidebarX, 0, { type: "spring", stiffness: 380, damping: 32 });
        }
      } else {
        // Откат: спринт-возврат обоих слоёв.
        animate(dragX, 0, { type: "spring", stiffness: 380, damping: 32 });
        if (sidebarOffscreenRef.current) {
          animate(sidebarX, offscreenX(), { type: "spring", stiffness: 380, damping: 32 });
        }
      }
    };

    const onTouchCancel = () => {
      startRef.current = null;
      if (activeRef.current) {
        activeRef.current = false;
        setGestureActive(false);
        animate(dragX, 0, { type: "spring", stiffness: 380, damping: 32 });
        if (sidebarOffscreenRef.current) {
          animate(sidebarX, offscreenX(), { type: "spring", stiffness: 380, damping: 32 });
        }
      }
    };

    // touchmove только с passive:false — иначе preventDefault() молча игнорируется.
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [enabled, dragX, sidebarX]);

  return { dragX, sidebarX, gestureActive };
}
