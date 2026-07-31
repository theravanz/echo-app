-- ════════════════════════════════════════════════════════════════════
-- Echo: QR Login Challenges
-- Run this in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════

-- 1. Create login_challenges table for QR code authorization
CREATE TABLE IF NOT EXISTS public.login_challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'expired')),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_data JSONB,
  device_info JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes')
);

-- 2. Index for fast polling by token
CREATE INDEX IF NOT EXISTS idx_login_challenges_token ON public.login_challenges(token);
CREATE INDEX IF NOT EXISTS idx_login_challenges_status ON public.login_challenges(status);

-- 3. RLS: enable row-level security
ALTER TABLE public.login_challenges ENABLE ROW LEVEL SECURITY;

-- 4. Anyone can insert a pending challenge (desktop app generates it)
CREATE POLICY "Anyone can insert pending challenges"
  ON public.login_challenges
  FOR INSERT
  TO public
  WITH CHECK (status = 'pending');

-- 5. Authenticated users can read their own approved challenges (for polling)
CREATE POLICY "Users can read their own challenges"
  ON public.login_challenges
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 6. Anyone with the token can read the challenge (desktop polls by token)
CREATE POLICY "Anyone with token can read challenge"
  ON public.login_challenges
  FOR SELECT
  TO public
  USING (token IS NOT NULL AND expires_at > now());

-- 7. Authenticated users can approve challenges (set status = 'approved' and user_id + session_data)
CREATE POLICY "Authenticated users can approve challenges"
  ON public.login_challenges
  FOR UPDATE
  TO authenticated
  USING (status = 'pending')
  WITH CHECK (status = 'approved' AND user_id = auth.uid());

-- 8. Auto-expire old challenges (runs every minute via pg_cron or manual cleanup)
--    If you have pg_cron installed, uncomment:
-- SELECT cron.schedule('expire-login-challenges', '* * * * *', 
--   "UPDATE public.login_challenges SET status = 'expired' WHERE expires_at < now() AND status = 'pending'"
-- );