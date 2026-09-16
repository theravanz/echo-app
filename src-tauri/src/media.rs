//! Шифрование медиафайлов Echo (Shield Media).
//!
//! Контекст: аватарки/треки/публикации/истории лежат в Supabase Storage и раньше
//! заливались в ПУБЛИЧНЫЕ bucket'ы под публичной ссылкой (`getPublicUrl`) — любой
//! мог скачать их по прямой ссылке. Теперь медиа шифруется ДО загрузки (Rust
//! шифрует, фронтенд грузит конверт, bucket'ы становятся приватными). Даже если
//! злоумышленник получит блоб — это AES-GCM шифротекст без ключа.
//!
//! Ключ: НЕ новый секрет. Медиа-ключ = HKDF-SHA256(ikm = E2EE seed[0..32],
//! info = "echo/media") из того же сида, что уже в Rust KeyStore (Zeroizing).
//! Это даёт привязку к устройству/аккаунту и ноль отдельного хранения ключа.
//!
//! Формат конверта: AES-256-GCM, nonce (12B) + ciphertext(= plaintext + 16B tag).
//! Через IPC передаётся base64 — нормально для аватарок/обложек (< 1 МБ).

use aes_gcm::aead::{Aead as AesAead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce as AesNonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hkdf::Hkdf;
use rand::{rngs::OsRng as SaltOsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, Manager};

use crate::crypto::{KeyStore, KEY_SIZE};

/// Domain-separation info для HKDF: media-ключ отделён от db-cipher и сообщений.
const MEDIA_KEY_INFO: &[u8] = b"echo/media";
/// Размер nonce для AES-256-GCM.
const NONCE_SIZE: usize = 12;

// DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaEnvelope {
    /// base64 nonce (12 байт).
    pub nonce: String,
    /// base64 ciphertext (+ 16-байтный GCM-тег).
    pub data: String,
}

/// Медиа-ключ из загруженного E2EE-сида. Детерминированный (HKDF), поэтому не
/// требует хранения; локальную копию сида зануляем после деривации.
fn media_key(store: &KeyStore) -> Result<[u8; KEY_SIZE], String> {
    let mut seed = store.private_scalar()?;
    let hk = Hkdf::<Sha256>::new(None, &seed[..]);
    let mut okm = [0u8; KEY_SIZE];
    hk.expand(MEDIA_KEY_INFO, &mut okm)
        .map_err(|e| format!("[Media] HKDF expand: {e}"))?;
    seed.fill(0);
    Ok(okm)
}

/// Зашифровать байты медиа. `plaintext_b64` — base64 исходных байт.
/// Возвращает конверт `{ nonce, data }` (base64) для загрузки в приватный bucket.
#[tauri::command]
pub async fn media_encrypt(
    app: tauri::AppHandle,
    plaintext_b64: String,
) -> Result<MediaEnvelope, String> {
    let store = app.state::<KeyStore>();
    let key = media_key(&store)?;

    let plaintext = BASE64
        .decode(&plaintext_b64)
        .map_err(|e| format!("[Media] decode plaintext: {e}"))?;

    let mut nonce_bytes = [0u8; NONCE_SIZE];
    SaltOsRng.fill_bytes(&mut nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(&key[..])
        .map_err(|e| format!("[Media] AES init: {e}"))?;

    let ct = cipher
        .encrypt(AesNonce::from_slice(&nonce_bytes), &plaintext[..])
        .map_err(|e| format!("[Media] encrypt failed: {e}"))?;

    Ok(MediaEnvelope {
        nonce: BASE64.encode(nonce_bytes),
        data: BASE64.encode(&ct),
    })
}

/// Расшифровать байты медиа. `nonce`/`data` — из конверта `media_encrypt`.
/// Возвращает base64 исходных байт.
#[tauri::command]
pub async fn media_decrypt(
    app: tauri::AppHandle,
    nonce: String,
    data: String,
) -> Result<String, String> {
    let store = app.state::<KeyStore>();
    let key = media_key(&store)?;

    let nonce_bytes = BASE64
        .decode(&nonce)
        .map_err(|e| format!("[Media] nonce decode: {e}"))?;
    if nonce_bytes.len() != NONCE_SIZE {
        return Err(format!(
            "[Media] nonce must be {} bytes, got {}",
            NONCE_SIZE,
            nonce_bytes.len(),
        ));
    }

    let ct = BASE64
        .decode(&data)
        .map_err(|e| format!("[Media] data decode: {e}"))?;

    let cipher = Aes256Gcm::new_from_slice(&key[..])
        .map_err(|e| format!("[Media] AES init: {e}"))?;

    let pt = cipher
        .decrypt(AesNonce::from_slice(&nonce_bytes), ct.as_ref())
        .map_err(|e| format!("[Media] decrypt failed (wrong key or tampered): {e}"))?;
    Ok(BASE64.encode(&pt))
}
// ═══ Тесты: roundtrip + отказ на чужом ключе (cargo test --lib media::tests) ═══

#[cfg(test)]
mod tests {
    use super::*;

    fn make_store(seed_byte: u8) -> KeyStore {
        let ks = KeyStore::new();
        let mut seed = [0u8; KEY_SIZE];
        seed.fill(seed_byte);
        ks.load_private_key(seed).unwrap();
        ks
    }

    #[test]
    fn media_key_is_deterministic_and_distinct() {
        let a = media_key(&make_store(0x11)).unwrap();
        let b = media_key(&make_store(0x11)).unwrap();
        let c = media_key(&make_store(0x22)).unwrap();
        assert_eq!(a.as_slice(), b.as_slice());
        assert_ne!(a.as_slice(), c.as_slice());
    }

    #[test]
    fn encrypt_decrypt_roundtrip_and_wrong_key_fails() {
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        SaltOsRng.fill_bytes(&mut nonce_bytes);

        let key_a = media_key(&make_store(0x11)).unwrap();
        let key_b = media_key(&make_store(0x22)).unwrap();
        let plaintext = "hello echo media".as_bytes();

        let cipher_a = Aes256Gcm::new_from_slice(&key_a[..]).unwrap();
        let ct = cipher_a
            .encrypt(AesNonce::from_slice(&nonce_bytes), plaintext)
            .unwrap();

        // Правильный ключ — расшифровывается.
        let cipher_a2 = Aes256Gcm::new_from_slice(&key_a[..]).unwrap();
        let pt = cipher_a2
            .decrypt(AesNonce::from_slice(&nonce_bytes), ct.as_ref())
            .unwrap();
        assert_eq!(&pt[..], plaintext);

        // Чужой ключ — GCM-тег не сойдётся, падаем.
        let cipher_b = Aes256Gcm::new_from_slice(&key_b[..]).unwrap();
        assert!(cipher_b.decrypt(AesNonce::from_slice(&nonce_bytes), ct.as_ref()).is_err());
    }
}

/// Доступен ли медиа-ключ (E2EE-сид загружен в KeyStore)?
#[tauri::command]
pub async fn media_key_status(app: tauri::AppHandle) -> Result<bool, String> {
    let store = app.state::<KeyStore>();
    Ok(store.has_key())
}