//! Нативное SQLite-хранилище на базе rusqlite.
//!
//! Архитектура:
//! - Одно соединение rusqlite внутри StorageManager (Mutex<Connection>)
//! - Таблицы создаются один раз в new() при старте приложения
//! - Все 9 команд работают через State<'_, StorageManager>
//! - Токены и мнемоника шифруются через vault.rs (AES-256-GCM) перед записью
//! - Внешние ключи ВКЛЮЧЕНЫ (PRAGMA foreign_keys = ON) — referential integrity

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::vault::Vault;

// ═══════════════════════════════════════════════════════════════════
// DTO (Data Transfer Objects) — интерфейсы с фронтендом
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub device_hwid: String,
    pub device_name: String,
    pub ip_address: String,
    pub last_active: i64,
    pub expires_at: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub user_id: String,
    pub hwid: String,
    pub device_name: String,
    pub platform: String,
    pub device_type: String,
    pub os_name: String,
    pub browser_name: String,
    pub ip_address: String,
    pub location: String,
    pub timezone: String,
    pub is_vpn: bool,
    pub is_current: bool,
    pub last_active: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub public_key: String,
    pub display_name: String,
    pub avatar_url: String,
    pub created_at: i64,
    pub updated_at: i64,
}

// ═══════════════════════════════════════════════════════════════════
// StorageManager — единственный владелец соединения с БД
// ═══════════════════════════════════════════════════════════════════

pub struct StorageManager {
    pub(crate) conn: Mutex<Connection>,
}

impl StorageManager {
    pub fn new(app: &AppHandle<tauri::Wry>) -> Self {
        eprintln!("[Storage] STARTING INIT");
        
        let app_dir = app
            .path()
            .app_local_data_dir()
            .or_else(|_| app.path().app_data_dir())
            .unwrap_or_else(|_| {
                eprintln!("[Storage] NO APP DIR, using fallback");
                std::path::PathBuf::from("/data/user/0/com.theravanz.echo_tauri")
            });
        
        eprintln!("[Storage] app_dir: {:?}", app_dir);
        
        if let Err(e) = std::fs::create_dir_all(&app_dir) {
            eprintln!("[Storage] CREATE DIR FAILED: {}", e);
        }
        
        let db_path = app_dir.join("echo.db");
        eprintln!("[Storage] DB path: {:?}", db_path);

        let conn = match Connection::open(&db_path) {
            Ok(c) => {
                eprintln!("[Storage] DB OPENED OK");
                c
            }
            Err(e) => {
                eprintln!("[Storage] DB OPEN FAILED: {}", e);
                panic!("Cannot open database");
            }
        };

        // Оптимизация SQLite с включёнными внешними ключами
        if let Err(e) = conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;"
        ) {
            log::error!("[Storage] PRAGMA failed: {}", e);
        }

        // Всеядная схема БЕЗ внешних ключей
        if let Err(e) = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS accounts (
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
            );"
        ) {
            log::error!("[Storage] Schema creation failed: {}", e);
            panic!("[Storage] Schema failed");
        }

// ── Phase 0: миграция accounts — удаляем колонку encrypted_seed (если есть) ──
        // Вектор приватного ключа больше не хранится в БД: seed живёт только в Rust KeyStore.
        {
            let mut has_encrypted_seed = false;
            if let Ok(mut stmt) = conn.prepare("SELECT name FROM pragma_table_info('accounts')") {
                if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                    has_encrypted_seed = rows.filter_map(|r| r.ok()).any(|c| c == "encrypted_seed");
                }
            }
            if has_encrypted_seed {
                log::info!("[Storage] Migrating: dropping accounts.encrypted_seed (private key is now Rust-only)");
                if let Err(e) = conn.execute("ALTER TABLE accounts DROP COLUMN encrypted_seed", []) {
                    log::error!("[Storage] drop encrypted_seed: {}", e);
                }
            }
        }
