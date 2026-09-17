//! Нативное SQLite-хранилище на базе rusqlite + SQLCipher (bundled-sqlcipher).
//!
//! Архитектура (Phase 1):
//! - Весь файл БД зашифрован SQLCipher. Ключ НЕ деривируется из Vault-ключа и
//!   НЕ переключается (нет rekey) — это device-bound ключ:
//!   Argon2id(HWID + соль) → HKDF-SHA256 expand (info "echo/db-cipher") → PRAGMA key.
//!   Это совместимо с мультиаккаунтом и записью БД ещё на экране входа.
//! - Connection pool (N=4, LIFO, пред-ключеван) вместо Mutex<Connection>.
//! - Версионированные миграции (V001..V00N) в таблице refinery_schema_history,
//!   запускаются один раз при старте до инициализации Vault (идемпотентно).
//! - Двухслойная модель: SQLCipher шифрует весь файл, а Vault (AES-256-GCM от
//!   seed пользователя) дополнительно шифрует чувствительные строки (токены и т.п.).
//! - auth_progress разделена → secure_store (чувствительное) + app_settings (темы/обои).
//! - Внешние ключи ВКЛЮЧЕНЫ (PRAGMA foreign_keys = ON) — referential integrity.

use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::fs;
use std::ops::{Deref, DerefMut};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::device;
use crate::vault::Vault;

use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

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
// StorageManager — владелец connection pool (вместо Mutex<Connection>)
/// Размер пула соединений.
const POOL_SIZE: usize = 4;
/// Domain-separation info для HKDF device-ключа в DB-ключ.
const DB_KEY_INFO: &[u8] = b"echo/db-cipher";
/// Имя файла-соли для DB-ключа (не секретен).
const SALT_FILE: &str = "echo.db.key.salt";
/// Файл стабильного идентификатора устройства. iOS/Android не имеют `hostname`
/// (и вообще субпроцессов), поэтому генерируем UUID при первом запуске и
/// переиспользуем. Без него device-bound E2EE-ключ не восстановить после
/// перезапуска (все чаты -> "Key Error").
const MACHINE_ID_FILE: &str = "machine.id";

/// Миграции, выполняемые при старте (идемпотентно, до Vault).
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "V001__initial_schema",
        include_str!("../migrations/V001__initial_schema.sql"),
    ),
    (
        "V002__split_auth_progress",
        include_str!("../migrations/V002__split_auth_progress.sql"),
    ),
];

/// Прочитать или создать 16-байтовую соль для DB-ключа.
fn load_or_create_salt(path: &PathBuf) -> Result<Vec<u8>, String> {
    if path.exists() {
        let raw = fs::read(path).map_err(|e| format!("[Storage] read salt: {e}"))?;
        if raw.len() >= 16 {
            return Ok(raw[..16].to_vec());
        }
    }
    use rand::RngCore;
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    fs::write(path, &salt).map_err(|e| format!("[Storage] write salt: {e}"))?;
    Ok(salt.to_vec())
}

/// Прочитать или создать стабильный идентификатор устройства.
/// На десктопе используем реальный HWID. На iOS/Android, где `hostname`
/// (субпроцесс) недоступен или пуст, генерируем UUIDv4 один раз и
/// переиспользуем — иначе device-bound E2EE-ключ не восстановить после
/// перезапуска приложения (все чаты -> "Key Error").
fn load_or_create_machine_id(dir: &PathBuf) -> String {
    let file = dir.join(MACHINE_ID_FILE);
    if file.exists() {
        if let Ok(raw) = fs::read_to_string(&file) {
            let id = raw.trim().to_string();
            if !id.is_empty() {
                return id;
            }
        }
    }
    use rand::RngCore;
    let mut buf = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    // Отмечаем UUIDv4 (версия 4, вариант 1/2).
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    let hexed = hex::encode(buf);
    let id = format!(
        "{}-{}-{}-{}-{}",
        &hexed[..8],
        &hexed[8..12],
        &hexed[12..16],
        &hexed[16..20],
        &hexed[20..32]
    );
    let _ = fs::write(&file, id.as_bytes());
    id
}

