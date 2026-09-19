-- ============================================================================
-- V003__repair_legacy_versioning
-- Чинит базы, пострадавшие от бага парсинга версии миграций:
-- trim_matches('0') срезал нули с обеих сторон имени ("001__initial_schema"
-- -> "1__initial_schema"), parse() падал -> unwrap_or(0) -> V001 записалась
-- в историю как version=0, а V002+ скипались (EXISTS(0) находил её запись).
-- Следствия: нет secure_store/app_settings -> кэш чатов и auth-прогресс мертвы.
-- ============================================================================
-- 1. Убить испорченные записи истории (version=0).
DELETE FROM refinery_schema_history WHERE version = 0;

-- 2. Страховочные guards: если V002 по какой-то причине не доехал,
--    создать таблицы и перенести данные из auth_progress.
CREATE TABLE IF NOT EXISTS secure_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

INSERT OR IGNORE INTO secure_store (key, value, updated_at)
    SELECT key, value, updated_at FROM auth_progress WHERE key != 'active_theme_id';

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
    SELECT key, value, updated_at FROM auth_progress WHERE key = 'active_theme_id';
