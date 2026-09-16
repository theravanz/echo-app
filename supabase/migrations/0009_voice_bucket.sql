-- ════════════════════════════════════════════════════════════════════
-- Echo: Voice Messages — приватный bucket для голосовых сообщений
--
-- Голосовые шифруются E2EE (crypto_box на публичный ключ получателя),
-- шифротекст кладётся в этот ПРИВАТНЫЙ bucket:
--   path = <sender_uuid>/voice-<ts>.enc
-- Чтение — только аутентифицированные (signed-URL), запись/удаление —
-- только владелец (первый сегмент пути = его UUID).
-- ════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('voice', 'voice', false)
ON CONFLICT (id) DO UPDATE SET public = false, updated_at = now();

CREATE POLICY "Authenticated read voice"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'voice' AND auth.role() = 'authenticated');

CREATE POLICY "Owner upload voice"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'voice' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner update voice"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'voice' AND auth.uid()::text = storage.foldername(name)[1]);

CREATE POLICY "Owner delete voice"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'voice' AND auth.uid()::text = storage.foldername(name)[1]);