-- ============================================================================
-- V001__initial_schema
-- Начальная схема echo-tauri (перенесена из runtime CREATE в StorageManager::new()).
-- Запускается ровно один раз до инициализации Vault (boot-до-логина).
-- Таблица версий: refinery_schema_history.
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT DEFAULT '',
    device_hwid TEXT DEFAULT '',
    device_name TEXT DEFAULT '',
    ip_address TEXT DEFAULT '',
    last_active INTEGER DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device_hwid ON sessions(device_hwid);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    hwid TEXT NOT NULL,
    device_name TEXT DEFAULT 'Unknown Device',
    platform TEXT DEFAULT '',
    device_type TEXT DEFAULT 'desktop',
    os_name TEXT DEFAULT '',
    browser_name TEXT DEFAULT '',
    ip_address TEXT DEFAULT '',
    location TEXT DEFAULT '',
    timezone TEXT DEFAULT '',
    is_vpn INTEGER DEFAULT 0,
    last_active INTEGER DEFAULT (strftime('%s', 'now')),
    is_current INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_hwid ON devices(hwid);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    text_content TEXT NOT NULL DEFAULT '',
    encrypted_content TEXT DEFAULT '',
    message_type TEXT DEFAULT 'text',
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    status TEXT DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

-- DEPRECATED: заменена на secure_store (чувствительное) + app_settings (темы/обои).
-- Оставлена для обратной совместимости; новые команды пишут в новые таблицы (V002).
CREATE TABLE IF NOT EXISTS auth_progress (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    author TEXT DEFAULT 'Echo',
    description TEXT DEFAULT '',
    is_builtin INTEGER DEFAULT 0,
    css_variables TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS chat_wallpapers (
    chat_id TEXT PRIMARY KEY,
    wallpaper_type TEXT NOT NULL DEFAULT 'solid',
    wallpaper_value TEXT NOT NULL DEFAULT '',
    blur REAL DEFAULT 0.0,
    opacity REAL DEFAULT 1.0,
    brightness REAL DEFAULT 1.0,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Phase 0 (device-bound): E2EE-priv seed, зашифрованный device-ключом
-- (Argon2id от HWID). value = JSON { salt, nonce, ct }. Никогда не plaintext.
CREATE TABLE IF NOT EXISTS e2ee_keys (
    user_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
