-- ════════════════════════════════════════════════════════════════════
-- Echo: группы — гарантия владельца (owner)
--
-- Баг: create_group_atomic (0010) вставлял всех участников с default
-- role='member', поэтому создатель НОВОЙ группы не становился owner.
-- 0012 бэкфиллил только уже существующие группы.
--
-- Здесь:
--   1. ensure_group_owner — идемпотентно назначает owner, если его нет:
--      приоритет создателю (groups.creator_id), затем админу, иначе самому
--      раннему участнику.
--   2. Бэкфилл всех существующих групп без owner.
--   3. Нормализация групп, где owner оказался не один (оставляем одного).
--   4. Уникальный partial index: у группы ровно один owner.
--   5. create_group_atomic: создатель сразу пишется как owner.
--   6. Deferred constraint trigger: любое изменение состава/ролей, после
--      которого в группе не осталось owner, автоматически восстанавливает его.
--
-- Безопасность: функции SECURITY DEFINER с фиксированным search_path и
-- EXECUTE только у владельца БД (REVOKE FROM PUBLIC) — клиент не может
-- вызвать их через PostgREST и выдать себе owner. Прямая запись в
-- group_members по-прежнему закрыта RLS; инвариант чинит только БД.
-- ════════════════════════════════════════════════════════════════════

