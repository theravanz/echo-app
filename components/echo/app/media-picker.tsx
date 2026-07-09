"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StickerRenderer } from '@/components/StickerRenderer';

// ─── Tab Icons (SVG, not emoji) ───────────────────────────────
const EmojiIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" y1="9" x2="9.01" y2="9" />
    <line x1="15" y1="9" x2="15.01" y2="9" />
  </svg>
);

const StickerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v5a4 4 0 0 0 4 4h4" />
    <path d="M16 22a6 6 0 0 0 6-6" />
    <path d="M15.5 17.5 21 12" />
    <rect x="8" y="9" width="8" height="2" rx="1" />
    <path d="M9 14h2" />
    <path d="M13 14h2" />
  </svg>
);

const GifIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <polyline points="21 9 15 9 15 15" />
    <line x1="21" y1="15" x2="15" y2="15" />
    <line x1="9" y1="9" x2="9" y2="15" />
    <line x1="9" y1="12" x2="12" y2="12" />
  </svg>
);

export interface MediaPickerProps {
  onEmojiSelect: (emoji: string) => void;
  onStickerSelect: (url: string) => void;
  onGifSelect: (url: string) => void;
}

type Tab = 'emoji' | 'stickers' | 'gifs';

interface StickerPack {
  id: string;
  name: string;
  icon: string;
  stickers: { id: string; url: string; format: string }[];
}

interface GiphyResult {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
}

// ─── Twemoji codepoint helper ─────────────────────────────────
function toTwemojiCodepoint(emoji: string): string {
  const codePoints = [...emoji].map(c => c.codePointAt(0)!.toString(16)).join('-');
  return codePoints;
}

// ─── Emoji Categories ─────────────────────────────────────────
interface EmojiCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  emojis: string[];
}

const SMILEY_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
  </svg>
);
const PEOPLE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const ANIMALS_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 10c0 6-4 10-8 10s-8-4-8-10a6 6 0 0 1 12 0Z"/><path d="M12 5a4 4 0 0 1 4-4"/><path d="M12 5a4 4 0 0 0-4-4"/>
  </svg>
);
const FOOD_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8Z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
  </svg>
);
const ACTIVITIES_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
  </svg>
);
const TRAVEL_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);
const OBJECTS_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="2" width="20" height="20" rx="2"/><path d="M12 6v4l2 2"/>
  </svg>
);
const SYMBOLS_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
  </svg>
);

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys', name: 'Smileys', icon: SMILEY_ICON,
    emojis: ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','😉','😌',
      '😍','🥰','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑',
      '🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄',
      '😬','😮','😯','😲','😳','🥺','😢','😭','😤','😠','😡','🤬',
      '😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','🤖','😺',
      '😸','😹','😻','😼','😽','🙀','😿','😾'],
  },
  {
    id: 'people', name: 'People', icon: PEOPLE_ICON,
    emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘',
      '🤙','👈','👉','👆','🖕','👇','👍','👎','✊','👊','🤛','🤜',
      '👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦵','🦶',
      '👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄',
      '👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵'],
  },
  {
    id: 'animals', name: 'Animals', icon: ANIMALS_ICON,
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮',
      '🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦆',
      '🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌',
      '🐞','🐜','🪰','🪲','🪳','🦟','🦗','🐢','🐍','🦎','🦖','🦕',
      '🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈'],
  },
  {
    id: 'food', name: 'Food', icon: FOOD_ICON,
    emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑',
      '🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑',
      '🌽','🥕','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🥨','🧀','🥚',
      '🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕',
      '🥪','🥙','🧆','🌮','🌯','🥗','🥘','🫕','🥫','🍝','🍜','🍲'],
  },
  {
    id: 'activities', name: 'Activities', icon: ACTIVITIES_ICON,
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓',
      '🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿',
      '🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂',
      '🏋️','🤼','🤸','🤺','⛹️','🤾','🏌️','🏇','🧘','🏄','🏊','🤽'],
  },
  {
    id: 'travel', name: 'Travel', icon: TRAVEL_ICON,
    emojis: ['🌍','🌎','🌏','🌐','🗺️','🗾','🧭','🏔️','⛰️','🌋','🗻','🏕️',
      '🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🧱','🪨','🪵','🏘️','🏚️',
      '🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬'],
  },
  {
    id: 'objects', name: 'Objects', icon: OBJECTS_ICON,
    emojis: ['💡','🔦','🕯️','🗜️','🔧','🔨','⚒️','🛠️','⛏️','🪓','🔩','⚙️',
      '🗡️','⚔️','💣','🪃','🏹','🛡️','🔫','🪚','🔗','⛓️','🪝','🧰',
      '🧲','🪜','⚗️','🧪','🧫','🧬','🔬','🔭','📡','💉','🩸','💊'],
  },
  {
    id: 'symbols', name: 'Symbols', icon: SYMBOLS_ICON,
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕',
      '💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️',
      '✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌'],
  },
];