/// Деривировать SQLCipher-ключ: Argon2id(HWID+salt) -> HKDF-SHA256 (echo/db-cipher).
fn derive_db_key_hex(machine: &str, salt: &[u8]) -> Result<Zeroizing<String>, String> {
    let ikm = device::device_key(machine, salt)?;
    let hk = Hkdf::<Sha256>::new(None, ikm.as_ref());
    let mut okm = [0u8; 32];
    hk.expand(DB_KEY_INFO, &mut okm)
        .map_err(|e| format!("[Storage] HKDF expand: {e}"))?;
    let hexed = Zeroizing::new(hex::encode(okm));
    okm.fill(0);
    Ok(hexed)
}

/// Открыть/создать SQLCipher-БД, установить ключ и проверить его.
fn open_keyed(path: &PathBuf, key_hex: &str) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
    .map_err(|e| format!("[Storage] open_with_flags: {e}"))?;
    conn.pragma_update(None, "key", key_hex)
        .map_err(|e| format!("[Storage] PRAGMA key: {e}"))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| format!("[Storage] PRAGMA init: {e}"))?;
    conn.prepare("SELECT count(*) FROM sqlite_master")
        .map_err(|_| "[Storage] wrong key or not a SQLCipher database".to_string())?;
    Ok(conn)
}

/// Открывается ли файл нашим ключом (уже корректная SQLCipher-БД)?
fn opens_with_key(path: &PathBuf, key_hex: &str) -> bool {
    open_keyed(path, key_hex).is_ok()
}

/// Является ли файл legacy (plaintext) SQLite с нашими таблицами?
fn is_legacy_plaintext(path: &PathBuf) -> bool {
    let Ok(conn) = Connection::open(path) else {
        return false;
    };
    match conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN
            ('accounts','sessions','devices','messages','themes',
             'chat_wallpapers','auth_progress','e2ee_keys')",
        [],
        |r| r.get::<_, i64>(0),
    ) {
        Ok(n) => n > 0,
        Err(_) => false,
    }
}

/// Экранировать одинарные кавычки для ATTACH-пути.
fn quote_sql_path(path: &PathBuf) -> String {
    path.to_string_lossy().replace('\'', "''")
}

/// One-time миграция legacy plaintext echo.db -> новый SQLCipher-файл (ключ).
/// Standard SQLCipher recipe: открываем legacy как plaintext (src), приаттачиваем
/// пустой целевой файл с KEY ('enc'), и sqlcipher_export копирует схему+данные.
/// Старая БД удаляется только после успеха (rollback-безопасно).
fn migrate_legacy_to_sqlcipher(db_path: &PathBuf, key_hex: &str) -> Result<(), String> {
    let tmp = db_path.with_extension("db.cipher");
    if tmp.exists() {
        let _ = fs::remove_file(&tmp);
    }

    // Источник открываем ПЛАЙНТЕКСТ-соединением (до Phase 1 файл не зашифрован).
    let src =
        Connection::open(db_path).map_err(|e| format!("[Storage] open legacy source: {e}"))?;

    // Приаттачиваем пустой целевой файл как КЛЮЧЕВАННУЮ БД и экспортируем.
    // (Никакого явного BEGIN/COMMIT: DETACH запрещён внутри транзакции, а
    // транзакция не нужна — источник только читается, оригинал трогаем лишь
    // после успешного создания tmp.)
    let attach = format!(
        "ATTACH DATABASE '{}' AS enc KEY '{}';",
        quote_sql_path(&tmp),
        key_hex
    );
    let export = src
        .execute_batch(&attach)
        .and_then(|_| src.execute_batch("SELECT sqlcipher_export('enc');"))
        .and_then(|_| src.execute_batch("DETACH DATABASE enc;"));

    if let Err(e) = export {
        drop(src);
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "[Storage] legacy migration failed, original DB kept intact: {e}"
        ));
    }
    drop(src);

    let bak = db_path.with_extension("db.legacy");
    if bak.exists() {
        let _ = fs::remove_file(&bak);
    }
    fs::rename(db_path, &bak).map_err(|e| format!("[Storage] rename legacy: {e}"))?;
    fs::rename(&tmp, db_path).map_err(|e| format!("[Storage] rename cipher: {e}"))?;
    let _ = fs::remove_file(&bak);
    Ok(())
}

