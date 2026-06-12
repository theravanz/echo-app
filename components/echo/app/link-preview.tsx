"use client";

import { useState, useEffect, memo } from "react";

const previewCache = new Map<string, any>();

const getYouTubeId = (url: string) => {
  try {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  } catch { return null; }
};

export const LinkPreview = memo(({ url }: { url: string }) => {
  const [preview, setPreview] = useState<any>(previewCache.get(url) || null);
  const [loading, setLoading] = useState(!previewCache.get(url));

  useEffect(() => {
    if (previewCache.has(url)) return;
    let isMounted = true;
    const fetchMetadata = async () => {
      const youtubeId = getYouTubeId(url);
      if (youtubeId) {
        const ytData = {
          title: 'YouTube Video',
          image: { url: `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg` },
          publisher: 'YouTube',
          description: 'Watch video on YouTube'
        };
        if (isMounted) { setPreview(ytData); setLoading(false); }
        previewCache.set(url, ytData);
        return;
      }
      if (isMounted) setLoading(true);
      try {
        const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.status === 'success') {
          if (isMounted) setPreview(data.data);
          previewCache.set(url, data.data);
        } else { previewCache.set(url, { error: true }); }
      } catch (e) { previewCache.set(url, { error: true }); }
      finally { if (isMounted) setLoading(false); }
    };
    fetchMetadata();
    return () => { isMounted = false; };
  }, [url]);

  if (loading) return (
    <div className="mt-2 rounded-2xl bg-white/5 p-3 flex gap-3 animate-pulse">
      <div className="w-16 h-16 rounded-xl bg-white/10" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-2 bg-white/10 rounded w-1/3" />
        <div className="h-2 bg-white/10 rounded" />
      </div>
    </div>
  );
  if (!preview || preview.error) return null;
  return (
    <div className="mt-3 rounded-2xl bg-white/5 border border-white/5 overflow-hidden group/link cursor-pointer hover:bg-white/10 transition-all shadow-xl shadow-black/20" onClick={() => window.open(url, '_blank')}>
      {preview.image && <img src={preview.image.url} alt="" className="w-full aspect-video object-cover opacity-80 group-hover:opacity-100 transition-opacity" />}
      <div className="p-4">
        <div className="text-[10px] font-mono text-primary uppercase tracking-widest mb-1">{preview.publisher || 'External Link'}</div>
        <div className="text-sm font-bold mb-1 group-hover:text-primary transition-colors">{preview.title}</div>
        <div className="text-xs text-white/40 line-clamp-2">{preview.description}</div>
      </div>
    </div>
  );
});
LinkPreview.displayName = "LinkPreview";
