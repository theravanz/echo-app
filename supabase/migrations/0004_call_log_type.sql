-- ════════════════════════════════════════════════════════════════════
-- Echo: Добавляем call_log в CHECK-constraint таблицы messages
-- ════════════════════════════════════════════════════════════════════
-- Логи звонков хранятся как системные сообщения с type='call_log'
-- и JSON-метаданными в content (не шифруются E2EE).

-- Удаляем старый constraint (если есть) и создаём новый с call_log
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;

ALTER TABLE public.messages ADD CONSTRAINT messages_type_check 
  CHECK (type IN ('text', 'sticker', 'gif', 'call_log'));

-- Индекс для быстрого поиска логов звонков (опционально)
CREATE INDEX IF NOT EXISTS idx_messages_call_log 
  ON public.messages ((sender_id), (receiver_id)) 
  WHERE type = 'call_log';