/// Выполнить версионированные миграции (идемпотентно). История в refinery_schema_history.
fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS refinery_schema_history (
            version     INTEGER PRIMARY KEY,
            name        TEXT NOT NULL,
            applied_on  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
            checksum    TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("[Storage] history table: {e}"))?;

    for (name, sql) in MIGRATIONS {
        let version: i64 = name
            .trim_start_matches("V")
            .trim_matches('0')
            .parse()
            .unwrap_or(0);

        let applied: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM refinery_schema_history WHERE version = ?1)",
                params![version],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|e| format!("[Storage] check migration: {e}"))?;
        if applied {
            continue;
        }

        let checksum = format!("{:x}", Sha256::digest(sql.as_bytes()));
        conn.execute_batch("BEGIN;")
            .and_then(|_| conn.execute_batch(sql))
            .and_then(|_| {
                conn.execute(
                    "INSERT INTO refinery_schema_history (version, name, checksum)
                     VALUES (?1, ?2, ?3)",
                    params![version, name, checksum],
                )
                .map(|_| ())
            })
            .and_then(|_| conn.execute_batch("COMMIT;"))
            .map_err(|e| {
                let _ = conn.execute_batch("ROLLBACK;");
                format!("[Storage] apply {name}: {e}")
            })?;
        log::info!("[Storage] applied migration {name}");
    }
    Ok(())
}
/// Простой пул пре-ключеванных SQLCipher-соединений (LIFO через mpsc).
/// Receiver обёрнут в Mutex: этот Mutex сериализует лишь O(1)-операции
/// acquire/release, а не сами запросы (каждый поток держит своё Connection
/// вне мьютекса), поэтому параллельные чтения/записи идут конкурентно и
/// deadlock-безопасно (Drop возвращает соединение через tx, минуя rx-mutex).
pub struct Pool {
    tx: Sender<Connection>,
    rx: Mutex<Receiver<Connection>>,
}

impl Pool {
    fn open(path: &PathBuf, key_hex: &str, size: usize) -> Result<Self, String> {
        // Unbounded канал: содержит максимум `size` соединений (возвращаем ровно
        // столько, сколько взяли), поэтому рост памяти ограничен POOL_SIZE.
        let (tx, rx) = mpsc::channel();
        for _ in 0..size {
            let c = open_keyed(path, key_hex)?;
            tx.send(c)
                .map_err(|e| format!("[Storage] pool send: {e}"))?;
        }
        Ok(Pool {
            tx,
            rx: Mutex::new(rx),
        })
    }

    /// Взять соединение из пула; возвращается в пул в Drop guard.
    pub fn lock(&self) -> Result<PoolGuard<'_>, String> {
        let rx = self.rx.lock().map_err(|e| e.to_string())?;
        let conn = rx.recv().map_err(|_| "[Storage] pool closed".to_string())?;
        drop(rx);
        Ok(PoolGuard {
            pool: self,
            conn: Some(conn),
        })
    }
}

/// RAII-guard соединения; Deref/DerefMut -> rusqlite::Connection, поэтому вызовы
/// `manager.conn.lock().map_err(...)?; conn.execute(...)` компилируются без изменений.
pub struct PoolGuard<'a> {
    pool: &'a Pool,
    conn: Option<Connection>,
}

impl Deref for PoolGuard<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        self.conn.as_ref().expect("pool guard conn")
    }
}
impl DerefMut for PoolGuard<'_> {
    fn deref_mut(&mut self) -> &mut Connection {
        self.conn.as_mut().expect("pool guard conn")
    }
}
impl Drop for PoolGuard<'_> {
    fn drop(&mut self) {
        if let Some(c) = self.conn.take() {
            let _ = self.pool.tx.send(c);
        }
    }
}

