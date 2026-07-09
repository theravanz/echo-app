import { useEffect, useRef } from 'react';
import { StickerDecoder } from '@/lib/sticker-decoder';

interface StickerRendererProps {
  path: string;
  className?: string;
  size?: number;
  animate?: boolean;
}

export function StickerRenderer({ 
  path, 
  className, 
  size = 128,
  animate = true 
}: StickerRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopAnimationRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    canvas.width = size;
    canvas.height = size;

    if (animate) {
      StickerDecoder.animateSticker(path, canvas).then(stop => {
        stopAnimationRef.current = stop;
      });
    } else {
      StickerDecoder.decodeToCanvas(path, canvas, 0).catch(console.error);
    }

    return () => {
      stopAnimationRef.current?.();
    };
  }, [path, size, animate]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}