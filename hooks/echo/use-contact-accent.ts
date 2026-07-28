import { useEffect, useState } from "react";
import { averageColorFromImage, colorToCss } from "@/lib/color";

const cache = new Map<string, string>();

/** Returns a CSS color derived from the contact's avatar photo, or their
 *  stored avatar_color as a fallback while extraction runs / if it fails. */
export function useContactAccentColor(avatarUrl: string | null, fallbackColor?: string | null) {
  const [accent, setAccent] = useState(() => {
    if (avatarUrl && cache.has(avatarUrl)) return cache.get(avatarUrl)!;
    return fallbackColor || "rgb(139, 122, 236)";
  });

  useEffect(() => {
    if (!avatarUrl) {
      setAccent(fallbackColor || "rgb(139, 122, 236)");
      return;
    }
    if (cache.has(avatarUrl)) {
      setAccent(cache.get(avatarUrl)!);
      return;
    }
    let cancelled = false;
    averageColorFromImage(avatarUrl).then((c) => {
      if (cancelled) return;
      const css = colorToCss(c);
      cache.set(avatarUrl, css);
      setAccent(css);
    });
    return () => { cancelled = true; };
  }, [avatarUrl, fallbackColor]);

  return accent;
}