-- 1. Идемпотентное восстановление owner.
CREATE OR REPLACE FUNCTION public.ensure_group_owner(p_group_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner     UUID;
  _creator   UUID;
  _candidate UUID;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Сериализуем восстановление owner в рамках одной группы.
  SELECT g.creator_id INTO _creator
  FROM public.groups g
  WHERE g.id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL; -- группы уже нет (каскадное удаление)
  END IF;

  SELECT gm.user_id INTO _owner
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.role = 'owner'
  ORDER BY gm.joined_at, gm.user_id
  LIMIT 1;

  IF _owner IS NOT NULL THEN
    RETURN _owner; -- инвариант уже выполнен
  END IF;

  -- Кандидат: создатель, если он всё ещё участник; затем админ; иначе самый
  -- ранний участник. Выбор детерминирован (joined_at + user_id).
  SELECT gm.user_id INTO _candidate
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
  ORDER BY
    (gm.user_id = _creator) DESC,
    (gm.role = 'admin') DESC,
    gm.joined_at,
    gm.user_id
  LIMIT 1;

  IF _candidate IS NULL THEN
    RETURN NULL; -- в группе нет участников — назначать некого
  END IF;

  BEGIN
    UPDATE public.group_members
    SET role = 'owner'
    WHERE group_id = p_group_id
      AND user_id = _candidate
      AND role <> 'owner';
  EXCEPTION
    WHEN unique_violation THEN
      -- Параллельная транзакция уже назначила owner — не перетираем.
      NULL;
  END;

  RETURN _candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_group_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_group_owner(UUID) FROM anon, authenticated;

-- 2. Бэкфилл: в каждой группе с участниками, но без owner, назначаем owner.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT g.id
    FROM public.groups g
    WHERE EXISTS (
      SELECT 1 FROM public.group_members gm WHERE gm.group_id = g.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = g.id AND gm.role = 'owner'
    )
  LOOP
    PERFORM public.ensure_group_owner(r.id);
  END LOOP;
END $$;

-- 3. Нормализация: если owner оказался не один, оставляем создателя
--    (или самого раннего участника), остальным понижаем роль до member.
WITH ranked AS (
  SELECT
    gm.group_id,
    gm.user_id,
    ROW_NUMBER() OVER (
      PARTITION BY gm.group_id
      ORDER BY (gm.user_id = g.creator_id) DESC, gm.joined_at, gm.user_id
    ) AS rn
  FROM public.group_members gm
  JOIN public.groups g ON g.id = gm.group_id
  WHERE gm.role = 'owner'
)
UPDATE public.group_members gm
SET role = 'member'
FROM ranked r
WHERE gm.group_id = r.group_id
  AND gm.user_id = r.user_id
  AND r.rn > 1;

-- 4. Инвариант на уровне схемы: у группы не может быть двух owner.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_group_members_owner
  ON public.group_members (group_id)
  WHERE role = 'owner';

-- 5. Причина бага: создатель новой группы должен сразу стать owner.
--    Тело функции — как в 0010, меняется только INSERT участников.
CREATE OR REPLACE FUNCTION public.create_group_atomic(
  p_group_id           UUID,
  p_encrypted_metadata TEXT,
  p_metadata_nonce     TEXT,
  p_is_ultra_private   BOOLEAN,
  p_member_ids         UUID[],
  p_key_user_ids       UUID[],
  p_key_payloads       TEXT[],
  p_key_nonces         TEXT[]
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _creator    UUID;
  _member_cnt INT;
  _key_cnt    INT;
  _limit      INT;
BEGIN
  SELECT auth.uid() INTO _creator;
  IF _creator IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_is_ultra_private THEN
    RAISE EXCEPTION 'Ultra-private groups not yet supported';
  END IF;
  _limit := 5000;

  _member_cnt := COALESCE(array_length(p_member_ids, 1), 0);
  IF _member_cnt = 0 THEN
    RAISE EXCEPTION 'members must not be empty';
  END IF;
  IF NOT (_creator = ANY (p_member_ids)) THEN
    RAISE EXCEPTION 'creator must be included in members';
  END IF;
  IF _member_cnt > _limit THEN
    RAISE EXCEPTION 'Group member limit exceeded: % > %', _member_cnt, _limit;
  END IF;

  _key_cnt := COALESCE(array_length(p_key_user_ids, 1), 0);
  IF _key_cnt != COALESCE(array_length(p_key_payloads, 1), 0)
     OR _key_cnt != COALESCE(array_length(p_key_nonces, 1), 0) THEN
    RAISE EXCEPTION 'encrypted_keys arrays length mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_key_user_ids) AS k(uid)
    WHERE k.uid NOT IN (SELECT unnest(p_member_ids))
  ) THEN
    RAISE EXCEPTION 'key recipient is not a group member';
  END IF;
  IF _creator = ANY (p_key_user_ids) THEN
    RAISE EXCEPTION 'key packet for creator is not allowed';
  END IF;

  IF p_encrypted_metadata IS NULL OR p_encrypted_metadata = ''
     OR p_metadata_nonce IS NULL OR p_metadata_nonce = '' THEN
    RAISE EXCEPTION 'encrypted_metadata and metadata_nonce must not be empty';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_key_payloads) AS p(payload)
    WHERE p.payload IS NULL OR p.payload = ''
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_key_nonces) AS n(nonce)
    WHERE n.nonce IS NULL OR n.nonce = ''
  ) THEN
    RAISE EXCEPTION 'encrypted key packets must not be empty';
  END IF;

  INSERT INTO public.groups (id, creator_id, encrypted_metadata, metadata_nonce, is_ultra_private)
  VALUES (p_group_id, _creator, p_encrypted_metadata, p_metadata_nonce, p_is_ultra_private);

  -- Создатель — owner, остальные — member. Без этого группа рождалась
  -- «безвладельной», и UI не показывал создателю права владельца.
  INSERT INTO public.group_members (group_id, user_id, role)
  SELECT p_group_id, m.uid,
         CASE WHEN m.uid = _creator THEN 'owner' ELSE 'member' END
  FROM unnest(p_member_ids) AS m(uid);

  IF _key_cnt > 0 THEN
    INSERT INTO public.group_key_mailbox (group_id, user_id, encrypted_payload, nonce)
    SELECT p_group_id, k.uid, k.payload, k.nonce
    FROM unnest(p_key_user_ids, p_key_payloads, p_key_nonces) AS k(uid, payload, nonce);
  END IF;

  RETURN p_group_id;
END;
$$;

-- 6. Автоматическое восстановление owner при любом изменении состава/ролей.
--    DEFERRABLE INITIALLY DEFERRED: проверка идёт в конце транзакции, поэтому
--    промежуточные состояния (передача владельца, кик, выход) не мешают.
CREATE OR REPLACE FUNCTION public.group_members_ensure_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _group_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _group_id := OLD.group_id;
  ELSE
    _group_id := NEW.group_id;
  END IF;

  PERFORM public.ensure_group_owner(_group_id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.group_members_ensure_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.group_members_ensure_owner() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_group_members_ensure_owner ON public.group_members;
CREATE CONSTRAINT TRIGGER trg_group_members_ensure_owner
  AFTER INSERT OR UPDATE OR DELETE ON public.group_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.group_members_ensure_owner();
