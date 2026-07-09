//! Хранилище с AES-256-GCM шифрованием.
//!
//! Ключ шифрования генерируется ОДИН раз при первом запуске приложения
//! (не при обновлении страницы!), сохраняется в app_data_dir/.echo_key.bin
//! и привязан к устройству. Без key.bin расшифровать данные из echo.db
//! невозможно.
//!
//! ВАЖНО: Rust backend живёт всё время работы приложения. `setup` вызывается
//! один раз, а page reload (F5) НЕ перезапускает Rust. Vault остаётся в памяти
//! с готовым ключом. Ключ НЕ генерируется заново при F5.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

const KEY_SIZE: usize = 32;
const NONCE_SIZE: usize = 12;
const KEY_FILE: &str = ".echo_key.bin";

#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptedPayload {
    pub nonce: String,
    pub data: String,
    pub checksum: String,
}

pub struct Vault {
    key: Mutex<[u8; KEY_SIZE]>,
    ready: std::sync::atomic::AtomicBool,
}

impl Vault {
    pub fn new() -> Self {
        Vault {
            key: Mutex::new([0u8; KEY_SIZE]),
            ready: std::sync::atomic::AtomicBool::new(false),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Загрузить или создать ключ. Вызывается строго ОДИН раз в `setup`.
    pub fn initialize(&mut self, app: &AppHandle<tauri::Wry>) -> Result<(), String> {
        let key_path = self.get_key_path(app);
        eprintln!("[Vault] Key path: {:?}", key_path);

        let key_bytes = if key_path.exists() {
            let data = std::fs::read(&key_path)
                .map_err(|e| format!("[Vault] Read error: {}", e))?;
            if data.len() != KEY_SIZE {
                return Err(format!(
                    "[Vault] Invalid key size: {} (expected {})", data.len(), KEY_SIZE
                ));
            }
            let mut key = [0u8; KEY_SIZE];
            key.copy_from_slice(&data);
            log::info!("[Vault] Key LOADED from existing file ({} bytes)", data.len());
            eprintln!("[Vault] Key loaded OK");
            key
        } else {
            let mut key = [0u8; KEY_SIZE];
            OsRng.fill_bytes(&mut key);
            if let Some(parent) = key_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("[Vault] Mkdir error: {}", e))?;
            }
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                std::fs::write(&key_path, &key)
                    .map_err(|e| format!("[Vault] Write error: {}", e))?;
                std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600)).ok();
            }
            #[cfg(not(unix))] {
                std::fs::write(&key_path, &key)
                    .map_err(|e| format!("[Vault] Write error: {}", e))?;
            }
            log::info!("[Vault] New key GENERATED and saved ({} bytes)", key.len());
            eprintln!("[Vault] New key generated OK");
            key
        };

        *self.key.lock().map_err(|e| format!("[Vault] Lock: {}", e))? = key_bytes;
        self.ready.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    }

    fn get_key_path(&self, app: &AppHandle<tauri::Wry>) -> PathBuf {
        let app_dir = app.path().app_data_dir()
            .unwrap_or_else(|_| {
                eprintln!("[Vault] WARN: app_data_dir() failed, using ./data");
                std::path::PathBuf::from("./data")
            });
        app_dir.join(KEY_FILE)
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<EncryptedPayload, String> {
        if !self.is_ready() {
            return Err("[Vault] NOT READY".to_string());
        }
        let key_guard = self.key.lock().map_err(|e| format!("[Vault] Lock: {}", e))?;
        let cipher = Aes256Gcm::new_from_slice(&*key_guard)
            .map_err(|e| format!("[Vault] AES init: {}", e))?;
        drop(key_guard);

        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| format!("[Vault] Encrypt failed: {}", e))?;
        let checksum = hex::encode(Sha256::digest(plaintext.as_bytes()));

        Ok(EncryptedPayload {
            nonce: BASE64.encode(nonce_bytes),
            data: BASE64.encode(&ciphertext),
            checksum,
        })
    }

    pub fn decrypt(&self, payload: &EncryptedPayload) -> Result<String, String> {
        if !self.is_ready() {
            return Err("[Vault] NOT READY".to_string());
        }
        let key_guard = self.key.lock().map_err(|e| format!("[Vault] Lock: {}", e))?;
        let cipher = Aes256Gcm::new_from_slice(&*key_guard)
            .map_err(|e| format!("[Vault] AES init: {}", e))?;
        drop(key_guard);

        let nonce_bytes = BASE64.decode(&payload.nonce)
            .map_err(|e| format!("[Vault] Nonce decode: {}", e))?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = BASE64.decode(&payload.data)
            .map_err(|e| format!("[Vault] Data decode: {}", e))?;

        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())
            .map_err(|e| format!("[Vault] Decrypt FAILED: {}", e))?;
        let result = String::from_utf8(plaintext)
            .map_err(|e| format!("[Vault] UTF-8: {}", e))?;

        let expected = hex::encode(Sha256::digest(result.as_bytes()));
        if expected != payload.checksum {
            return Err(format!("[Vault] Checksum MISMATCH (got {}, expected {})", payload.checksum, expected));
        }

        Ok(result)
    }

    pub fn encrypt_to_json(&self, plaintext: &str) -> Result<String, String> {
        let payload = self.encrypt(plaintext)?;
        serde_json::to_string(&payload).map_err(|e| format!("[Vault] JSON: {}", e))
    }

    pub fn decrypt_from_json(&self, json_str: &str) -> Result<String, String> {
        let payload: EncryptedPayload = serde_json::from_str(json_str)
            .map_err(|e| format!("[Vault] JSON parse: {}", e))?;
        self.decrypt(&payload)
    }
}