// ── Миграция существующей таблицы devices: добавляем новые колонки ──
        // CREATE TABLE IF NOT EXISTS не тронет уже созданную таблицу, поэтому
        // проверяем PRAGMA table_info и добавляем недостающие колонки вручную.
        {
            let mut existing: Vec<String> = Vec::new();
            if let Ok(mut stmt) = conn.prepare("SELECT name FROM pragma_table_info('devices')") {
                if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                    existing = rows.filter_map(|r| r.ok()).collect();
                }
            }
            let has = |col: &str| existing.iter().any(|c| c == col);

            if !has("os_name") {
                if let Err(e) = conn.execute("ALTER TABLE devices ADD COLUMN os_name TEXT DEFAULT ''", []) {
                    log::error!("[Storage] add os_name: {}", e);
                }
            }
            if !has("device_type") {
                if let Err(e) = conn.execute("ALTER TABLE devices ADD COLUMN device_type TEXT DEFAULT 'desktop'", []) {
                    log::error!("[Storage] add device_type: {}", e);
                }
            }
            if !has("browser_name") {
                if let Err(e) = conn.execute("ALTER TABLE devices ADD COLUMN browser_name TEXT DEFAULT ''", []) {
                    log::error!("[Storage] add browser_name: {}", e);
                }
            }
            if !has("ip_address") {
                if let Err(e) = conn.execute("ALTER TABLE devices ADD COLUMN ip_address TEXT DEFAULT ''", []) {
                    log::error!("[Storage] add ip_address: {}", e);
                }
            }
            if !has("location") {
                if let Err(e) = conn.execute("ALTER TABLE devices ADD COLUMN location TEXT DEFAULT ''", []) {
                    log::error!("[Storage] add location: {}", e);
                }
            }
            if !has("timezone") {
                if let Err(e) = conn.execute("ALTER TABLE devices ADD COLUMN timezone TEXT DEFAULT ''", []) {
                    log::error!("[Storage] add timezone: {}", e);
                }
            }
            if !has("is_vpn") {
                if let Err(e) = conn.execute("ALTER TABLE devices ADD COLUMN is_vpn INTEGER DEFAULT 0", []) {
                    log::error!("[Storage] add is_vpn: {}", e);
                }
            }
        }

        eprintln!("[Storage] INIT COMPLETE");
        eprintln!("[Storage] INIT COMPLETE");
        Self {
            conn: Mutex::new(conn),
        }
    }

    // ── Phase 0: device-bound E2EE-ключ (только Rust, payload — зашифрованный seed) ──

    /// Сохранить зашифрованный device-ключом E2EE-seed (payload = JSON, НЕ plaintext).
    pub(crate) fn e2ee_key_store(&self, user_id: &str, payload: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO e2ee_keys (user_id, payload, created_at)
             VALUES (?1, ?2, strftime('%s','now'))",
            params![user_id, payload],
        )
        .map_err(|e| format!("[Storage] e2ee_key_store: {e}"))?;
        Ok(())
    }

    /// Прочитать зашифрованный E2EE-seed для user_id (или None, если нет записи).
    pub(crate) fn e2ee_key_load(&self, user_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT payload FROM e2ee_keys WHERE user_id = ?1 LIMIT 1")
            .map_err(|e| format!("[Storage] e2ee_key_load prepare: {e}"))?;
        let payload = stmt
            .query_row(params![user_id], |row| row.get::<_, String>(0))
            .ok();
        Ok(payload)
    }

    /// Удалить запись E2EE-ключа (logout/purge).
    pub(crate) fn e2ee_key_clear(&self, user_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM e2ee_keys WHERE user_id = ?1", params![user_id])
            .map_err(|e| format!("[Storage] e2ee_key_clear: {e}"))?;
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════
// Helpers для шифрования через vault
// ══════════════════════════════════════════════════════════════════

fn encrypt_field(vault: &Vault, plaintext: &str) -> Result<String, String> {
    if !vault.is_ready() {
        return Err("[Storage] Vault not ready".to_string());
    }
    vault.encrypt_to_json(plaintext)
}

fn decrypt_field_safe(vault: &Vault, encrypted_json: &str) -> Result<String, rusqlite::Error> {
    if !vault.is_ready() {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::new(std::io::ErrorKind::Other, "Vault not ready")
        )));
    }
    if encrypted_json.is_empty() {
        return Ok(String::new());
    }
    vault.decrypt_from_json(encrypted_json).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::new(std::io::ErrorKind::Other, e)
        ))
    })
}

