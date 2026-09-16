-- ════════════════════════════════════════════════════════════════════
-- Echo: Shield Media — приватность медиа (avatars / tracks / publications / stories)
-- Запускать в Supabase SQL Editor либо через `supabase migration up`/`db push`.
--
-- Что делает:
--   1. Делает пользовательские bucket'ы ПРИВАТНЫМИ (public = false).
--      Теперь `getPublicUrl` не отдаёт ничего анонимам, а прямые ссылки/
--      hotlink в браузере больше не работают (раньше любой открывал и скачивал).
--   2. RLS на storage.objects:
--        - SELECT — любой аутентифицированный пользователь может читать
--          аватарку/трек/публикацию/историю (профили видят друг друга),
--          но ТОЛЬКО авторизованно (через signed-URL), не анонимно;
--        - INSERT/UPDATE/DELETE — только владелец (первый сегмент пути = его UUID).
--   Сами файлы дополнительно зашифрованы клиентом (AES-256-GCM, ключ в Rust),
--   поэтому даже при утечке блоба расшифровать его можно только в приложении.
-- ════════════════════════════════════════════════════════════════════

-- 1. Приватные bucket'ы
UPDATE storage.buckets
SET public = false, updated_at = now()
WHERE id IN ('avatars', 'tracks', 'publications', 'stories');

-- 2. RLS: чтение только для аутентифицированных (не анонимов)

CREATE POLICY "Authenticated read avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated read tracks"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tracks' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated read publications"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'publications' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated read stories"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'stories' AND auth.role() = 'authenticated');

-- 3. RLS: запись/изменение/удаление — только владелец (path = <uuid>/...)

CREATE POLICY "Owner upload avatars"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner update avatars"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner delete avatars"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner upload tracks"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tracks' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner update tracks"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'tracks' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner delete tracks"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'tracks' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner upload publications"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'publications' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner update publications"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'publications' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner delete publications"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'publications' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner upload stories"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'stories' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner update stories"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'stories' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner delete stories"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'stories' AND auth.uid()::text = storage.foldername(name)[1]);