#[tauri::command]
pub async fn vault_encrypt(app: AppHandle, plaintext: String) -> Result<String, String> {
    let vault = app.state::<Vault>();
    vault.encrypt_to_json(&plaintext)
}

#[tauri::command]
pub async fn vault_decrypt(app: AppHandle, encrypted_json: String) -> Result<String, String> {
    let vault = app.state::<Vault>();
    vault.decrypt_from_json(&encrypted_json)
}

#[tauri::command]
pub async fn vault_status(app: AppHandle) -> Result<bool, String> {
    let vault = app.state::<Vault>();
    Ok(vault.is_ready())
}

/// Сохранить E2EE приватный ключ в защищённое vault-хранилище.
/// Ключ шифруется AES-256-GCM и сохраняется в SQLite через storage.
#[tauri::command]
pub async fn vault_save_private_key(
    app: AppHandle,
    storage: tauri::State<'_, crate::storage::StorageManager>,
    key_base64: String,
) -> Result<(), String> {
    let vault = app.state::<Vault>();
    let encrypted = vault.encrypt_to_json(&key_base64)?;

    // Сохраняем зашифрованный ключ в auth_progress (ключ = "echo_private_key")
    let conn = storage.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO auth_progress (key, value, updated_at)
         VALUES ('echo_private_key', ?1, strftime('%s','now'))",
        rusqlite::params![encrypted],
    )
    .map_err(|e| format!("[Vault] save_private_key: {}", e))?;

    log::info!("[Vault] E2EE private key saved securely");
    Ok(())
}

/// Загрузить E2EE приватный ключ из защищённого vault-хранилища.
#[tauri::command]
pub async fn vault_load_private_key(
    app: AppHandle,
    storage: tauri::State<'_, crate::storage::StorageManager>,
) -> Result<Option<String>, String> {
    let vault = app.state::<Vault>();

    let conn = storage.conn.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM auth_progress WHERE key = 'echo_private_key'",
        [],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(encrypted_json) => {
            let decrypted = vault.decrypt_from_json(&encrypted_json)?;
            log::info!("[Vault] E2EE private key loaded securely");
            Ok(Some(decrypted))
        }
        Err(e) => {
            if matches!(&e, rusqlite::Error::QueryReturnedNoRows) {
                log::warn!("[Vault] No private key found in storage");
                Ok(None)
            } else {
                Err(format!("[Vault] load_private_key: {}", e))
            }
        }
    }
}

/// Удалить E2EE приватный ключ из хранилища.
#[tauri::command]
pub async fn vault_delete_private_key(
    storage: tauri::State<'_, crate::storage::StorageManager>,
) -> Result<(), String> {
    let conn = storage.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM auth_progress WHERE key = 'echo_private_key'",
        [],
    )
    .map_err(|e| format!("[Vault] delete_private_key: {}", e))?;

    log::info!("[Vault] E2EE private key deleted from storage");
    Ok(())
}