// ═══════════════════════════════════════════════════════════════════
// SESSIONS (4 команды)
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn save_session(
    manager: State<'_, StorageManager>,
    vault: State<'_, Vault>,
    id: String,
    user_id: String,
    access_token: String,
    refresh_token: Option<String>,
    device_hwid: Option<String>,
    device_name: Option<String>,
    ip_address: Option<String>,
    expires_at: i64,
) -> Result<(), String> {
    eprintln!("[Storage] save_session CALLED for user: {}", user_id);
    
    let encrypted_access = encrypt_field(&vault, &access_token)?;
    let encrypted_refresh = encrypt_field(&vault, refresh_token.as_deref().unwrap_or(""))?;

    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let result = conn.execute(
        "INSERT OR REPLACE INTO sessions
         (id, user_id, access_token, refresh_token, device_hwid, device_name,
          ip_address, last_active, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%s','now'), ?8, strftime('%s','now'))",
        params![
            id,
            user_id,
            encrypted_access,
            encrypted_refresh,
            device_hwid.unwrap_or_default(),
            device_name.unwrap_or_default(),
            ip_address.unwrap_or_default(),
            expires_at
        ],
    );

    match result {
        Ok(rows) => {
            eprintln!("[Storage] save_session SUCCESS, rows affected: {}", rows);
            Ok(())
        }
        Err(e) => {
            eprintln!("[Storage] save_session FAILED: {}", e);
            Err(format!("[Storage] save_session: {}", e))
        }
    }
}

#[tauri::command]
pub async fn get_session(
    manager: State<'_, StorageManager>,
    vault: State<'_, Vault>,
    user_id: String,
) -> Result<Option<Session>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, access_token, refresh_token, device_hwid, device_name,
                    ip_address, last_active, expires_at, created_at
             FROM sessions
             WHERE user_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .map_err(|e| format!("[Storage] get_session prepare: {}", e))?;

    let session = stmt
        .query_row(params![user_id], |row| {
            let encrypted_access: String = row.get(2)?;
            let encrypted_refresh: String = row.get(3)?;

            let access_token = decrypt_field_safe(&vault, &encrypted_access)?;
            let refresh_token = decrypt_field_safe(&vault, &encrypted_refresh)?;

            Ok(Session {
                id: row.get(0)?,
                user_id: row.get(1)?,
                access_token,
                refresh_token,
                device_hwid: row.get(4)?,
                device_name: row.get(5)?,
                ip_address: row.get(6)?,
                last_active: row.get(7)?,
                expires_at: row.get(8)?,
                created_at: row.get(9)?,
            })
        })
        .ok();

    Ok(session)
}

