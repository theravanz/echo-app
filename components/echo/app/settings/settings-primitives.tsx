"use client";

import { cn } from "@/lib/utils";

export const CornerBrackets = () => (
  <>
    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-primary/30 rounded-tl-sm pointer-events-none z-10" />
    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-primary/30 rounded-tr-sm pointer-events-none z-10" />
    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-primary/30 rounded-bl-sm pointer-events-none z-10" />
    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-primary/30 rounded-br-sm pointer-events-none z-10" />
  </>
);

export const GlassPanel = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("bg-card/30 backdrop-blur-2xl border border-white/5 relative overflow-hidden", className)}>
    {children}
  </div>
);

export const Badge = ({ type }: { type: 'beta' | 'wip' }) => (
  <span className={`text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${
    type === 'beta' ? 'text-primary border-primary/30 bg-primary/10' : 'text-amber-500 border-amber-500/30 bg-amber-500/10'
  }`}>
    {type === 'beta' ? 'Beta' : 'In Development'}
  </span>
);
