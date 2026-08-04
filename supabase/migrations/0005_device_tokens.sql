-- ════════════════════════════════════════════════════════════════════
-- Echo: FCM device_tokens — регистрация push-токенов устройств
-- ════════════════════════════════════════════════════════════════════
-- Хранит FCM-токен для каждого пользователя, чтобы edge-функции
-- (send-message-push, send-call-push) могли доставлять пуши, когда
-- приложение устройства в фоне. upsert идёт на конфликт user_id
-- (один активный токен на пользователя — конвейер REST RPC).

CREATE TABLE IF NOT EXISTS public.device_tokens (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Единственный активный push-токен устройства на пользователя
-- (upsert конфликтует по этому полю)
CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_user_id_key
  ON public.device_tokens (user_id);

-- Индекс для поиска по токену (отправка пуша получателю)
CREATE INDEX IF NOT EXISTS idx_device_tokens_token
  ON public.device_tokens (token);

-- Enable Row Level Security
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Пользователь может читать/менять только СВОЙ токен.
-- Edge-функции (service_role) обходят RLS, поэтому могут читать чужие
-- токены для доставки пушей.
CREATE POLICY "Users can view own device token"
  ON public.device_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own device token"
  ON public.device_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own device token"
  ON public.device_tokens FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own device token"
  ON public.device_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS device_tokens_updated_at ON public.device_tokens;
CREATE TRIGGER device_tokens_updated_at
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
