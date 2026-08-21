-- ============================================================================
-- V002__split_auth_progress
-- Разделяем auth_progress на две семантически разные таблицы:
--   * secure_store  — чувствительное (seed, токены, OTP, auth progress JSON)
--   * app_settings   — публичное внутри зашифрованной БД (активная тема, обои)
-- Данные переносятся из legacy auth_progress. Таблица auth_progress остаётся
-- для обратной совместимости (DEPRECATED) и больше не пишется новым кодом.
-- ============================================================================

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

-- Перенос чувствительного: всё, кроме active_theme_id → secure_store.
INSERT OR IGNORE INTO secure_store (key, value, updated_at)
    SELECT key, value, updated_at FROM auth_progress WHERE key != 'active_theme_id';

-- Перенос публичного: активная тема → app_settings.
INSERT OR IGNORE INTO app_settings (key, value, updated_at)
    SELECT key, value, updated_at FROM auth_progress WHERE key = 'active_theme_id';
