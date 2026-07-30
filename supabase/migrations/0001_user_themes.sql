-- ════════════════════════════════════════════════════════════════════
-- Echo: User Themes & Wallpaper Storage
-- Run this in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════

-- 1. Create user_themes table for cloud theme persistence
CREATE TABLE IF NOT EXISTS public.user_themes (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme_name    TEXT NOT NULL DEFAULT 'Custom Echo Theme',
  theme_data    JSONB NOT NULL DEFAULT '{}',
  icon          TEXT NOT NULL DEFAULT 'default',
  wallpaper_url TEXT,
  wallpaper_mode TEXT DEFAULT 'cover',
  wallpaper_blur INTEGER DEFAULT 0,
  glass_enabled  BOOLEAN DEFAULT false,
  glass_blur     INTEGER DEFAULT 12,
  glass_opacity  REAL DEFAULT 0.6,
  colors         JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.user_themes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own theme
CREATE POLICY "Users can view own theme"
  ON public.user_themes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own theme"
  ON public.user_themes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own theme"
  ON public.user_themes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own theme"
  ON public.user_themes FOR DELETE
  USING (auth.uid() = user_id);

-- 2. Create wallpapers storage bucket (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('wallpapers', 'wallpapers', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage policies for wallpapers bucket
CREATE POLICY "Authenticated users can upload wallpapers"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'wallpapers' AND auth.role() = 'authenticated');

CREATE POLICY "Anyone can view wallpapers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'wallpapers');

CREATE POLICY "Users can delete own wallpapers"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'wallpapers' AND auth.uid() = owner);

-- 4. Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_themes_updated_at ON public.user_themes;
CREATE TRIGGER user_themes_updated_at
  BEFORE UPDATE ON public.user_themes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
