export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Samples a downscaled copy of an image on a canvas and averages the
 *  pixels. Used to derive both a track's card background (profile editor)
 *  and a chat's accent color (from the contact's avatar). */
export function averageColorFromImage(url: string): Promise<RgbColor | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        resolve({ r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const DEFAULT_ACCENT = "rgb(139, 122, 236)"; // neutral violet fallback

export function colorToCss(c: RgbColor | null): string {
  if (!c) return DEFAULT_ACCENT;
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

export function gradientFromColor(c: RgbColor | null): string {
  if (!c) return "linear-gradient(135deg, #8b7aec, #4a3d8f)";
  const light = `rgb(${Math.min(255, c.r + 35)}, ${Math.min(255, c.g + 35)}, ${Math.min(255, c.b + 35)})`;
  const dark = `rgb(${Math.round(c.r * 0.4)}, ${Math.round(c.g * 0.4)}, ${Math.round(c.b * 0.4)})`;
  return `linear-gradient(135deg, ${light}, ${dark})`;
}
