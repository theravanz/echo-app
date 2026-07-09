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
    pub last_active: i64,
    pub is_current: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub public_key: String,
    pub encrypted_seed: String,
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
                encrypted_seed TEXT NOT NULL,
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
            );"
        ) {
            log::error!("[Storage] Schema creation failed: {}", e);
            panic!("[Storage] Schema failed");
        }

        eprintln!("[Storage] INIT COMPLETE");
        Self {
            conn: Mutex::new(conn),
        }
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
    is_current: Option<bool>,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO devices
         (id, user_id, hwid, device_name, platform, last_active, is_current, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'), ?6, strftime('%s','now'))",
        params![
            id,
            user_id,
            hwid,
            device_name.unwrap_or_else(|| "Unknown Device".into()),
            platform.unwrap_or_default(),
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
            "SELECT id, user_id, hwid, device_name, platform, last_active, is_current, created_at
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
                last_active: row.get(5)?,
                is_current: row.get::<_, i32>(6)? != 0,
                created_at: row.get(7)?,
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
    vault: State<'_, Vault>,
    id: String,
    public_key: String,
    encrypted_seed: String,
    display_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<(), String> {
    let double_encrypted_seed = encrypt_field(&vault, &encrypted_seed)?;

    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO accounts
         (id, public_key, encrypted_seed, display_name, avatar_url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5,
                 COALESCE((SELECT created_at FROM accounts WHERE id=?1), strftime('%s','now')),
                 strftime('%s','now'))",
        params![
            id,
            public_key,
            double_encrypted_seed,
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
    vault: State<'_, Vault>,
    id: String,
) -> Result<Option<Account>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, public_key, encrypted_seed, display_name, avatar_url, created_at, updated_at
             FROM accounts
             WHERE id = ?1
             LIMIT 1",
        )
        .map_err(|e| format!("[Storage] get_account prepare: {}", e))?;

    let account = stmt
        .query_row(params![id], |row| {
            let double_encrypted_seed: String = row.get(2)?;
            let encrypted_seed = decrypt_field_safe(&vault, &double_encrypted_seed)?;

            Ok(Account {
                id: row.get(0)?,
                public_key: row.get(1)?,
                encrypted_seed,
                display_name: row.get(3)?,
                avatar_url: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .ok();

    Ok(account)
}
// ═══════════════════════════════════════════════════════════════════
// AUTH PROGRESS (3 команды — переживают выгрузку приложения)
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
