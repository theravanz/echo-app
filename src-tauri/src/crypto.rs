//! Криптографический модуль Echo Messenger
//!
//! Переносит тяжелые вычисления BIP-39 PBKDF2 (2048 итераций HMAC-SHA512)
//! из JavaScript (однопоточный) в Rust (асинхронный, tokio::spawn_blocking).
//!
//! ВАЖНО: Публичный ключ вычисляется на фронтенде через tweetnacl.scalarMult.base(),
//! потому что Rust x25519-dalek даёт другой результат, чем tweetnacl.
//! Rust делает только PBKDF2 — это 99% вычислительной нагрузки.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bip39::{Language, Mnemonic};
use serde::{Deserialize, Serialize};

/// Результат генерации ключей из мнемонической фразы.
/// Приватный ключ = seed[0..32] (32 байта).
/// Публичный ключ вычисляется фронтендом через tweetnacl.scalarMult.base.
#[derive(Debug, Serialize, Deserialize)]
pub struct KeyMaterial {
    pub public_key: String,
    pub private_key: String,
    pub mnemonic: String,
    /// Полный 64-байтовый BIP-39 seed в Base64 (для tweetnacl.scalarMult.base)
    pub seed_base64: String,
}

#[tauri::command]
pub async fn generate_mnemonic() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let mnemonic = Mnemonic::generate_in(Language::English, 12)
            .map_err(|e| format!("Mnemonic generation failed: {}", e))?;
        Ok(mnemonic.to_string())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn validate_mnemonic(mnemonic_phrase: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        Ok(Mnemonic::parse_in(Language::English, &mnemonic_phrase).is_ok())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Генерация ключей из мнемонической фразы.
/// Возвращает приватный ключ (seed[0..32]) и полный 64-байтовый seed.
/// Публичный ключ вычисляется на фронтенде через tweetnacl.scalarMult.base(seed).
#[tauri::command]
pub async fn generate_keys_from_mnemonic(mnemonic_phrase: String) -> Result<KeyMaterial, String> {
    tokio::task::spawn_blocking(move || {
        let mnemonic = Mnemonic::parse_in(Language::English, &mnemonic_phrase)
            .map_err(|e| format!("Invalid mnemonic: {}", e))?;
        let seed = mnemonic.to_seed("");
        let private_bytes = &seed[..32];
        let private_key_base64 = BASE64.encode(private_bytes);
        let seed_base64 = BASE64.encode(&seed);
        Ok(KeyMaterial {
            public_key: String::new(),
            private_key: private_key_base64,
            mnemonic: mnemonic.to_string(),
            seed_base64,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}
