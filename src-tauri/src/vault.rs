//! Хранилище с AES-256-GCM шифрованием.
//!
//! Ключ шифрования Vault шифрует только данные БД (токены, настройки, профили)
//! и НЕ хранит E2EE-приватный ключ. После авторизации ключ Vault деривируется
//! из секрета пользователя (хэш seed) через `vault_derive_key` / `derive_from_seed`
//! и zero-ится при `vault_logout` + удаляется файл `.echo_key.bin`.

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
use zeroize::Zeroizing;

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
    key: Mutex<Option<Zeroizing<[u8; KEY_SIZE]>>>,
    ready: std::sync::atomic::AtomicBool,
}

impl Vault {
    pub fn new() -> Self {
        Vault {
            key: Mutex::new(None),
            ready: std::sync::atomic::AtomicBool::new(false),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Загрузить существующий ключ (backward-compat bootstrap) или пометить
    /// vault неготовым до `derive_from_seed`. Никогда не хранит E2EE-приватный ключ.
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
            key
        } else {
            log::info!("[Vault] No key file yet — vault not ready until derive_from_seed");
            // Возвращаем None -> vault остаётся неготовым; ключ появится при
            // `derive_from_seed` (из секрета пользователя), а не из случайного файла.
            *self.key.lock().map_err(|e| format!("[Vault] Lock: {}", e))? = None;
            return Ok(());
        };

        *self.key.lock().map_err(|e| format!("[Vault] Lock: {}", e))? =
            Some(Zeroizing::new(key_bytes));
        self.ready.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    }

    /// Деривировать ключ Vault из секрета пользователя (SHA-256) и персистнуть.
    pub fn derive_key(&self, app: &AppHandle<tauri::Wry>, user_secret: &[u8]) -> Result<(), String> {
        let key: [u8; KEY_SIZE] = Sha256::digest(user_secret).into();
        self.set_key_and_persist(app, key)
    }

    /// Деривировать ключ Vault из BIP-39 seed (SHA-256), перекрывая bootstra-ключ.
    pub fn derive_from_seed(&self, app: &AppHandle<tauri::Wry>, seed: &[u8]) -> Result<(), String> {
        let key: [u8; KEY_SIZE] = Sha256::digest(seed).into();
        self.set_key_and_persist(app, key)
    }

    fn set_key_and_persist(&self, app: &AppHandle<tauri::Wry>, key: [u8; KEY_SIZE]) -> Result<(), String> {
        let key_path = self.get_key_path(app);
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
        *self.key.lock().map_err(|e| format!("[Vault] Lock: {}", e))? = Some(Zeroizing::new(key));
        self.ready.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    }

    /// Zero-ить ключ в памяти и удалить файл `.echo_key.bin` (logout).
    pub fn clear(&self, app: &AppHandle<tauri::Wry>) -> Result<(), String> {
        self.key.lock().map_err(|e| format!("[Vault] Lock: {}", e))?.take();
        self.ready.store(false, std::sync::atomic::Ordering::Relaxed);
        let key_path = self.get_key_path(app);
        if key_path.exists() {
            std::fs::remove_file(&key_path)
                .map_err(|e| format!("[Vault] Delete key file: {}", e))?;
        }
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
        let key = key_guard.as_ref().ok_or("[Vault] NOT INITIALIZED")?;
        let cipher = Aes256Gcm::new_from_slice(&key[..])
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
        let key = key_guard.as_ref().ok_or("[Vault] NOT INITIALIZED")?;
        let cipher = Aes256Gcm::new_from_slice(&key[..])
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

/// Деривировать ключ Vault из секрета пользователя (SHA-256).
/// Приватный ключ Vault никогда не возвращается наружу.
#[tauri::command]
pub async fn vault_derive_key(app: AppHandle, user_secret: String) -> Result<(), String> {
    let vault = app.state::<Vault>();
    vault.derive_key(&app, user_secret.as_bytes())
}

/// Logout: zero-ить ключ Vault в памяти + удалить файл `.echo_key.bin`.
#[tauri::command]
pub async fn vault_logout(app: AppHandle) -> Result<(), String> {
    let vault = app.state::<Vault>();
    vault.clear(&app)
}