// ─── Sticker Sample Data ──────────────────────────────────────
const SAMPLE_STICKER_PACKS: StickerPack[] = [
  {
    id: 'cute', name: 'Cute',
    icon: 'https://twemoji.maxcdn.com/v/latest/72x72/1f60a.png',
    stickers: [
      { id: 'c1', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60a/512.gif', format: 'png' },
      { id: 'c2', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60d/512.gif', format: 'png' },
      { id: 'c3', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f618/512.gif', format: 'png' },
      { id: 'c4', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f617/512.gif', format: 'png' },
      { id: 'c5', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f619/512.gif', format: 'png' },
      { id: 'c6', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f61a/512.gif', format: 'png' },
      { id: 'c7', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60b/512.gif', format: 'png' },
      { id: 'c8', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60c/512.gif', format: 'png' },
    ],
  },
  {
    id: 'funny', name: 'Funny',
    icon: 'https://twemoji.maxcdn.com/v/latest/72x72/1f602.png',
    stickers: [
      { id: 'f1', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f602/512.gif', format: 'png' },
      { id: 'f2', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f923/512.gif', format: 'png' },
      { id: 'f3', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f606/512.gif', format: 'png' },
      { id: 'f4', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f605/512.gif', format: 'png' },
      { id: 'f5', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f604/512.gif', format: 'png' },
      { id: 'f6', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f603/512.gif', format: 'png' },
      { id: 'f7', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f924/512.gif', format: 'png' },
      { id: 'f8', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f62d/512.gif', format: 'png' },
    ],
  },
  {
    id: 'reactions', name: 'Reactions',
    icon: 'https://twemoji.maxcdn.com/v/latest/72x72/1f44d.png',
    stickers: [
      { id: 'r1', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44d/512.gif', format: 'png' },
      { id: 'r2', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44e/512.gif', format: 'png' },
      { id: 'r3', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44f/512.gif', format: 'png' },
      { id: 'r4', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f64f/512.gif', format: 'png' },
      { id: 'r5', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f4aa/512.gif', format: 'png' },
      { id: 'r6', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f90f/512.gif', format: 'png' },
      { id: 'r7', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/512.gif', format: 'png' },
      { id: 'r8', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f680/512.gif', format: 'png' },
    ],
  },
  {
    id: 'hearts', name: 'Hearts',
    icon: 'https://twemoji.maxcdn.com/v/latest/72x72/2764.png',
    stickers: [
      { id: 'h1', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/2764/512.gif', format: 'png' },
      { id: 'h2', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f498/512.gif', format: 'png' },
      { id: 'h3', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f49d/512.gif', format: 'png' },
      { id: 'h4', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f496/512.gif', format: 'png' },
      { id: 'h5', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f497/512.gif', format: 'png' },
      { id: 'h6', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f493/512.gif', format: 'png' },
      { id: 'h7', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f49e/512.gif', format: 'png' },
      { id: 'h8', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f495/512.gif', format: 'png' },
    ],
  },
];

// ─── Giphy API ────────────────────────────────────────────────
const GIPHY_API_KEY = 'YOUR_GIPHY_API_KEY';

async function fetchGifs(query: string = '', offset: number = 0): Promise<GiphyResult[]> {
  const endpoint = query
    ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=24&offset=${offset}&rating=g`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&offset=${offset}&rating=g`;
  try {
    const res = await fetch(endpoint);
    const data = await res.json();
    return (data.data || []).map((gif: any) => ({
      id: gif.id,
      title: gif.title || '',
      url: gif.images.original?.url || '',
      previewUrl: gif.images.fixed_width?.url || gif.images.downsized?.url || '',
    }));
  } catch {
    return [];
  }
}

// ─── EmojiGrid Sub-component ──────────────────────────────────
function EmojiGrid({ onEmojiSelect }: { onEmojiSelect: (emoji: string) => void }) {
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollToCategory = (categoryId: string) => {
    setActiveCategory(categoryId);
    const el = categoryRefs.current[categoryId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const scrollCenter = container.scrollTop + container.clientHeight / 2;
    let closestCat = EMOJI_CATEGORIES[0].id;
    let closestDist = Infinity;
    for (const cat of EMOJI_CATEGORIES) {
      const el = categoryRefs.current[cat.id];
      if (el) {
        const dist = Math.abs(el.offsetTop - scrollCenter);
        if (dist < closestDist) { closestDist = dist; closestCat = cat.id; }
      }
    }
    setActiveCategory(closestCat);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-0.5 px-1 py-1.5 overflow-x-auto shrink-0 scrollbar-hide border-b border-white/5">
        {EMOJI_CATEGORIES.map(cat => (
          <button key={cat.id} onClick={() => scrollToCategory(cat.id)}
            className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 ${
              activeCategory === cat.id
                ? "bg-primary/20 text-primary"
                : "text-white/30 hover:text-white/60 hover:bg-white/5"
            }`}
            title={cat.name}
          >
            {cat.icon}
          </button>
        ))}
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overscroll-contain px-1 py-1">
        {EMOJI_CATEGORIES.map(cat => (
          <div key={cat.id} ref={el => { categoryRefs.current[cat.id] = el; }} className="mb-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-white/30 px-1.5 py-1">
              {cat.name}
            </div>
            <div className="grid grid-cols-8 gap-0.5">
              {cat.emojis.map(emoji => (
                <button key={emoji} onClick={() => onEmojiSelect(emoji)}
                  className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-lg"
                >
                  <img
                    src={`https://twemoji.maxcdn.com/v/latest/72x72/${toTwemojiCodepoint(emoji)}.png`}
                    alt={emoji} className="w-6 h-6 object-contain" loading="lazy" draggable={false}
                  />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── StickerGrid Sub-component ────────────────────────────────
function StickerGrid({ onStickerSelect }: { onStickerSelect: (url: string) => void }) {
  const [activePack, setActivePack] = useState(SAMPLE_STICKER_PACKS[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const packRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollToPack = (packId: string) => {
    setActivePack(packId);
    const el = packRefs.current[packId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const scrollCenter = container.scrollTop + container.clientHeight / 2;
    let closestPack = SAMPLE_STICKER_PACKS[0].id;
    let closestDist = Infinity;
    for (const pack of SAMPLE_STICKER_PACKS) {
      const el = packRefs.current[pack.id];
      if (el) {
        const dist = Math.abs(el.offsetTop - scrollCenter);
        if (dist < closestDist) { closestDist = dist; closestPack = pack.id; }
      }
    }
    setActivePack(closestPack);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1.5 px-2 py-2 overflow-x-auto shrink-0 scrollbar-hide border-b border-white/5">
        {SAMPLE_STICKER_PACKS.map(pack => (
          <button key={pack.id} onClick={() => scrollToPack(pack.id)}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all duration-200 text-xs font-medium ${
              activePack === pack.id
                ? "bg-primary/20 text-primary border border-primary/20"
                : "bg-white/5 text-white/40 hover:text-white/60 hover:bg-white/10 border border-transparent"
            }`}
          >
            <img src={pack.icon} alt="" className="w-5 h-5 rounded" />
            <span>{pack.name}</span>
          </button>
        ))}
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overscroll-contain p-2">
        {SAMPLE_STICKER_PACKS.map(pack => (
          <div key={pack.id} ref={el => { packRefs.current[pack.id] = el; }} className="mb-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-white/30 px-0.5 pb-1">
              {pack.name}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {pack.stickers.map(sticker => (
                <motion.button key={sticker.id}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => onStickerSelect(sticker.url)}
                  className="aspect-square rounded-xl overflow-hidden bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <StickerRenderer path={sticker.url} size={80} className="w-full h-full" animate={false} />
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── GifGrid Sub-component ────────────────────────────────────
function GifGrid({ onGifSelect }: { onGifSelect: (url: string) => void }) {
  const [search, setSearch] = useState("");
  const [gifs, setGifs] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadGifs = useCallback(async (query: string = "") => {
    setLoading(true);
    const results = await fetchGifs(query);
    setGifs(results);
    setLoading(false);
  }, []);

  useEffect(() => { loadGifs(); }, [loadGifs]);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadGifs(value), 400);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    loadGifs(search);
  };

  return (
    <div className="flex flex-col h-full">
      <form onSubmit={handleSubmit} className="shrink-0 px-2 py-2 border-b border-white/5">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Search GIFs on Giphy..."
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-8 pr-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors"
          />
        </div>
      </form>
      <div className="flex-1 overflow-y-auto overscroll-contain p-2">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-white/20 text-sm gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <polyline points="21 9 15 9 15 15" /><line x1="21" y1="15" x2="15" y2="15" />
              <line x1="9" y1="9" x2="9" y2="15" /><line x1="9" y1="12" x2="12" y2="12" />
            </svg>
            <span>No GIFs found</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {gifs.map(gif => (
              <motion.button key={gif.id}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onGifSelect(gif.url)}
                className="relative rounded-xl overflow-hidden bg-white/5 aspect-video"
                title={gif.title}
              >
                <img src={gif.previewUrl} alt={gif.title || "GIF"}
                  className="w-full h-full object-cover" loading="lazy" />
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab Button ───────────────────────────────────────────────
function TabButton({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all duration-200 ${
        active
          ? "text-primary border-b-2 border-primary"
          : "text-white/30 hover:text-white/50 border-b-2 border-transparent"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ─── Main MediaPicker ─────────────────────────────────────────
export function MediaPicker({ onEmojiSelect, onStickerSelect, onGifSelect }: MediaPickerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("emoji");
  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: "emoji", icon: <EmojiIcon />, label: "Emoji" },
    { id: "stickers", icon: <StickerIcon />, label: "Stickers" },
    { id: "gifs", icon: <GifIcon />, label: "GIFs" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      onClick={e => e.stopPropagation()}
      className="w-[340px] sm:w-[380px] h-[420px] bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
    >
      <div className="flex shrink-0 bg-white/[0.02]">
        {tabs.map(tab => (
          <TabButton key={tab.id} active={activeTab === tab.id} icon={tab.icon} label={tab.label}
            onClick={() => setActiveTab(tab.id)} />
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab}
            initial={{ opacity: 0, x: activeTab === "emoji" ? -12 : 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: activeTab === "emoji" ? -12 : 12 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {activeTab === "emoji" && <EmojiGrid onEmojiSelect={onEmojiSelect} />}
            {activeTab === "stickers" && <StickerGrid onStickerSelect={onStickerSelect} />}
            {activeTab === "gifs" && <GifGrid onGifSelect={onGifSelect} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
