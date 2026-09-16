-- ════════════════════════════════════════════════════════════════════
-- Echo: Shield Media — колонки метаданных шифрования
--
-- Медиа теперь хранится ЗАШИФРОВАННЫМ конвертом в приватном bucket'е.
-- В БД пишем:
--   * storage_path — путь в bucket'е (зашифрованный блоб);
--   * nonce        — base64 nonce AES-256-GCM (нужен для расшифровки);
--   * mime         — исходный тип медиа (стал image/webp после сжатия).
-- Публичные URL больше НЕ генерируются и не хранятся для новых файлов;
-- `*_url`-колонки оставляем как fallback для отображения старых медиа.
-- ════════════════════════════════════════════════════════════════════

-- Профиль: аватар
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS avatar_nonce        TEXT,
  ADD COLUMN IF NOT EXISTS avatar_mime         TEXT DEFAULT 'image/webp',
  -- «Сейчас играет»: зашифрованная обложка activity (если трек новый)
  ADD COLUMN IF NOT EXISTS activity_cover_path  TEXT,
  ADD COLUMN IF NOT EXISTS activity_cover_nonce TEXT;

-- Пользовательские треки: аудио + обложка
ALTER TABLE public.user_tracks
  ADD COLUMN IF NOT EXISTS audio_nonce TEXT,
  ADD COLUMN IF NOT EXISTS cover_nonce TEXT;

-- Публикации: медиа + миниатюра
ALTER TABLE public.publications
  ADD COLUMN IF NOT EXISTS media_nonce     TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_nonce TEXT,
  ADD COLUMN IF NOT EXISTS media_mime      TEXT;

-- Истории
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS media_nonce TEXT,
  ADD COLUMN IF NOT EXISTS media_mime  TEXT;