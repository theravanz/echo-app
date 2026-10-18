-- ════════════════════════════════════════════════════════════════════
-- Echo: группы — чтение состава участников (счётчик «N участников · M онлайн»)
-- Прямая политика «член группы видит всех участников» самоопрашивала бы
-- group_members → рекурсия RLS → 500. Обходим через SECURITY DEFINER-функцию:
-- внутренний EXISTS выполняется от владельца (вне RLS), рекурсии нет.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_group_member(gid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = gid AND user_id = auth.uid()
  );
$$;

-- Одна SELECT-политика на group_members: свои записи + все участники своих групп.
DROP POLICY IF EXISTS "members can read own memberships" ON public.group_members;
DROP POLICY IF EXISTS "members can read group members" ON public.group_members;
CREATE POLICY "members can read group members"
  ON public.group_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_group_member(group_id)
  );
