-- ════════════════════════════════════════════════════════════════════
-- Echo: Zero-Knowledge группы (обычные группы, is_ultra_private = false)
-- Сервер — «слепой» ретранслятор: Name/Bio и групповые сиды хранятся
-- ТОЛЬКО в шифротексте (криптография — на клиенте). Единственный писатель —
-- RPC create_group_atomic (SECURITY DEFINER); прямые INSERT/UPDATE/DELETE
-- для anon/authenticated закрыты RLS.
-- ════════════════════════════════════════════════════════════════════

-- 1. Группы: только зашифрованные метаданные (base64 Name/Bio + nonce).
CREATE TABLE IF NOT EXISTS public.groups (
  id                 UUID PRIMARY KEY,
  creator_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_metadata TEXT NOT NULL,
  metadata_nonce     TEXT NOT NULL,
  is_ultra_private   BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_groups_creator
  ON public.groups (creator_id);

-- 2. Участники: составной PK + индексы в обе стороны.
CREATE TABLE IF NOT EXISTS public.group_members (
  group_id  UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user
  ON public.group_members (user_id);

CREATE INDEX IF NOT EXISTS idx_group_members_group
  ON public.group_members (group_id);

-- 3. Почтовый ящик ключей: для каждого участника — пакет с групповым сидом,
--    зашифрованным через X25519 от инвайтера. Создателю пакет не нужен
--    (сид сгенерирован на его устройстве).
CREATE TABLE IF NOT EXISTS public.group_key_mailbox (
  group_id          UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  nonce             TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_key_mailbox_user

-- 4. Атомарное создание группы: группа → участники → пакеты ключей.
--    Одна транзакция: либо всё, либо ничего (частичных групп не бывает).
--    SECURITY DEFINER: обходит RLS (прямая запись закрыта), но все проверки
--    авторства/лимитов — ВНУТРИ функции (защита в глубину: Edge Function
--    тоже валидирует JWT и лимит до вызова RPC).
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
  -- Авторство: только авторизованный создатель (auth.uid из JWT вызова).
  SELECT auth.uid() INTO _creator;
  IF _creator IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Лимит обычной группы — 5000 (is_ultra_private=false).
  IF p_is_ultra_private THEN
    RAISE EXCEPTION 'Ultra-private groups not yet supported';
  END IF;
  _limit := 5000;

  _member_cnt := COALESCE(array_length(p_member_ids, 1), 0);
  IF _member_cnt = 0 THEN
    RAISE EXCEPTION 'members must not be empty';
  END IF;
  -- Creator обязан входить в members (инвариант: создатель — участник).
  IF NOT (_creator = ANY (p_member_ids)) THEN
    RAISE EXCEPTION 'creator must be included in members';
  END IF;
  IF _member_cnt > _limit THEN
    RAISE EXCEPTION 'Group member limit exceeded: % > %', _member_cnt, _limit;
  END IF;

  -- Пакеты ключей: массивы одной длины (параллельные массивы).
  _key_cnt := COALESCE(array_length(p_key_user_ids, 1), 0);
  IF _key_cnt != COALESCE(array_length(p_key_payloads, 1), 0)
     OR _key_cnt != COALESCE(array_length(p_key_nonces, 1), 0) THEN
    RAISE EXCEPTION 'encrypted_keys arrays length mismatch';
  END IF;

  -- Каждый получатель пакета обязан быть участником (иначе сид уйдёт
  -- постороннему). Пакет создателю запрещён (у него сид уже есть).
  IF EXISTS (
    SELECT 1 FROM unnest(p_key_user_ids) AS k(uid)
    WHERE k.uid NOT IN (SELECT unnest(p_member_ids))
  ) THEN
    RAISE EXCEPTION 'key recipient is not a group member';
  END IF;
  IF _creator = ANY (p_key_user_ids) THEN
    RAISE EXCEPTION 'key packet for creator is not allowed';
  END IF;

  -- Пустые шифротексты/нонсы — мимо (сервер не расшифровывает, но пустые
  -- строки отвергаем как повреждённые пакеты).
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

  -- ── Атомарная запись (implicit transaction функции) ──
  INSERT INTO public.groups (id, creator_id, encrypted_metadata, metadata_nonce, is_ultra_private)
  VALUES (p_group_id, _creator, p_encrypted_metadata, p_metadata_nonce, p_is_ultra_private);

  INSERT INTO public.group_members (group_id, user_id)
  SELECT p_group_id, m.uid
  FROM unnest(p_member_ids) AS m(uid);

  IF _key_cnt > 0 THEN
    INSERT INTO public.group_key_mailbox (group_id, user_id, encrypted_payload, nonce)
    SELECT p_group_id, k.uid, k.payload, k.nonce
    FROM unnest(p_key_user_ids, p_key_payloads, p_key_nonces) AS k(uid, payload, nonce);
  END IF;

  RETURN p_group_id;
END;
$$;

  ON public.group_key_mailbox (user_id);

-- 5. RLS: закрыть всё для anon/authenticated, прямой записи нет.
--    Единственный писатель — RPC create_group_atomic (SECURITY DEFINER).
--    Чтение: только участники своих групп (метаданные всё равно шифротекст).
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_key_mailbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can read own groups" ON public.groups;
CREATE POLICY "members can read own groups"
  ON public.groups FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members m
      WHERE m.group_id = groups.id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "no direct insert groups" ON public.groups;
CREATE POLICY "no direct insert groups"
  ON public.groups FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "no direct update groups" ON public.groups;
CREATE POLICY "no direct update groups"
  ON public.groups FOR UPDATE
  TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS "no direct delete groups" ON public.groups;
CREATE POLICY "no direct delete groups"
  ON public.groups FOR DELETE
  TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS "members can read own memberships" ON public.group_members;
CREATE POLICY "members can read own memberships"
  ON public.group_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.group_members m
      WHERE m.group_id = group_members.group_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "no direct insert group_members" ON public.group_members;
CREATE POLICY "no direct insert group_members"
  ON public.group_members FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "no direct update group_members" ON public.group_members;
CREATE POLICY "no direct update group_members"
  ON public.group_members FOR UPDATE
  TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS "no direct delete group_members" ON public.group_members;
CREATE POLICY "no direct delete group_members"
  ON public.group_members FOR DELETE
  TO anon, authenticated
  USING (false);

-- Mailbox: каждый забирает ТОЛЬКО свои пакеты (user_id = auth.uid()).
-- Удаление своих пакетов разрешено (забрал ключ — почистил ящик).
DROP POLICY IF EXISTS "users can read own key packets" ON public.group_key_mailbox;
CREATE POLICY "users can read own key packets"
  ON public.group_key_mailbox FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "no direct insert group_key_mailbox" ON public.group_key_mailbox;
CREATE POLICY "no direct insert group_key_mailbox"
  ON public.group_key_mailbox FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "no direct update group_key_mailbox" ON public.group_key_mailbox;
CREATE POLICY "no direct update group_key_mailbox"
  ON public.group_key_mailbox FOR UPDATE
  TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS "users can delete own key packets" ON public.group_key_mailbox;
CREATE POLICY "users can delete own key packets"
  ON public.group_key_mailbox FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

