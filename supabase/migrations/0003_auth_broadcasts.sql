-- ════════════════════════════════════════════════════════════════════
-- Echo: QR E2EE key exchange — Realtime-трансляция через postgres_changes
-- ════════════════════════════════════════════════════════════════════
-- Мобилка шлёт зашифрованный E2EE-ключ (DH + XSalsa20-Poly1305) через REST
-- RPC broadcast_message(channel, event, payload). Функция делает INSERT;
-- Realtime публикует INSERT подписчикам канала auth_<session_id>.
-- Сервер видит только ciphertext — ключи только у пиров.
-- ════════════════════════════════════════════════════════════════════

-- 1. Таблица трансляций
CREATE TABLE IF NOT EXISTS public.auth_broadcasts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel     TEXT    NOT NULL,
  event       TEXT    NOT NULL,
  payload     JSONB   NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_broadcasts_channel ON public.auth_broadcasts(channel);
CREATE INDEX IF NOT EXISTS idx_auth_broadcasts_created ON public.auth_broadcasts(created_at);

-- 2. RPC-функция broadcast_message — то, что вызывает мобилка через REST.
--    Имя и параметры совпадают с контрактом Supabase Realtime Broadcast.
--    SECURITY DEFINER: обходит RLS, но INSERT идёт только через эту функцию.
CREATE OR REPLACE FUNCTION public.broadcast_message(
  "channel" TEXT,
  "event"   TEXT,
  "payload" JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ограничиваем префикс, чтобы функцию нельзя было использовать для
  -- произвольных каналов. Для QR-авторизации канал всегда auth_<session_id>.
  IF channel IS NULL OR channel NOT LIKE 'auth_%' THEN
    RAISE EXCEPTION 'invalid channel prefix';
  END IF;

  INSERT INTO public.auth_broadcasts (channel, event, payload)
  VALUES (channel, event, payload);
END;
$$;

-- 3. RLS: читать может кто угодно (Realtime postgres_changes требует SELECT
--    политику для роли anon/authenticated — именно под ними подписан веб).
--    Прямой INSERT/UPDATE/DELETE закрыт — запись только через SECURITY DEFINER
--    функцию. Payload всё равно зашифрован (DH), так что утечки по каналу нет.
ALTER TABLE public.auth_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read auth_broadcasts"
  ON public.auth_broadcasts
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "no direct insert"
  ON public.auth_broadcasts
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "no direct update"
  ON public.auth_broadcasts
  FOR UPDATE
  TO anon, authenticated
  USING (false);

CREATE POLICY "service_role can delete old"
  ON public.auth_broadcasts
  FOR DELETE
  TO service_role
  USING (true);

-- 4. Добавить таблицу в публикацию Realtime (иначе postgres_changes не придёт).
ALTER PUBLICATION supabase_realtime ADD TABLE public.auth_broadcasts;

-- 5. Авто-очистка старых записей (опционально, через pg_cron).
--    Записи одноразовые, хранить дольше 10 минут нет смысла.
-- SELECT cron.schedule('cleanup-auth-broadcasts', '*/5 * * * *',
--   $$ DELETE FROM public.auth_broadcasts WHERE created_at < now() - interval '10 minutes' $$
-- );

-- 6. Первичная очистка (если пересоздаёте).
DELETE FROM public.auth_broadcasts WHERE created_at < now() - interval '10 minutes';
