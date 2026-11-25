-- ════════════════════════════════════════════════════════════════════
-- Echo: группы — базовая настройка и выход
--
-- Здесь появляются первые мутации профиля группы:
--   group_update_metadata(p_group_id, encrypted_metadata, nonce, sender_pub)
--     → owner/admin; сервер по-прежнему видит только шифротекст.
--   group_leave(p_group_id)
--     → любой участник; owner обязан сначала передать права или удалить.
--   group_transfer_owner(p_group_id, p_target)
--     → только owner; target должен быть участником.
--   group_delete(p_group_id)
--     → только owner; каскадно удаляет участников и mailbox ключей.
--
-- Дополнительно: groups.metadata_sender_pub хранит X25519-публичный ключ
-- того, кто запечатал метаданные. Это нужно, потому что метаданные можно
-- менять не только создателю: group_open_metadata восстанавливает общий
-- секрет из info_key + публичного ключа автора шифротекста. Для старых
-- строк колонка NULL — клиент использует creator_id (метаданные создавал
-- создатель).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS metadata_sender_pub TEXT;

-- 1. Обновление зашифрованных метаданных (название / описание / аватар).
CREATE OR REPLACE FUNCTION public.group_update_metadata(
  p_group_id           UUID,
  p_encrypted_metadata TEXT,
  p_metadata_nonce     TEXT,
  p_sender_pub         TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  UUID;
  _role TEXT;
BEGIN
  SELECT auth.uid() INTO _uid;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_encrypted_metadata IS NULL OR p_encrypted_metadata = ''
     OR p_metadata_nonce IS NULL OR p_metadata_nonce = '' THEN
    RAISE EXCEPTION 'encrypted_metadata and metadata_nonce must not be empty';
  END IF;

  -- Блокируем строку группы: параллельная передача владельца/выход
  -- сериализуются с проверкой роли.
  PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  SELECT gm.role INTO _role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = _uid;

  IF _role IS NULL THEN
    RAISE EXCEPTION 'Not a group member';
  END IF;
  IF _role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owner or admin can update group metadata';
  END IF;

  UPDATE public.groups
  SET encrypted_metadata  = p_encrypted_metadata,
      metadata_nonce      = p_metadata_nonce,
      metadata_sender_pub = NULLIF(p_sender_pub, '')
  WHERE id = p_group_id;

  RETURN p_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.group_update_metadata(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_update_metadata(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 2. Выход из группы. Owner без передачи прав выйти не может: иначе группа
--    останется без владельца (deferred trigger назначил бы случайного).
CREATE OR REPLACE FUNCTION public.group_leave(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  UUID;
  _role TEXT;
BEGIN
  SELECT auth.uid() INTO _uid;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  SELECT gm.role INTO _role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = _uid
  FOR UPDATE;

  IF _role IS NULL THEN
    RAISE EXCEPTION 'Not a group member';
  END IF;
  IF _role = 'owner' THEN
    RAISE EXCEPTION 'Owner must transfer ownership or delete the group';
  END IF;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = _uid;

  -- Забранный пакет ключей больше не нужен. При повторном приглашении
  -- создатель сформирует новый пакет.
  DELETE FROM public.group_key_mailbox
  WHERE group_id = p_group_id AND user_id = _uid;
END;
$$;

REVOKE ALL ON FUNCTION public.group_leave(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_leave(UUID) TO authenticated, service_role;

-- 3. Передача владельца. creator_id НЕ меняем: от него зависят пакеты
--    ключей участников (DH-конверт создателя), а не только метаданные.
CREATE OR REPLACE FUNCTION public.group_transfer_owner(
  p_group_id UUID,
  p_target   UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid          UUID;
  _my_role      TEXT;
  _target_role  TEXT;
BEGIN
  SELECT auth.uid() INTO _uid;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  SELECT gm.role INTO _my_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = _uid
  FOR UPDATE;

  IF _my_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owner can transfer ownership';
  END IF;
  IF p_target IS NULL OR p_target = _uid THEN
    RAISE EXCEPTION 'Invalid ownership target';
  END IF;

  SELECT gm.role INTO _target_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = p_target
  FOR UPDATE;

  IF _target_role IS NULL THEN
    RAISE EXCEPTION 'Target is not a group member';
  END IF;

  -- Сначала снимаем owner с себя: partial unique index (одна группа —
  -- один owner) не допускает промежуточного состояния с двумя owner.
  UPDATE public.group_members
  SET role = 'member'
  WHERE group_id = p_group_id AND user_id = _uid;

  UPDATE public.group_members
  SET role = 'owner'
  WHERE group_id = p_group_id AND user_id = p_target;
END;
$$;

REVOKE ALL ON FUNCTION public.group_transfer_owner(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_transfer_owner(UUID, UUID) TO authenticated, service_role;

-- 4. Удаление группы владельцем. Участники и mailbox уходят каскадом.
CREATE OR REPLACE FUNCTION public.group_delete(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  UUID;
  _role TEXT;
BEGIN
  SELECT auth.uid() INTO _uid;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  SELECT gm.role INTO _role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = _uid;

  IF _role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owner can delete the group';
  END IF;

  DELETE FROM public.groups WHERE id = p_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.group_delete(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_delete(UUID) TO authenticated, service_role;

-- 5. Realtime: клиент перечитывает список чатов при UPDATE groups
--    (переименование/аватар) и изменениях состава. Добавляем таблицы в
--    публикацию идемпотентно — в разных проектах она уже может их содержать.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = 'groups'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = 'group_members'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
    END IF;
  END IF;
END $$;
