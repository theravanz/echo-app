-- ════════════════════════════════════════════════════════════════════
-- Echo: hardening по отчёту Supabase Database Linter
--
-- Закрываем безопасные и однозначные пункты:
--   1. Фиксируем search_path у функций с mutable search_path.
--   2. Убираем EXECUTE у anon там, где RPC нужен только авторизованным.
--   3. Переносим pg_trgm из public в extensions.
--   4. Убираем broad SELECT policy у публичного bucket wallpapers
--      (публичный URL работает и без листинга объектов).
--   5. Убираем дублирующий уникальный индекс device_tokens.
--   6. Оптимизируем RLS: auth.uid() → (select auth.uid()), убираем
--      дублирующиеся permissive-политики у devices/login_challenges.
--
-- Осознанно НЕ трогаем:
--   * broadcast_message остаётся доступной anon — QR-вход происходит до
--     авторизации; функция уже ограничена префиксом канала auth_.
--   * create_group_atomic / is_group_member / terminate_device_session
--     остаются SECURITY DEFINER и доступны authenticated: это их контракт.
-- ════════════════════════════════════════════════════════════════════

-- 1. Mutable search_path: linter 0011.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('protect_is_verified', 'handle_updated_at', 'terminate_device_session')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.signature);
  END LOOP;
END $$;

-- 2. SECURITY DEFINER RPC: anon не должен уметь их вызывать.
--    authenticated/service_role сохраняют доступ. Функции создаются
--    более ранними миграциями, поэтому проверяем наличие на всякий случай.
DO $$
BEGIN
  IF to_regprocedure('public.create_group_atomic(uuid,text,text,boolean,uuid[],uuid[],text[],text[])') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_group_atomic(uuid,text,text,boolean,uuid[],uuid[],text[],text[]) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_group_atomic(uuid,text,text,boolean,uuid[],uuid[],text[],text[]) TO authenticated, service_role';
  END IF;

  IF to_regprocedure('public.is_group_member(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.is_group_member(uuid) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated, service_role';
  END IF;

  IF to_regprocedure('public.terminate_device_session(text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.terminate_device_session(text,text) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.terminate_device_session(text,text) TO authenticated, service_role';
  END IF;

  -- get_my_bot_token приходит не из этого репозитория. Закрываем anon только
  -- если функция действительно завязана на auth.uid() (значит, anon ей не нужен).
  IF to_regprocedure('public.get_my_bot_token(uuid)') IS NOT NULL
     AND pg_get_functiondef('public.get_my_bot_token(uuid)'::regprocedure) ILIKE '%auth.uid()%' THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_my_bot_token(uuid) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_my_bot_token(uuid) TO authenticated, service_role';
  END IF;
END $$;

-- 3. pg_trgm: linter 0014.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS extensions';
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role';
  END IF;
END $$;

-- 4. Публичный bucket wallpapers: linter 0025.
--    Публичные объекты доступны по URL без SELECT-политики; политика нужна
--    только для storage.from(...).list(), а приложение листинг не использует.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can view wallpapers" ON storage.objects';
  END IF;
END $$;

-- 5. device_tokens: user_id — PRIMARY KEY, отдельный unique index дублирует его.
DROP INDEX IF EXISTS public.device_tokens_user_id_key;

-- 6. RLS-политики: (select auth.uid()) вычисляется один раз на запрос,
--    а не на каждую строку. Семантика доступа не меняется.

-- user_themes
DROP POLICY IF EXISTS "Users can view own theme" ON public.user_themes;
CREATE POLICY "Users can view own theme"
  ON public.user_themes FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own theme" ON public.user_themes;
CREATE POLICY "Users can insert own theme"
  ON public.user_themes FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own theme" ON public.user_themes;
CREATE POLICY "Users can update own theme"
  ON public.user_themes FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own theme" ON public.user_themes;
CREATE POLICY "Users can delete own theme"
  ON public.user_themes FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- devices: старые политики-дубли + initplan.
DROP POLICY IF EXISTS "View own devices" ON public.devices;
DROP POLICY IF EXISTS "Register own devices" ON public.devices;
DROP POLICY IF EXISTS "Update own devices" ON public.devices;
DROP POLICY IF EXISTS "Delete own devices" ON public.devices;

DROP POLICY IF EXISTS "Users can view own devices" ON public.devices;
CREATE POLICY "Users can view own devices"
  ON public.devices FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own devices" ON public.devices;
CREATE POLICY "Users can insert own devices"
  ON public.devices FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own devices" ON public.devices;
CREATE POLICY "Users can update own devices"
  ON public.devices FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own devices" ON public.devices;
CREATE POLICY "Users can delete own devices"
  ON public.devices FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- device_tokens
DROP POLICY IF EXISTS "Users can view own device token" ON public.device_tokens;
CREATE POLICY "Users can view own device token"
  ON public.device_tokens FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own device token" ON public.device_tokens;
CREATE POLICY "Users can insert own device token"
  ON public.device_tokens FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own device token" ON public.device_tokens;
CREATE POLICY "Users can update own device token"
  ON public.device_tokens FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own device token" ON public.device_tokens;
CREATE POLICY "Users can delete own device token"
  ON public.device_tokens FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- login_challenges: две SELECT-политики объединяем в одну, approve — initplan.
DROP POLICY IF EXISTS "Users can read their own challenges" ON public.login_challenges;
DROP POLICY IF EXISTS "Anyone with token can read challenge" ON public.login_challenges;
CREATE POLICY "Users can read own or token challenges"
  ON public.login_challenges FOR SELECT TO anon, authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (token IS NOT NULL AND expires_at > now())
  );

DROP POLICY IF EXISTS "Authenticated users can approve challenges" ON public.login_challenges;
CREATE POLICY "Authenticated users can approve challenges"
  ON public.login_challenges FOR UPDATE TO authenticated
  USING (status = 'pending')
  WITH CHECK (status = 'approved' AND user_id = (SELECT auth.uid()));

-- groups
DROP POLICY IF EXISTS "members can read own groups" ON public.groups;
CREATE POLICY "members can read own groups"
  ON public.groups FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members m
      WHERE m.group_id = groups.id
        AND m.user_id = (SELECT auth.uid())
    )
  );

-- group_members
DROP POLICY IF EXISTS "members can read group members" ON public.group_members;
CREATE POLICY "members can read group members"
  ON public.group_members FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_group_member(group_id)
  );

-- group_key_mailbox
DROP POLICY IF EXISTS "users can read own key packets" ON public.group_key_mailbox;
CREATE POLICY "users can read own key packets"
  ON public.group_key_mailbox FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "users can delete own key packets" ON public.group_key_mailbox;
CREATE POLICY "users can delete own key packets"
  ON public.group_key_mailbox FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
