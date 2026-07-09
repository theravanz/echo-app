import { invoke } from '@tauri-apps/api/core';

export interface StickerInfo {
  format: string;
  width: number;
  height: number;
  frame_count: number;
  duration_ms: number;
  is_animated: boolean;
}

export class StickerDecoder {
  private static cache = new Map<string, StickerInfo>();

  static async getInfo(path: string): Promise<StickerInfo> {
    if (this.cache.has(path)) {
      return this.cache.get(path)!;
    }

    const ext = path.split('.').pop()?.toLowerCase();
    let info: StickerInfo;

    if (ext === 'webp') {
      info = await invoke('decode_webp_info', { path });
    } else if (ext === 'tgs') {
      info = await invoke('decode_tgs_info', { path });
    } else if (ext === 'webm') {
      info = await invoke('decode_webm_info', { path });
    } else if (ext === 'png') {
      info = await invoke('decode_png_info', { path });
    } else {
      throw new Error(`Unsupported format: ${ext}`);
    }

    this.cache.set(path, info);
    return info;
  }

  static async decodeToCanvas(
    path: string,
    canvas: HTMLCanvasElement,
    frame: number = 0
  ): Promise<void> {
    const ext = path.split('.').pop()?.toLowerCase();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const info = await this.getInfo(path);
    canvas.width = info.width;
    canvas.height = info.height;

    let pixels: Uint8Array;

    if (ext === 'webp' || ext === 'png') {
      const command = ext === 'webp' ? 'decode_webp_to_rgba' : 'decode_png_to_rgba';
      const data = await invoke<number[]>(command, { path });
      pixels = new Uint8Array(data);
    } else if (ext === 'tgs') {
      const data = await invoke<number[]>('decode_tgs_frame', { 
        path, 
        frame, 
        width: info.width, 
        height: info.height 
      });
      pixels = new Uint8Array(data);
    } else if (ext === 'webm') {
      const data = await invoke<number[]>('decode_webm_frame', { 
        path, 
        frame_index: frame 
      });
      pixels = new Uint8Array(data);
    } else {
      return;
    }

    const imageData = new ImageData(
      new Uint8ClampedArray(pixels),
      info.width,
      info.height
    );
    ctx.putImageData(imageData, 0, 0);
  }

  static async animateSticker(
    path: string,
    canvas: HTMLCanvasElement,
    onFrame?: (frame: number) => void
  ): Promise<() => void> {
    const info = await this.getInfo(path);
    
    if (!info.is_animated) {
      await this.decodeToCanvas(path, canvas, 0);
      return () => {};
    }

    const fps = 30;
    const frameDuration = 1000 / fps;
    let currentFrame = 0;
    let animationId: number;

    const renderFrame = async () => {
      await this.decodeToCanvas(path, canvas, currentFrame);
      onFrame?.(currentFrame);
      currentFrame = (currentFrame + 1) % info.frame_count;
      animationId = window.setTimeout(renderFrame, frameDuration);
    };

    await renderFrame();

    return () => {
      window.clearTimeout(animationId);
    };
  }

  static clearCache(): void {
    this.cache.clear();
  }

  /** Check if running on Android */
  static async isAndroid(): Promise<boolean> {
    return invoke<boolean>('is_android');
  }

  /** Check if running on mobile (Android or iOS) */
  static async isMobile(): Promise<boolean> {
    return invoke<boolean>('is_mobile');
  }
}