pub struct StorageManager {
    pub(crate) conn: Pool,
    /// Стабильный идентификатор устройства (реальный HWID или персистентный UUID).
    pub(crate) machine_id: String,
}

impl StorageManager {
    /// Стабильный идентификатор устройства для device-bound E2EE-ключа.
    pub(crate) fn machine_id(&self) -> String {
        self.machine_id.clone()
    }

    pub fn new(app: &AppHandle<tauri::Wry>) -> Self {
        eprintln!("[Storage] STARTING INIT (SQLCipher)");

        let app_dir = app
            .path()
            .app_local_data_dir()
            .or_else(|_| app.path().app_data_dir())
            .unwrap_or_else(|_| {
                eprintln!("[Storage] NO APP DIR, using fallback");
                std::path::PathBuf::from("/data/user/0/com.theravanz.echo_tauri")
            });

        if let Err(e) = fs::create_dir_all(&app_dir) {
            eprintln!("[Storage] CREATE DIR FAILED: {e}");
        }

        let db_path = app_dir.join("echo.db");
        let salt_path = app_dir.join(SALT_FILE);

        // Device-bound ключ: Argon2id(HWID+salt) -> HKDF -> "echo/db-cipher".
        let salt =
            load_or_create_salt(&salt_path).unwrap_or_else(|e| panic!("[Storage] salt: {e}"));
        // Стабильный идентификатор устройства. iOS/Android часто не имеют
        // `hostname`/субпроцессов -> device::machine_id() пуст. Тогда генерируем
        // персистентный UUID, иначе device-bound ключ не переживёт перезапуск.
        let machine = device::machine_id()
            .ok()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| load_or_create_machine_id(&app_dir));
        let key_hex =
            derive_db_key_hex(&machine, &salt).unwrap_or_else(|e| panic!("[Storage] db key: {e}"));

        // Определяем состояние файла и открываем пул.
        let pool = {
            if opens_with_key(&db_path, &key_hex) {
                eprintln!("[Storage] SQLCipher DB present");
                Pool::open(&db_path, &key_hex, POOL_SIZE)
                    .unwrap_or_else(|e| panic!("[Storage] open pool: {e}"))
            } else if db_path.exists() && is_legacy_plaintext(&db_path) {
                eprintln!("[Storage] legacy plaintext DB detected -> migrating");
                migrate_legacy_to_sqlcipher(&db_path, &key_hex)
                    .unwrap_or_else(|e| panic!("[Storage] migration: {e}"));
                eprintln!("[Storage] data migrated to SQLCipher");
                Pool::open(&db_path, &key_hex, POOL_SIZE)
                    .unwrap_or_else(|e| panic!("[Storage] open pool: {e}"))
            } else {
                // Файл есть, но не наш ключ и не plaintext -> другой device (HWID
                // изменился) или битый. БД = кэш: не открываем, recovery мнемоникой.
                if db_path.exists() {
                    let stale = db_path.with_extension("db.stale");
                    eprintln!("[Storage] unreachable DB (HWID change/recovery), archiving");
                    if fs::rename(&db_path, &stale).is_err() {
                        let _ = fs::remove_file(&db_path);
                    }
                }
                eprintln!("[Storage] fresh SQLCipher DB");
                Pool::open(&db_path, &key_hex, POOL_SIZE)
                    .unwrap_or_else(|e| panic!("[Storage] open pool: {e}"))
            }
        };

        // Миграции — один раз при старте, до инициализации Vault.
        {
            let conn = pool.lock().expect("[Storage] pool lock for migrations");
            if let Err(e) = run_migrations(&conn) {
                panic!("[Storage] migrations failed: {e}");
            }
        }

