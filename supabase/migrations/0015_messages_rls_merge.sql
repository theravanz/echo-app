-- ════════════════════════════════════════════════════════════════════
-- Echo: RLS hardening для public.messages
--
-- Linter 0003 (auth_rls_initplan): политики "Echo insert/select messages
-- policy" вызывают auth.uid() на каждую строку. Заменяем на
-- (SELECT auth.uid()) — Postgres вычисляет это один раз на запрос (InitPlan).
--
-- Linter 0006 (multiple_permissive_policies): на messages одновременно
-- висят старые DM-политики "Users can ..." и новые group-aware
-- "Echo ...". Обе PERMISSIVE, поэтому эффективное условие = OR их выражений.
-- Мы НЕ угадываем определения (их нет в репозитории, они создавались в
-- Dashboard): читаем реальные выражения из pg_policies, объединяем их через
-- OR в политику Echo и удаляем legacy-дубль. Семантика не меняется.
--
-- Безопасность:
--   * объединяем только политики с одинаковыми cmd/permissive/roles;
--   * если наборы ролей различаются — ничего не трогаем и пишем NOTICE;
--   * при отсутствии Echo-политики legacy не удаляется;
--   * всё в одной транзакции: ALTER проходит до DROP.
-- ════════════════════════════════════════════════════════════════════

