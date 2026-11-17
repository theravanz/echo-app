-- ════════════════════════════════════════════════════════════════════
-- Echo: terminate_device_session → SECURITY INVOKER
--
-- Функция удаляет только СВОИ устройства (user_id = auth.uid()) и никогда
-- не трогает текущее устройство (hwid <> requester_hwid). RLS-политика
-- "Users can delete own devices" разрешает ровно те же строки, поэтому
-- SECURITY DEFINER не даёт ничего, кроме лишних привилегий.
--
-- Дополнительно: клиент уже умеет удалять устройство напрямую
-- (supabase.from('devices').delete()), т.е. DELETE-право и RLS у
-- authenticated есть. Переводим RPC на INVOKER, чтобы RLS работал как
-- второй барьер (defense in depth) и linter 0029 перестал считать функцию
-- привилегированной.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.terminate_device_session(
  target_device_id TEXT,
  requester_hwid  TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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

-- Контракт доступа не меняется: только авторизованные пользователи.
REVOKE ALL ON FUNCTION public.terminate_device_session(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminate_device_session(text, text) TO authenticated, service_role;