        eprintln!("[Storage] INIT COMPLETE (SQLCipher + pool, {POOL_SIZE} conns)");
        Self {
            conn: pool,
            machine_id: machine,
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
            std::io::Error::new(std::io::ErrorKind::Other, "Vault not ready"),
        )));
    }
    if encrypted_json.is_empty() {
        return Ok(String::new());
    }
    vault.decrypt_from_json(encrypted_json).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            e,
        )))
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
pub async fn delete_session(manager: State<'_, StorageManager>, id: String) -> Result<(), String> {
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
pub async fn delete_device(manager: State<'_, StorageManager>, id: String) -> Result<(), String> {
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
    let theme = stmt
        .query_row(params![id], |row| {
            Ok(Theme {
                id: row.get(0)?,
                name: row.get(1)?,
                author: row.get(2)?,
                description: row.get(3)?,
                is_builtin: row.get::<_, i32>(4)? != 0,
                css_variables: row.get(5)?,
                metadata_json: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .ok();
    Ok(theme)
}

#[tauri::command]
pub async fn get_all_themes(manager: State<'_, StorageManager>) -> Result<Vec<Theme>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, author, description, is_builtin, css_variables, metadata_json, created_at, updated_at FROM themes ORDER BY is_builtin DESC, name ASC")
        .map_err(|e| format!("[Storage] get_all_themes prepare: {}", e))?;
    let themes: Vec<Theme> = stmt
        .query_map([], |row| {
            Ok(Theme {
                id: row.get(0)?,
                name: row.get(1)?,
                author: row.get(2)?,
                description: row.get(3)?,
                is_builtin: row.get::<_, i32>(4)? != 0,
                css_variables: row.get(5)?,
                metadata_json: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("[Storage] get_all_themes query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(themes)
}

#[tauri::command]
pub async fn delete_theme(manager: State<'_, StorageManager>, id: String) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM themes WHERE id = ?1 AND is_builtin = 0",
        params![id],
    )
    .map_err(|e| format!("[Storage] delete_theme: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_active_theme_id(
    manager: State<'_, StorageManager>,
) -> Result<Option<String>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let result = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'active_theme_id'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(result)
}

#[tauri::command]
pub async fn set_active_theme_id(
    manager: State<'_, StorageManager>,
    theme_id: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('active_theme_id', ?1, strftime('%s','now'))",
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
    let wallpaper = stmt
        .query_row(params![chat_id], |row| {
            Ok(ChatWallpaper {
                chat_id: row.get(0)?,
                wallpaper_type: row.get(1)?,
                wallpaper_value: row.get(2)?,
                blur: row.get(3)?,
                opacity: row.get(4)?,
                brightness: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .ok();
    Ok(wallpaper)
}

#[tauri::command]
pub async fn delete_chat_wallpaper(
    manager: State<'_, StorageManager>,
    chat_id: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM chat_wallpapers WHERE chat_id = ?1",
        params![chat_id],
    )
    .map_err(|e| format!("[Storage] delete_chat_wallpaper: {}", e))?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
// Тесты (Phase 1): SQLCipher-миграция legacy БД + connection pool.
// Запуск: cargo test --lib storage::tests
// ═══════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Создать legacy (plaintext) SQLite-БД вида, который был ДО Phase 1.
    fn make_legacy_db(path: &PathBuf) -> Result<(), String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE accounts (
                id TEXT PRIMARY KEY,
                public_key TEXT NOT NULL,
                display_name TEXT DEFAULT '',
                avatar_url TEXT DEFAULT '',
                created_at INTEGER DEFAULT (strftime('%s','now')),
                updated_at INTEGER DEFAULT (strftime('%s','now'))
            );
            INSERT INTO accounts (id, public_key, display_name) VALUES
                ('acc-1', 'pubkey-1', 'Alice');",
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn unique_path(tag: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("echo_test_{tag}_{ts}"))
    }

    #[test]
    fn legacy_db_migrates_to_sqlcipher_and_reads_back() {
        let db = unique_path("legacy.db");
        let salt_path = unique_path("legacy.salt");
        make_legacy_db(&db).unwrap();

        let salt = load_or_create_salt(&salt_path).unwrap();
        let key = derive_db_key_hex("test-machine", &salt).unwrap();

        // До миграции: plaintext, ключом не открывается.
        assert!(is_legacy_plaintext(&db));
        assert!(!opens_with_key(&db, &key));

        // Миграция plaintext -> SQLCipher.
        migrate_legacy_to_sqlcipher(&db, &key).unwrap();

        // После: ключом открывается, plaintext больше не читается.
        assert!(opens_with_key(&db, &key));
        assert!(!is_legacy_plaintext(&db));

        // Данные на месте через пул.
        let pool = Pool::open(&db, &key, POOL_SIZE).unwrap();
        let conn = pool.lock().unwrap();
        let name: String = conn
            .query_row(
                "SELECT display_name FROM accounts WHERE id='acc-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(name, "Alice");

        // Идемпотентность миграций: повторный запуск не ломает схему.
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_file(&salt_path);
    }

    #[test]
    fn wrong_device_key_cannot_open_db() {
        let db = unique_path("wrongkey.db");
        let salt_path = unique_path("wrongkey.salt");
        make_legacy_db(&db).unwrap();

        let salt = load_or_create_salt(&salt_path).unwrap();
        let key1 = derive_db_key_hex("device-A", &salt).unwrap();
        let key2 = derive_db_key_hex("device-B", &salt).unwrap();
        migrate_legacy_to_sqlcipher(&db, &key1).unwrap();

        assert!(opens_with_key(&db, &key1));
        assert!(!opens_with_key(&db, &key2));

        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_file(&salt_path);
    }

    #[test]
    fn pool_concurrent_queries_no_deadlock() {
        let db = unique_path("pool.db");
        let salt_path = unique_path("pool.salt");

        let salt = load_or_create_salt(&salt_path).unwrap();
        let key = derive_db_key_hex("t", &salt).unwrap();
        let conn = open_keyed(&db, &key).unwrap();
        conn.execute_batch("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);")
            .unwrap();
        drop(conn);

        let pool = std::sync::Arc::new(Pool::open(&db, &key, 4).unwrap());
        let mut handles = Vec::new();
        for _ in 0..8 {
            let p = std::sync::Arc::clone(&pool);
            handles.push(std::thread::spawn(move || {
                for _ in 0..50 {
                    let conn = p.lock().unwrap();
                    let v: i64 = conn
                        .query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))
                        .unwrap();
                    assert_eq!(v, 1);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_file(&salt_path);
    }
}

/// Куда маршрутизировать auth_progress-запись (Phase 1):
/// публичное (активная тема) → app_settings; чувствительное
/// (seed/токены/OTP/auth-progress JSON) → secure_store.
fn route_table(key: &str) -> &'static str {
    if key == "active_theme_id" {
        "app_settings"
    } else {
        "secure_store"
    }
}

#[tauri::command]
pub async fn save_auth_progress(
    manager: State<'_, StorageManager>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let table = route_table(&key);
    let sql = format!(
        "INSERT OR REPLACE INTO {table} (key, value, updated_at) VALUES (?1, ?2, strftime('%s','now'))"
    );
    conn.execute(&sql, params![key, value])
        .map_err(|e| format!("[Auth] save_progress: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn get_auth_progress(
    manager: State<'_, StorageManager>,
    key: String,
) -> Result<Option<String>, String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let table = route_table(&key);
    let sql = format!("SELECT value FROM {table} WHERE key = ?1");
    let result = conn
        .query_row(&sql, params![key], |row| row.get::<_, String>(0))
        .ok();
    Ok(result)
}

#[tauri::command]
pub async fn delete_auth_progress(
    manager: State<'_, StorageManager>,
    key: String,
) -> Result<(), String> {
    let conn = manager.conn.lock().map_err(|e| e.to_string())?;
    let table = route_table(&key);
    let sql = format!("DELETE FROM {table} WHERE key = ?1");
    conn.execute(&sql, params![key])
        .map_err(|e| format!("[Auth] delete_progress: {e}"))?;
    Ok(())
}