#[tauri::command]
pub async fn delete_session(
    manager: State<'_, StorageManager>,
    id: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
        .map_err(|e| format!("[Storage] delete_session: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_all_sessions(
    manager: State<'_, StorageManager>,
    vault: State<'_, Vault>,
    user_id: String,
) -> Result<Vec<Session>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, access_token, refresh_token, device_hwid, device_name,
                    ip_address, last_active, expires_at, created_at
             FROM sessions
             WHERE user_id = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|e| format!("[Storage] get_all_sessions prepare: {}", e))?;

    let sessions: Vec<Session> = stmt
        .query_map(params![user_id], |row| {
            let encrypted_access: String = row.get(2)?;
            let encrypted_refresh: String = row.get(3)?;

            let access_token = decrypt_field_safe(&vault, &encrypted_access)?;
            let refresh_token = decrypt_field_safe(&vault, &encrypted_refresh)?;

            Ok(Session {
                id: row.get(0)?,
                user_id: row.get(1)?,
                access_token,
                refresh_token,
                device_hwid: row.get(4)?,
                device_name: row.get(5)?,
                ip_address: row.get(6)?,
                last_active: row.get(7)?,
                expires_at: row.get(8)?,
                created_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("[Storage] get_all_sessions query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

#[tauri::command]
pub async fn get_latest_session(
    manager: State<'_, StorageManager>,
    vault: State<'_, Vault>,
) -> Result<Option<Session>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, access_token, refresh_token, device_hwid, device_name,
                    ip_address, last_active, expires_at, created_at
             FROM sessions
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .map_err(|e| format!("[Storage] get_latest_session prepare: {}", e))?;

    let session = stmt
        .query_row([], |row| {
            let encrypted_access: String = row.get(2)?;
            let encrypted_refresh: String = row.get(3)?;

            let access_token = decrypt_field_safe(&vault, &encrypted_access)?;
            let refresh_token = decrypt_field_safe(&vault, &encrypted_refresh)?;

            Ok(Session {
                id: row.get(0)?,
                user_id: row.get(1)?,
                access_token,
                refresh_token,
                device_hwid: row.get(4)?,
                device_name: row.get(5)?,
                ip_address: row.get(6)?,
                last_active: row.get(7)?,
                expires_at: row.get(8)?,
                created_at: row.get(9)?,
            })
        })
        .ok();

    Ok(session)
}

// ═══════════════════════════════════════════════════════════════════
// DEVICES (3 команды)
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn save_device(
    manager: State<'_, StorageManager>,
    id: String,
    user_id: String,
    hwid: String,
    device_name: Option<String>,
    platform: Option<String>,
    device_type: Option<String>,
    os_name: Option<String>,
    browser_name: Option<String>,
    ip_address: Option<String>,
    location: Option<String>,
    timezone: Option<String>,
    is_vpn: Option<bool>,
    is_current: Option<bool>,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO devices
         (id, user_id, hwid, device_name, platform, device_type, os_name, browser_name,
          ip_address, location, timezone, is_vpn, last_active, is_current, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, strftime('%s','now'), ?13, strftime('%s','now'))",
        params![
            id,
            user_id,
            hwid,
            device_name.unwrap_or_else(|| "Unknown Device".into()),
            platform.unwrap_or_default(),
            device_type.unwrap_or_else(|| "desktop".into()),
            os_name.unwrap_or_default(),
            browser_name.unwrap_or_default(),
            ip_address.unwrap_or_default(),
            location.unwrap_or_default(),
            timezone.unwrap_or_default(),
            if is_vpn.unwrap_or(false) { 1 } else { 0 },
            if is_current.unwrap_or(false) { 1 } else { 0 }
        ],
    )
    .map_err(|e| format!("[Storage] save_device: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_devices(
    manager: State<'_, StorageManager>,
    user_id: String,
) -> Result<Vec<Device>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, hwid, device_name, platform, device_type, os_name, browser_name,
                    ip_address, location, timezone, is_vpn, is_current, last_active, created_at
             FROM devices
             WHERE user_id = ?1
             ORDER BY last_active DESC",
        )
        .map_err(|e| format!("[Storage] get_devices prepare: {}", e))?;

    let devices: Vec<Device> = stmt
        .query_map(params![user_id], |row| {
            Ok(Device {
                id: row.get(0)?,
                user_id: row.get(1)?,
                hwid: row.get(2)?,
                device_name: row.get(3)?,
                platform: row.get(4)?,
                device_type: row.get(5)?,
                os_name: row.get(6)?,
                browser_name: row.get(7)?,
                ip_address: row.get(8)?,
                location: row.get(9)?,
                timezone: row.get(10)?,
                is_vpn: row.get::<_, i32>(11)? != 0,
                is_current: row.get::<_, i32>(12)? != 0,
                last_active: row.get(13)?,
                created_at: row.get(14)?,
            })
        })
        .map_err(|e| format!("[Storage] get_devices query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(devices)
}

#[tauri::command]
pub async fn delete_device(
    manager: State<'_, StorageManager>,
    id: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM devices WHERE id = ?1", params![id])
        .map_err(|e| format!("[Storage] delete_device: {}", e))?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNTS (2 команды)
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn save_account(
    manager: State<'_, StorageManager>,
    id: String,
    public_key: String,
    display_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO accounts
         (id, public_key, display_name, avatar_url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4,
                 COALESCE((SELECT created_at FROM accounts WHERE id=?1), strftime('%s','now')),
                 strftime('%s','now'))",
        params![
            id,
            public_key,
            display_name.unwrap_or_default(),
            avatar_url.unwrap_or_default()
        ],
    )
    .map_err(|e| format!("[Storage] save_account: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_account(
    manager: State<'_, StorageManager>,
    id: String,
) -> Result<Option<Account>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, public_key, display_name, avatar_url, created_at, updated_at
             FROM accounts
             WHERE id = ?1
             LIMIT 1",
        )
        .map_err(|e| format!("[Storage] get_account prepare: {}", e))?;

    let account = stmt
        .query_row(params![id], |row| {
            Ok(Account {
                id: row.get(0)?,
                public_key: row.get(1)?,
                display_name: row.get(2)?,
                avatar_url: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .ok();

    Ok(account)
}
// ═══════════════════════════════════════════════════════════════════
// THEMES & WALLPAPERS — DTO
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub is_builtin: bool,
    pub css_variables: String,
    pub metadata_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatWallpaper {
    pub chat_id: String,
    pub wallpaper_type: String,
    pub wallpaper_value: String,
    pub blur: f64,
    pub opacity: f64,
    pub brightness: f64,
    pub updated_at: i64,
}

// ═══════════════════════════════════════════════════════════════════
// THEMES (7 команд)
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn save_theme(
    manager: State<'_, StorageManager>,
    id: String,
    name: String,
    author: String,
    description: String,
    is_builtin: bool,
    css_variables: String,
    metadata_json: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO themes
         (id, name, author, description, is_builtin, css_variables, metadata_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                 COALESCE((SELECT created_at FROM themes WHERE id=?1), strftime('%s','now')),
                 strftime('%s','now'))",
        params![id, name, author, description, if is_builtin { 1 } else { 0 }, css_variables, metadata_json],
    )
    .map_err(|e| format!("[Storage] save_theme: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_theme(
    manager: State<'_, StorageManager>,
    id: String,
) -> Result<Option<Theme>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, author, description, is_builtin, css_variables, metadata_json, created_at, updated_at FROM themes WHERE id = ?1 LIMIT 1")
        .map_err(|e| format!("[Storage] get_theme prepare: {}", e))?;
    let theme = stmt.query_row(params![id], |row| {
        Ok(Theme {
            id: row.get(0)?, name: row.get(1)?, author: row.get(2)?,
            description: row.get(3)?, is_builtin: row.get::<_, i32>(4)? != 0,
            css_variables: row.get(5)?, metadata_json: row.get(6)?,
            created_at: row.get(7)?, updated_at: row.get(8)?,
        })
    }).ok();
    Ok(theme)
}

#[tauri::command]
pub async fn get_all_themes(
    manager: State<'_, StorageManager>,
) -> Result<Vec<Theme>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, author, description, is_builtin, css_variables, metadata_json, created_at, updated_at FROM themes ORDER BY is_builtin DESC, name ASC")
        .map_err(|e| format!("[Storage] get_all_themes prepare: {}", e))?;
    let themes: Vec<Theme> = stmt.query_map([], |row| {
        Ok(Theme {
            id: row.get(0)?, name: row.get(1)?, author: row.get(2)?,
            description: row.get(3)?, is_builtin: row.get::<_, i32>(4)? != 0,
            css_variables: row.get(5)?, metadata_json: row.get(6)?,
            created_at: row.get(7)?, updated_at: row.get(8)?,
        })
    }).map_err(|e| format!("[Storage] get_all_themes query: {}", e))?
    .filter_map(|r| r.ok()).collect();
    Ok(themes)
}

#[tauri::command]
pub async fn delete_theme(
    manager: State<'_, StorageManager>,
    id: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM themes WHERE id = ?1 AND is_builtin = 0", params![id])
        .map_err(|e| format!("[Storage] delete_theme: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_active_theme_id(
    manager: State<'_, StorageManager>,
) -> Result<Option<String>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM auth_progress WHERE key = 'active_theme_id'",
        [], |row| row.get::<_, String>(0),
    ).ok();
    Ok(result)
}

#[tauri::command]
pub async fn set_active_theme_id(
    manager: State<'_, StorageManager>,
    theme_id: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO auth_progress (key, value, updated_at) VALUES ('active_theme_id', ?1, strftime('%s','now'))",
        params![theme_id],
    ).map_err(|e| format!("[Storage] set_active_theme: {}", e))?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
// CHAT WALLPAPERS (3 команды)
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn save_chat_wallpaper(
    manager: State<'_, StorageManager>,
    chat_id: String,
    wallpaper_type: String,
    wallpaper_value: String,
    blur: f64,
    opacity: f64,
    brightness: f64,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO chat_wallpapers (chat_id, wallpaper_type, wallpaper_value, blur, opacity, brightness, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s','now'))",
        params![chat_id, wallpaper_type, wallpaper_value, blur, opacity, brightness],
    ).map_err(|e| format!("[Storage] save_chat_wallpaper: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_chat_wallpaper(
    manager: State<'_, StorageManager>,
    chat_id: String,
) -> Result<Option<ChatWallpaper>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT chat_id, wallpaper_type, wallpaper_value, blur, opacity, brightness, updated_at FROM chat_wallpapers WHERE chat_id = ?1 LIMIT 1")
        .map_err(|e| format!("[Storage] get_chat_wallpaper prepare: {}", e))?;
    let wallpaper = stmt.query_row(params![chat_id], |row| {
        Ok(ChatWallpaper {
            chat_id: row.get(0)?, wallpaper_type: row.get(1)?,
            wallpaper_value: row.get(2)?, blur: row.get(3)?,
            opacity: row.get(4)?, brightness: row.get(5)?,
            updated_at: row.get(6)?,
        })
    }).ok();
    Ok(wallpaper)
}

#[tauri::command]
pub async fn delete_chat_wallpaper(
    manager: State<'_, StorageManager>,
    chat_id: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chat_wallpapers WHERE chat_id = ?1", params![chat_id])
        .map_err(|e| format!("[Storage] delete_chat_wallpaper: {}", e))?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
// AUTH PROGRESS (3 команды)
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn save_auth_progress(
    manager: State<'_, StorageManager>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO auth_progress (key, value, updated_at)
         VALUES (?1, ?2, strftime('%s','now'))",
        params![key, value],
    )
    .map_err(|e| format!("[Auth] save_progress: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_auth_progress(
    manager: State<'_, StorageManager>,
    key: String,
) -> Result<Option<String>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let result = conn
        .query_row(
            "SELECT value FROM auth_progress WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(result)
}

#[tauri::command]
pub async fn delete_auth_progress(
    manager: State<'_, StorageManager>,
    key: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM auth_progress WHERE key = ?1", params![key])
        .map_err(|e| format!("[Auth] delete_progress: {}", e))?;
    Ok(())
}
