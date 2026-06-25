//! Криптографический модуль Echo Messenger
//!
//! Переносит тяжелые вычисления BIP-39 и деривации ключей
//! из JavaScript (однопоточный) в Rust (асинхронный, tokio::spawn_blocking).
//!
//! Все операции запускаются в фоновом пуле потоков Tokio,
//! не блокируя WebView и не фризя интерфейс.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bip39::{Language, Mnemonic};
use serde::{Deserialize, Serialize};
use x25519_dalek::{PublicKey, StaticSecret};

/// Результат генерации ключей из мнемонической фразы.
#[derive(Debug, Serialize, Deserialize)]
pub struct KeyMaterial {
    /// Публичный ключ (Curve25519) в Base64
    pub public_key: String,
    /// Приватный ключ (32 байта seed) в Base64
    pub private_key: String,
    /// Мнемоническая фраза (12 слов)
    pub mnemonic: String,
}

/// Генерирует новую случайную мнемоническую фразу (12 слов, английский язык).
/// Выполняется в `spawn_blocking`, не блокирует WebView.
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

/// Валидирует мнемоническую фразу (12 слов, английский язык).
#[tauri::command]
pub async fn validate_mnemonic(mnemonic_phrase: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        Ok(Mnemonic::parse_in(Language::English, &mnemonic_phrase).is_ok())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Принимает мнемоническую фразу (12 слов), деривирует 32-байтовый seed
/// через BIP-39 PBKDF2, вычисляет Curve25519 ключевую пару.
///
/// Вся математика выполняется в фоновом потоке через `spawn_blocking`,
/// не блокируя основной поток WebView.
#[tauri::command]
pub async fn generate_keys_from_mnemonic(mnemonic_phrase: String) -> Result<KeyMaterial, String> {
    tokio::task::spawn_blocking(move || {
        // 1. Парсим мнемоническую фразу
        let mnemonic = Mnemonic::parse_in(Language::English, &mnemonic_phrase)
            .map_err(|e| format!("Invalid mnemonic: {}", e))?;

        // 2. Деривируем 512-битный seed через PBKDF2-HMAC-SHA256 (BIP-39)
        let seed = mnemonic.to_seed("");

        // 3. Берём первые 32 байта как приватный ключ (соответствует slice(0,32) в JS)
        let mut private_bytes = [0u8; 32];
        private_bytes.copy_from_slice(&seed[..32]);

        // 4. Вычисляем публичный ключ: public = basepoint * private (Curve25519)
        let private_scalar = StaticSecret::from(private_bytes);
        let public_point = PublicKey::from(&private_scalar);

        // 5. Кодируем в Base64
        let private_key_base64 = BASE64.encode(&private_bytes);
        let public_key_base64 = BASE64.encode(public_point.as_bytes());

        Ok(KeyMaterial {
            public_key: public_key_base64,
            private_key: private_key_base64,
            mnemonic: mnemonic.to_string(),
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}
