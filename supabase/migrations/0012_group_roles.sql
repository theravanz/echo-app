-- ════════════════════════════════════════════════════════════════════
-- Echo: группы — роли участников (owner / admin / member)
-- Админов может быть много, owner — один (создатель).
-- Управление ролями (назначение/снятие админов, кик, выход) будет жить
-- в настройках профиля группы (фронт, отдельная панель); здесь — только
-- схема + чтение состава. Прямая запись закрыта RLS (как и раньше):
-- единственный писатель — SECURITY DEFINER RPC.
--
-- МЕСТО ПОД БУДУЩИЕ RPC (контракты зафиксированы, реализуешь позже):
--   group_set_admin(p_group_id UUID, p_target UUID, p_make_admin BOOLEAN)
--     → только owner/admin; owner снять/разжаловать нельзя.
--   group_remove_member(p_group_id UUID, p_target UUID)
--     → только owner/admin; owner кикнуть нельзя.
--   group_leave(p_group_id UUID)
--     → любой участник; owner без передачи прав выйти не может (400).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_members_role_check'
  ) THEN
    ALTER TABLE public.group_members
      ADD CONSTRAINT group_members_role_check
      CHECK (role IN ('owner', 'admin', 'member'));
  END IF;
END $$;

-- Создатели существующих групп → owner (идемпотентно).
UPDATE public.group_members gm
SET role = 'owner'
FROM public.groups g
WHERE gm.group_id = g.id
  AND gm.user_id = g.creator_id
  AND gm.role <> 'owner';

CREATE INDEX IF NOT EXISTS idx_group_members_role
  ON public.group_members (group_id, role);

-- Чтение ролей отдельной политики НЕ требует: роль — колонка
-- group_members, политика "members can read group members" (0011) её покрывает.