-- Обёртка InitPlan. Идемпотентна: уже обёрнутые auth.*() не задваиваются.
CREATE OR REPLACE FUNCTION pg_temp.echo_wrap_initplan(expr TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  out  TEXT := expr;
  fn   TEXT;
  mark TEXT;
BEGIN
  IF out IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH fn IN ARRAY ARRAY['uid', 'jwt', 'role', 'email'] LOOP
    mark := '__ECHO_AUTH_' || upper(fn) || '__';
    -- Уже обёрнутое выражение вида "( SELECT auth.uid() AS uid)" прячем,
    -- чтобы повторный прогон миграции не наращивал вложенность.
    out := regexp_replace(
      out,
      '\(\s*SELECT\s+auth\.' || fn || '\(\)(\s+AS\s+\w+)?\s*\)',
      mark,
      'gi'
    );
    out := replace(out, 'auth.' || fn || '()', '(SELECT auth.' || fn || '())');
    out := replace(out, mark, '(SELECT auth.' || fn || '())');
  END LOOP;

  -- current_setting(...) тоже переоценивается на строку. Если он уже
  -- обёрнут — не трогаем (идемпотентность).
  IF out !~* 'SELECT\s+(pg_catalog\.)?current_setting' THEN
    out := regexp_replace(
      out,
      '(pg_catalog\.)?current_setting\(([^()]*)\)',
      '(SELECT \1current_setting(\2))',
      'gi'
    );
  END IF;

  RETURN out;
END;
$fn$;

DO $mig$
DECLARE
  pol          RECORD;
  e            RECORD;
  l            RECORD;
  pair         RECORD;
  stmt         TEXT;
  parts        TEXT;
  merged_qual  TEXT;
  merged_check TEXT;
BEGIN
  IF to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE 'public.messages not found, skipping messages RLS hardening';
    RETURN;
  END IF;

  -- ── 1. InitPlan: оборачиваем auth.*() / current_setting() ──────────
  FOR pol IN
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'messages'
  LOOP
    stmt  := format('ALTER POLICY %I ON public.messages', pol.policyname);
    parts := '';

    IF pol.cmd IN ('ALL', 'SELECT', 'UPDATE', 'DELETE') AND pol.qual IS NOT NULL THEN
      parts := parts || format(' USING (%s)', pg_temp.echo_wrap_initplan(pol.qual));
    END IF;

    IF pol.cmd IN ('ALL', 'INSERT', 'UPDATE') AND pol.with_check IS NOT NULL THEN
      parts := parts || format(' WITH CHECK (%s)', pg_temp.echo_wrap_initplan(pol.with_check));
    END IF;

    IF parts <> '' THEN
      EXECUTE stmt || parts;
    END IF;
  END LOOP;

  -- ── 2. Схлопываем permissive-дубли в одну Echo-политику ────────────
  FOR pair IN
    SELECT *
    FROM (VALUES
      ('Echo insert messages policy', 'Users can insert their own messages'),
      ('Echo select messages policy', 'Users can view their own messages')
    ) AS t(echo_name, legacy_name)
  LOOP
    SELECT policyname, cmd, permissive, roles, qual, with_check
      INTO e
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'messages'
        AND policyname = pair.echo_name;

    IF NOT FOUND THEN
      RAISE NOTICE 'policy "%" not found, leaving "%" untouched',
        pair.echo_name, pair.legacy_name;
      CONTINUE;
    END IF;

    SELECT policyname, cmd, permissive, roles, qual, with_check
      INTO l
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'messages'
        AND policyname = pair.legacy_name;

    IF NOT FOUND THEN
      RAISE NOTICE 'policy "%" already absent', pair.legacy_name;
      CONTINUE;
    END IF;

    -- Объединять OR можно только одинаковые по области действия политики.
    IF e.cmd <> l.cmd
       OR e.permissive <> 'PERMISSIVE'
       OR l.permissive <> 'PERMISSIVE'
       OR NOT (e.roles @> l.roles AND l.roles @> e.roles) THEN
      RAISE NOTICE 'skip merge "%" + "%": cmd/permissive/roles differ',
        pair.echo_name, pair.legacy_name;
      CONTINUE;
    END IF;

    CASE e.cmd
      WHEN 'INSERT' THEN
        merged_check := format(
          '(%s) OR (%s)',
          coalesce(e.with_check, 'true'),
          coalesce(l.with_check, 'true')
        );
        EXECUTE format(
          'ALTER POLICY %I ON public.messages WITH CHECK (%s)',
          pair.echo_name, merged_check
        );

      WHEN 'SELECT' THEN
        merged_qual := format(
          '(%s) OR (%s)',
          coalesce(e.qual, 'true'),
          coalesce(l.qual, 'true')
        );
        EXECUTE format(
          'ALTER POLICY %I ON public.messages USING (%s)',
          pair.echo_name, merged_qual
        );

      WHEN 'DELETE' THEN
        merged_qual := format(
          '(%s) OR (%s)',
          coalesce(e.qual, 'true'),
          coalesce(l.qual, 'true')
        );
        EXECUTE format(
          'ALTER POLICY %I ON public.messages USING (%s)',
          pair.echo_name, merged_qual
        );

      WHEN 'UPDATE' THEN
        merged_qual := format(
          '(%s) OR (%s)',
          coalesce(e.qual, 'true'),
          coalesce(l.qual, 'true')
        );
        merged_check := format(
          '(%s) OR (%s)',
          coalesce(e.with_check, e.qual, 'true'),
          coalesce(l.with_check, l.qual, 'true')
        );
        EXECUTE format(
          'ALTER POLICY %I ON public.messages USING (%s) WITH CHECK (%s)',
          pair.echo_name, merged_qual, merged_check
        );

      WHEN 'ALL' THEN
        merged_qual := format(
          '(%s) OR (%s)',
          coalesce(e.qual, 'true'),
          coalesce(l.qual, 'true')
        );
        merged_check := format(
          '(%s) OR (%s)',
          coalesce(e.with_check, e.qual, 'true'),
          coalesce(l.with_check, l.qual, 'true')
        );
        EXECUTE format(
          'ALTER POLICY %I ON public.messages USING (%s) WITH CHECK (%s)',
          pair.echo_name, merged_qual, merged_check
        );

      ELSE
        RAISE NOTICE 'skip merge "%" + "%": unsupported cmd %',
          pair.echo_name, pair.legacy_name, e.cmd;
        CONTINUE;
    END CASE;

    EXECUTE format('DROP POLICY %I ON public.messages', pair.legacy_name);
    RAISE NOTICE 'merged policy "%" into "%"', pair.legacy_name, pair.echo_name;
  END LOOP;
END
$mig$;
