-- ════════════════════════════════════════════════════════════════════
-- Echo: devices — облачное хранилище сессий устройств (Sync + Quarantine)
-- ════════════════════════════════════════════════════════════════════
-- Идемпотентная миграция: CREATE IF NOT EXISTS для новых БД + ADD COLUMN
-- IF NOT EXISTS для апгрейда уже существующей таблицы devices.
--
-- Новые поля:
--   os_name        — каноничное имя ОС ("Android 14", "macOS 14.5", "Linux")
--   browser_name   — браузер/оболочка ("Chrome", "Safari", "Echo (Tauri)")
--   ip_address     — публичный IP на момент регистрации
--   location       — локация по IP; при VPN-расхождении два варианта через "/"
--   timezone       — часовой пояс устройства (IANA, напр. "Europe/Moscow")
--   is_vpn         — признак VPN/прокси (расхождение IP-таймзоны и устройства)

CREATE TABLE IF NOT EXISTS public.devices (
  id           TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hwid         TEXT NOT NULL,
  device_name  TEXT DEFAULT 'Unknown Device',
  platform     TEXT DEFAULT '',
  device_type  TEXT DEFAULT 'desktop',
  os_name      TEXT DEFAULT '',
  browser_name TEXT DEFAULT '',
  ip_address   TEXT DEFAULT '',
  location     TEXT DEFAULT '',
  timezone     TEXT DEFAULT '',
  is_vpn       BOOLEAN NOT NULL DEFAULT false,
  is_current   BOOLEAN NOT NULL DEFAULT false,
  last_active  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Апгрейд существующей таблицы (если колонок ещё нет) — идемпотентно.
-- ВАЖНО: реальная (уже созданная ранее) таблица devices могла НЕ иметь части
-- колонок, поэтому добавляем ВСЕ через ADD COLUMN IF NOT EXISTS, включая
-- device_name (его не было в исходной схеме) и служебные platform/is_current.
-- КРИТИЧНО: id в реальной таблице имеет тип UUID, а приложение пишет
-- строковые id вида "device_<uuid>_<timestamp>". Конвертируем id в TEXT,
-- иначе INSERT/UPDATE/DELETE и RPC падают с invalid input syntax for type uuid.
ALTER TABLE public.devices ALTER COLUMN id TYPE text USING id::text;

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS device_name  TEXT DEFAULT 'Unknown Device';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS platform     TEXT DEFAULT '';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS device_type  TEXT DEFAULT 'desktop';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS os_name      TEXT DEFAULT '';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS browser_name TEXT DEFAULT '';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS ip_address   TEXT DEFAULT '';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS location     TEXT DEFAULT '';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS timezone     TEXT DEFAULT '';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS is_vpn       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS is_current   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_active  TIMESTAMPTZ NOT NULL DEFAULT now();

-- Единственный активный HWID устройства на пользователя
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_hwid
  ON public.devices (user_id, hwid);

CREATE INDEX IF NOT EXISTS idx_devices_last_active
  ON public.devices (last_active DESC);

-- Row Level Security
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own devices" ON public.devices;
CREATE POLICY "Users can view own devices"
  ON public.devices FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own devices" ON public.devices;
CREATE POLICY "Users can insert own devices"
  ON public.devices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own devices" ON public.devices;
CREATE POLICY "Users can update own devices"
  ON public.devices FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own devices" ON public.devices;
CREATE POLICY "Users can delete own devices"
  ON public.devices FOR DELETE
  USING (auth.uid() = user_id);

-- RPC для завершения чужой сессии с проверкой владельца (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.terminate_device_session(
  target_device_id TEXT,
  requester_hwid  TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _requester UUID;
BEGIN
  SELECT auth.uid() INTO _requester;
  IF _requester IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.devices
  WHERE id = target_device_id
    AND user_id = _requester
    AND hwid <> requester_hwid;
END;
$$;
