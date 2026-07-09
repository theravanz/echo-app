"use client";

import {
  TbMessageCircle,
  TbHeart,
  TbMoodSmile,
  TbMusic,
  TbCamera,
  TbStar,
  TbCloud,
  TbCoffee,
  TbBolt,
  TbSend,
  TbHeadphones,
  TbGift,
  TbMoonStars,
  TbRocket,
  TbPaperclip,
  TbFlower,
  TbBalloon,
  TbMapPin,
} from "react-icons/tb";

export type WallpaperPreset = "solid" | "doodle" | "photo";

const DOODLE_ICONS = [
  TbMessageCircle, TbHeart, TbMoodSmile, TbMusic, TbCamera, TbStar,
  TbCloud, TbCoffee, TbBolt, TbSend, TbHeadphones, TbGift,
  TbMoonStars, TbRocket, TbPaperclip, TbFlower, TbBalloon, TbMapPin,
];

// Fixed layout so the wallpaper doesn't reshuffle on every re-render —
// only the accent tint changes per chat.
const DOODLE_LAYOUT: { icon: number; top: number; left: number; size: number; rot: number }[] = [
  { icon: 0, top: 6, left: 10, size: 20, rot: -12 },
  { icon: 1, top: 4, left: 60, size: 16, rot: 15 },
  { icon: 2, top: 14, left: 85, size: 22, rot: -6 },
  { icon: 3, top: 20, left: 30, size: 15, rot: 20 },
  { icon: 4, top: 28, left: 5, size: 18, rot: -20 },
  { icon: 5, top: 33, left: 75, size: 20, rot: 10 },
  { icon: 6, top: 40, left: 45, size: 16, rot: -15 },
  { icon: 7, top: 48, left: 15, size: 19, rot: 8 },
  { icon: 8, top: 52, left: 90, size: 17, rot: -10 },
  { icon: 9, top: 58, left: 60, size: 15, rot: 18 },
  { icon: 10, top: 64, left: 8, size: 21, rot: -8 },
  { icon: 11, top: 70, left: 38, size: 16, rot: 12 },
  { icon: 12, top: 76, left: 80, size: 18, rot: -18 },
  { icon: 13, top: 82, left: 20, size: 15, rot: 6 },
  { icon: 14, top: 88, left: 55, size: 19, rot: -14 },
  { icon: 15, top: 93, left: 12, size: 16, rot: 22 },
  { icon: 16, top: 10, left: 42, size: 14, rot: -25 },
  { icon: 17, top: 60, left: 25, size: 14, rot: 25 },
];

export function ChatWallpaper({
  preset,
  accentColor,
  photoUrl,
}: {
  preset: WallpaperPreset;
  accentColor: string;
  photoUrl?: string | null;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        className="absolute inset-0"
        style={{
          background:
            preset === "photo" && photoUrl
              ? `url(${photoUrl}) center/cover`
              : "linear-gradient(165deg, #1a1420, #0a0a0d 55%)",
        }}
      />

      {preset === "photo" && <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />}

      {preset === "doodle" &&
        DOODLE_LAYOUT.map((d, i) => {
          const Icon = DOODLE_ICONS[d.icon];
          return (
            <Icon
              key={i}
              className="absolute text-white"
              style={{
                top: `${d.top}%`,
                left: `${d.left}%`,
                width: d.size,
                height: d.size,
                opacity: 0.07,
                transform: `rotate(${d.rot}deg)`,
              }}
            />
          );
        })}

      {/* Faint grain for depth — cheap approximation via a dotted radial pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: "radial-gradient(circle, #fff 0.5px, transparent 0.5px)", backgroundSize: "4px 4px" }}
      />

      {/* Single soft accent glow, tinted per-contact — replaces the earlier
          two-blob version, which read as neon rather than premium. */}
      <div
        className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-44 rounded-full blur-[60px]"
        style={{ background: accentColor, opacity: 0.07 }}
      />
    </div>
  );
}
