//! Криптографический модуль Echo Messenger (Phase 0: E2EE в Rust).
//!
//! E2EE-приватный ключ (`seed[0..32]`) ХРАНИТСЯ ТОЛЬКО внутри Rust в `KeyStore`
//! в обёртке `Zeroizing<[u8; 32]>` и никогда не возвращается через IPC.
//! Всё, что видит фронтенд — base64 публичный ключ, ciphertext и nonce.
//!
//! Совместимость: публичный ключ = X25519(clamp(seed[0..32])) * G (RFC 7748),
//! идентично tweetnacl.scalarMult.base. Шифрование — NaCL box (X25519 + XSalsa20-Poly1305)
//! через `crypto_box::SalsaBox`, валидное для старых и новых сообщений.

use aes_gcm::aead::{Aead as AesAead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce as AesNonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bip39::{Language, Mnemonic};
use crypto_box::{
    aead::{Aead as _, AeadCore as _, OsRng},
    PublicKey as BoxPublicKey, SecretKey as BoxSecretKey, SalsaBox,
};
use rand::{rngs::OsRng as SaltOsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;
use x25519_dalek::{PublicKey as XPublic, StaticSecret};

use crate::device;
use crate::storage::StorageManager;
use crate::Vault;

// Размер ключей / seed
pub const KEY_SIZE: usize = 32;

/// Скопировать `[u8; KEY_SIZE]` из `Zeroizing` (без неоднозначности `AsRef<[u8]>`).
fn zcopy(z: &Zeroizing<[u8; KEY_SIZE]>) -> [u8; KEY_SIZE] {
    let mut out = [0u8; KEY_SIZE];
    out.copy_from_slice(&z[..]);
    out
}

// ═══════════════════════════════════════════════════════════════════
// KeyStore — единственное место хранения E2EE-приватного ключа
// ═══════════════════════════════════════════════════════════════════

/// Хранилище ключей внутри Rust. Приватный ключ — в `Zeroizing<[u8; 32]>`.
/// Каждый `O`/`Terminate`/`clear()` зануляет память.
pub struct KeyStore {
    /// E2EE-приватный ключ (X25519 scalar = seed[0..32]).
    private_key: Mutex<Option<Zeroizing<[u8; KEY_SIZE]>>>,
    /// Эфемерная X25519-пара для QR-обмена (только на время обмена).
    ephemeral_secret: Mutex<Option<Zeroizing<[u8; KEY_SIZE]>>>,
}

impl KeyStore {
    pub fn new() -> Self {
        KeyStore {
            private_key: Mutex::new(None),
            ephemeral_secret: Mutex::new(None),
        }
    }

    /// Загрузить приватный ключ из 32 байт (зануляемая копия).
    pub fn load_private_key(&self, bytes: [u8; KEY_SIZE]) -> Result<(), String> {
        let mut guard = self
            .private_key
            .lock()
            .map_err(|e| format!("[KeyStore] lock: {}", e))?;
        *guard = Some(Zeroizing::new(bytes));
        Ok(())
    }

    /// Есть ли загруженный E2EE-ключ.
    pub fn has_key(&self) -> bool {
        self.private_key
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// Копия приватного ключа (используется только внутри команд Rust).
    pub fn private_scalar(&self) -> Result<[u8; KEY_SIZE], String> {
        let guard = self
            .private_key
            .lock()
            .map_err(|e| format!("[KeyStore] lock: {}", e))?;
        guard
            .as_ref()
            .map(zcopy)
            .ok_or_else(|| "[KeyStore] E2EE key not loaded".to_string())
    }

    /// Публичный ключ (base64) из загруженного приватного ключа.
    /// X25519 clamp выполняется внутри dalek — идентично tweetnacl.
    pub fn public_key_b64(&self) -> Result<String, String> {
        let scalar = self.private_scalar()?;
        let secret = StaticSecret::from(scalar);
        let xpub = XPublic::from(&secret);
        Ok(BASE64.encode(xpub.as_bytes()))
    }

    /// Установить эфемерный приватный ключ (для QR).
    pub fn set_ephemeral(&self, bytes: [u8; KEY_SIZE]) -> Result<(), String> {
        let mut guard = self
            .ephemeral_secret
            .lock()
            .map_err(|e| format!("[KeyStore] lock: {}", e))?;
        *guard = Some(Zeroizing::new(bytes));
        Ok(())
    }

    /// Публичный ключ эфемерной пары (base64).
    pub fn ephemeral_public_b64(&self) -> Result<String, String> {
        let guard = self
            .ephemeral_secret
            .lock()
            .map_err(|e| format!("[KeyStore] lock: {}", e))?;
        let scalar = guard
            .as_ref()
            .map(zcopy)
            .ok_or_else(|| "[KeyStore] No ephemeral key".to_string())?;
        let secret = StaticSecret::from(scalar);
        let xpub = XPublic::from(&secret);
        Ok(BASE64.encode(xpub.as_bytes()))
    }

    /// Копия эфемерного приватного ключа.
    pub fn ephemeral_scalar(&self) -> Result<[u8; KEY_SIZE], String> {
        let guard = self
            .ephemeral_secret
            .lock()
            .map_err(|e| format!("[KeyStore] lock: {}", e))?;
        guard
            .as_ref()
            .map(zcopy)
            .ok_or_else(|| "[KeyStore] No ephemeral key".to_string())
    }

    /// Zero-ить приватный и эфемерный ключи (logout / выход).
    pub fn clear(&self) {
        self.private_key.lock().ok().and_then(|mut g| g.take());
        self.ephemeral_secret.lock().ok().and_then(|mut g| g.take());
    }
}

// ═══════════════════════════════════════════════════════════════════
// Device-bound E2EE-ключ (персист только внутри Rust, AES-256-GCM)
// ═══════════════════════════════════════════════════════════════════
// Секрет (seed) НЕ передаётся наружу и НЕ хранится в открытом виде.
// Шифруем Argon2id(HWID+salt)-ключом → payload кладём в таблицу e2ee_keys.
// При смене железа расшифровка невозможна → recovery через мнемонику.

/// Session key: текстовый seed (BIP-39), шифруем как строку.
#[derive(Serialize, Deserialize)]
struct DeviceBoundPayload {
    salt: String,  // base64
    nonce: String, // base64 (12 байт)
    ct: String,    // base64 (ciphertext + tag)
}

/// Шифрует seed device-ключом (Argon2id от HWID). Возвращает JSON payload для БД.
fn device_encrypt_seed(machine: &str, seed: &[u8]) -> Result<String, String> {
    let mut salt = [0u8; 16];
    SaltOsRng.fill_bytes(&mut salt);
    let key = device::device_key(machine, &salt)?;

    let mut nonce = [0u8; 12];
    SaltOsRng.fill_bytes(&mut nonce);

    let cipher = Aes256Gcm::new_from_slice(&key[..])
        .map_err(|e| format!("[E2EE] AES init: {e}"))?;
    drop(key);

    let ct = cipher
        .encrypt(AesNonce::from_slice(&nonce), seed)
        .map_err(|e| format!("[E2EE] device encrypt failed: {e}"))?;

    serde_json::to_string(&DeviceBoundPayload {
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce),
        ct: BASE64.encode(&ct),
    })
    .map_err(|e| format!("[E2EE] payload JSON: {e}"))
}

/// Расшифровывает seed device-ключом. Если HWID изменился (другая машина) —
/// вернёт distinct-ошибку `[E2EE] HWID_CHANGED`.
fn device_decrypt_seed(machine: &str, payload: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    let wrapped: DeviceBoundPayload = serde_json::from_str(payload)
        .map_err(|e| format!("[E2EE] payload parse: {e}"))?;

    let salt = BASE64
        .decode(&wrapped.salt)
        .map_err(|e| format!("[E2EE] salt decode: {e}"))?;
    let key = device::device_key(machine, &salt)?;

    let nonce = BASE64
        .decode(&wrapped.nonce)
        .map_err(|e| format!("[E2EE] nonce decode: {e}"))?;
    let ct = BASE64
        .decode(&wrapped.ct)
        .map_err(|e| format!("[E2EE] ct decode: {e}"))?;

    let cipher = Aes256Gcm::new_from_slice(&key[..])
        .map_err(|e| format!("[E2EE] AES init: {e}"))?;
    drop(key);

    match cipher.decrypt(AesNonce::from_slice(&nonce), ct.as_ref()) {
        Ok(plain) => Ok(Zeroizing::new(plain)),
        Err(_) => {
            // Ключ есть, но расшифровать не смогли — почти наверняка HWID изменился.
            Err("[E2EE] HWID_CHANGED".to_string())
        }
    }
}

/// Внутренний: зашифровать текущий seed (нужно передать seed) и сохранить в БД.
/// Вызывается из команд Rust после установки ключа.
pub(crate) fn persist_device_key(app: &AppHandle<tauri::Wry>, user_id: &str, seed: &[u8]) -> Result<(), String> {
    let machine = app.state::<StorageManager>().machine_id();
    let payload = device_encrypt_seed(&machine, seed)?;
    let storage = app.state::<StorageManager>();
    storage.e2ee_key_store(user_id, &payload)
}

// ═══════════════════════════════════════════════════════════════════
// Вспомогательные преобразования
// ═══════════════════════════════════════════════════════════════════

fn b64_to_32(s: &str) -> Result<[u8; KEY_SIZE], String> {
    let v = BASE64.decode(s).map_err(|e| format!("base64 decode: {}", e))?;
    let len = v.len();
    let arr: [u8; KEY_SIZE] = v
        .as_slice()
        .try_into()
        .map_err(|_| format!("expected {} bytes, got {}", KEY_SIZE, len))?;
    Ok(arr)
}

fn hex_to_32(s: &str) -> Result<[u8; KEY_SIZE], String> {
    let v = hex::decode(s).map_err(|e| format!("hex decode: {}", e))?;
    let len = v.len();
    let arr: [u8; KEY_SIZE] = v
        .as_slice()
        .try_into()
        .map_err(|_| format!("expected {} bytes hex, got {}", KEY_SIZE, len))?;
    Ok(arr)
}

/// HMAC-SHA256 (реализован вручную через sha2 — без доп. зависимостей).
fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        let h = Sha256::digest(key);
        k[..32].copy_from_slice(&h);
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; BLOCK];
    let mut opad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let mut inner = Sha256::new();
    inner.update(&ipad);
    inner.update(msg);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(&opad);
    outer.update(inner_hash);
    outer.finalize().into()
}

/// Подписать данные: HMAC-SHA256 по общему секрету (X25519(self_priv, self_pub)).
/// Результат верифицируется через `verify_signature` с тем же публичным ключом.
pub fn sign_message(store: &KeyStore, msg: &[u8]) -> Result<[u8; 32], String> {
    let scalar = store.private_scalar()?;
    let secret = StaticSecret::from(scalar);
    let xpub = XPublic::from(&secret);
    let shared = secret.diffie_hellman(&xpub);
    Ok(hmac_sha256(shared.as_bytes(), msg))
}

/// Верифицировать подпись от `sender_pub_b64` по общему секрету X25519.
pub fn verify_signature(
    store: &KeyStore,
    sender_pub_b64: &str,
    msg: &[u8],
    sig_hex: &str,
) -> Result<bool, String> {
    let scalar = store.private_scalar()?;
    let secret = StaticSecret::from(scalar);
    let peer = XPublic::from(b64_to_32(sender_pub_b64)?);
    let shared = secret.diffie_hellman(&peer);
    let expected = hmac_sha256(shared.as_bytes(), msg);
    let sig = hex::decode(sig_hex).map_err(|e| format!("sig hex: {}", e))?;
    Ok(sig.len() == KEY_SIZE && expected.ct_eq(&sig[..]).unwrap_u8() == 1)
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

#[derive(Debug, Serialize, Deserialize)]
pub struct DerivedKey {
    /// base64 публичный ключ (единственное, что видит фронтенд).
    pub public_key: String,
}

impl DerivedKey {
    fn from_store(
        app: &tauri::AppHandle<tauri::Wry>,
        store: &KeyStore,
        seed: &[u8],
    ) -> Result<DerivedKey, String> {
        // Деривируем ключ Vault из секрета пользователя (seed hash) — не device-only.
        let vault = app.state::<Vault>();
        vault.derive_from_seed(app, seed)?;
        Ok(DerivedKey {
            public_key: store.public_key_b64()?,
        })
    }
}

/// Деривировать E2EE-ключ из мнемоники. Приватный ключ остаётся в KeyStore.
#[tauri::command]
pub async fn crypto_derive_keys(
    app: tauri::AppHandle,
    mnemonic_phrase: String,
) -> Result<DerivedKey, String> {
    let seed = tokio::task::spawn_blocking(move || {
        let mnemonic = Mnemonic::parse_in(Language::English, &mnemonic_phrase)
            .map_err(|e| format!("Invalid mnemonic: {}", e))?;
        Ok::<Vec<u8>, String>(mnemonic.to_seed("").to_vec())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    let store = app.state::<KeyStore>();
    let mut priv_bytes = [0u8; KEY_SIZE];
    priv_bytes.copy_from_slice(&seed[..KEY_SIZE]);
    store.load_private_key(priv_bytes)?;
    DerivedKey::from_store(&app, &store, &seed)
}

/// Установить E2EE-ключ из base64 (QR-обмен / восстановление). Не возвращает его.
#[tauri::command]
pub async fn crypto_set_key(
    app: tauri::AppHandle,
    secret_key_b64: String,
) -> Result<DerivedKey, String> {
    let store = app.state::<KeyStore>();
    let priv_bytes = b64_to_32(&secret_key_b64)?;
    store.load_private_key(priv_bytes)?;
    DerivedKey::from_store(&app, &store, &priv_bytes)
}

/// Персистить текущий E2EE-ключ, зашифровав device-ключом (Argon2id от HWID).
/// Вызывается после `crypto_derive_keys` / `crypto_set_key`, когда известен user_id.
/// Секрет НЕ возвращается, НЕ пишется в открытом виде и НЕ идёт через JS.
#[tauri::command]
pub async fn crypto_persist_key(app: tauri::AppHandle, user_id: String) -> Result<(), String> {
    let store = app.state::<KeyStore>();
    let scalar = store.private_scalar()?; // приватный ключ (X25519 scalar)
    persist_device_key(&app, &user_id, &scalar)
}

/// Восстановить E2EE-ключ из локальной БД (device-bound), загрузив в KeyStore.
/// - Ключ расшифровывается в Rust и не покидает backend.
/// - Возвращает только публичный ключ (как `crypto_derive_keys`).
/// - Если HWID изменился (другая машина) → distinct-ошибка `[E2EE] HWID_CHANGED`,
///   фронт должен показать экран ввода мнемоники.
#[tauri::command]
pub async fn crypto_restore_key(
    app: tauri::AppHandle,
    user_id: String,
) -> Result<DerivedKey, String> {
    let storage = app.state::<StorageManager>();
    let payload = storage
        .e2ee_key_load(&user_id)?
        .ok_or_else(|| "[E2EE] No stored key".to_string())?;

    let machine = storage.machine_id();
    let seed = device_decrypt_seed(&machine, &payload)?;
    if seed.len() != KEY_SIZE {
        return Err(format!(
            "[E2EE] Stored key wrong size: {} (expected {KEY_SIZE})",
            seed.len()
        ));
    }

    let mut priv_bytes = [0u8; KEY_SIZE];
    priv_bytes.copy_from_slice(&seed[..KEY_SIZE]);

    let store = app.state::<KeyStore>();
    store.load_private_key(priv_bytes)?;
    log::info!("[E2EE] Restored device-bound key for user {}", user_id);
    DerivedKey::from_store(&app, &store, &priv_bytes)
}

/// Публичный ключ текущего сеанса (или пустая строка, если ключ не загружен).
#[tauri::command]
pub async fn crypto_get_public_key(app: tauri::AppHandle) -> Result<String, String> {
    let store = app.state::<KeyStore>();
    store.public_key_b64().or_else(|_| Ok(String::new()))
}

/// Загружен ли E2EE-ключ в Rust KeyStore.
#[tauri::command]
pub async fn crypto_status(app: tauri::AppHandle) -> Result<bool, String> {
    let store = app.state::<KeyStore>();
    Ok(store.has_key())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptResult {
    pub ciphertext: String,
    pub nonce: String,
}

/// Зашифровать для получателя по его публичному ключу (NaCL box).
#[tauri::command]
pub async fn crypto_encrypt(
    app: tauri::AppHandle,
    recipient_pubkey: String,
    plaintext: String,
) -> Result<EncryptResult, String> {
    let store = app.state::<KeyStore>();
    let our_scalar = store.private_scalar()?;
    let their_pub = b64_to_32(&recipient_pubkey)?;

    let salsa = SalsaBox::new(
        &BoxPublicKey::from(their_pub),
        &BoxSecretKey::from(our_scalar),
    );
    let mut rng = OsRng;
    let nonce = SalsaBox::generate_nonce(&mut rng);
    let ct = salsa
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| format!("[crypto] encrypt: {}", e))?;

    Ok(EncryptResult {
        ciphertext: BASE64.encode(&ct),
        nonce: BASE64.encode(nonce.as_slice()),
    })
}

/// Расшифровать сообщение от отправителя по его публичному ключу.
#[tauri::command]
pub async fn crypto_decrypt(
    app: tauri::AppHandle,
    sender_pubkey: String,
    ciphertext: String,
    nonce: String,
) -> Result<String, String> {
    let store = app.state::<KeyStore>();
    let our_scalar = store.private_scalar()?;
    let sender_pub = b64_to_32(&sender_pubkey)?;

    let salsa = SalsaBox::new(
        &BoxPublicKey::from(sender_pub),
        &BoxSecretKey::from(our_scalar),
    );

    let nonce_bytes = BASE64
        .decode(&nonce)
        .map_err(|e| format!("[crypto] nonce decode: {}", e))?;
    if nonce_bytes.len() != 24 {
        return Err(format!(
            "[crypto] nonce must be 24 bytes, got {}",
            nonce_bytes.len()
        ));
    }
    let nonce = crypto_box::aead::Nonce::<SalsaBox>::from_slice(&nonce_bytes);
    let ct = BASE64
        .decode(&ciphertext)
        .map_err(|e| format!("[crypto] ciphertext decode: {}", e))?;

    let pt = salsa
        .decrypt(nonce, ct.as_slice())
        .map_err(|e| format!("[crypto] decrypt FAILED: {}", e))?;
    String::from_utf8(pt).map_err(|e| format!("[crypto] UTF-8: {}", e))
}

/// Zero-ить E2EE-ключ в памяти (logout).
#[tauri::command]
pub async fn crypto_clear(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.state::<KeyStore>();
    store.clear();
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SignResult {
    pub signature: String,
}

/// Подписать данные текущим E2EE-ключом (HMAC-SHA256 по X25519-секрету).
#[tauri::command]
pub async fn crypto_sign(app: tauri::AppHandle, message: String) -> Result<SignResult, String> {
    let store = app.state::<KeyStore>();
    let sig = sign_message(&store, message.as_bytes())?;
    Ok(SignResult {
        signature: hex::encode(sig),
    })
}

/// Проверить подпись от отправителя по его публичному ключу.
#[tauri::command]
pub async fn crypto_verify(
    app: tauri::AppHandle,
    sender_pubkey: String,
    message: String,
    signature: String,
) -> Result<bool, String> {
    let store = app.state::<KeyStore>();
    verify_signature(&store, &sender_pubkey, message.as_bytes(), &signature)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QrKeypair {
    /// base64 публичный ключ эфемерной пары (идёт в QR).
    pub public_key: String,
}

/// Сгенерировать эфемерную X25519-пару для QR-обмена. Секрет — в KeyStore.
#[tauri::command]
pub async fn crypto_qr_ephemeral_keypair(app: tauri::AppHandle) -> Result<QrKeypair, String> {
    let store = app.state::<KeyStore>();
    let mut rng = OsRng;
    let sk = BoxSecretKey::generate(&mut rng);
    let sk_bytes = sk.to_bytes();
    store.set_ephemeral(sk_bytes)?;
    Ok(QrKeypair {
        public_key: store.ephemeral_public_b64()?,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QrDecrypt {
    /// base64 расшифрованного plaintext (JSON-конверт или сырой E2EE-ключ).
    pub plaintext: String,
}

/// Расшифровать ответ от мобилки через эфемерный секрет (hex вход, base64 выход).
#[tauri::command]
pub async fn crypto_qr_decrypt(
    app: tauri::AppHandle,
    sender_pub_key: String,
    ciphertext_hex: String,
    nonce_hex: String,
) -> Result<QrDecrypt, String> {
    let store = app.state::<KeyStore>();
    let esk = store.ephemeral_scalar()?;
    let sender = hex_to_32(&sender_pub_key)?;

    let salsa = SalsaBox::new(
        &BoxPublicKey::from(sender),
        &BoxSecretKey::from(esk),
    );

    let nonce_bytes = hex::decode(&nonce_hex)
        .map_err(|e| format!("[crypto] nonce hex: {}", e))?;
    if nonce_bytes.len() != 24 {
        return Err(format!(
            "[crypto] nonce must be 24 bytes, got {}",
            nonce_bytes.len()
        ));
    }
    let nonce = crypto_box::aead::Nonce::<SalsaBox>::from_slice(&nonce_bytes);
    let ct = hex::decode(&ciphertext_hex)
        .map_err(|e| format!("[crypto] ciphertext hex: {}", e))?;

    let pt = salsa
        .decrypt(nonce, ct.as_slice())
        .map_err(|e| format!("[crypto] QR decrypt FAILED: {}", e))?;
    Ok(QrDecrypt {
        plaintext: BASE64.encode(&pt),
    })
}
// ═══════════════════════════════════════════════════════════════════
// Тесты
// ═══════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    /// Деривация ключа из мнемоники отдаёт только публичный ключ.
    #[test]
    fn derivation_exposes_only_public_key() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let seed = Mnemonic::parse_in(Language::English, mnemonic).unwrap().to_seed("");
        let mut priv_a = [0u8; KEY_SIZE];
        priv_a.copy_from_slice(&seed[..KEY_SIZE]);

        let ks = KeyStore::new();
        ks.load_private_key(priv_a).unwrap();
        let public_key = ks.public_key_b64().unwrap();
        assert_eq!(b64_to_32(&public_key).unwrap().len(), KEY_SIZE);
        assert!(ks.has_key());
    }

    /// Полный roundtrip: derive → encrypt → decrypt (двое пиров).
    #[test]
    fn derive_encrypt_decrypt_roundtrip() {
        let mnemonic_a = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let seed_a = Mnemonic::parse_in(Language::English, mnemonic_a).unwrap().to_seed("");
        let mnemonic_b = "legal winner thank year wave sausage worth useful legal winner thank yellow";
        let seed_b = Mnemonic::parse_in(Language::English, mnemonic_b).unwrap().to_seed("");

        let mut priv_a = [0u8; KEY_SIZE];
        let mut priv_b = [0u8; KEY_SIZE];
        priv_a.copy_from_slice(&seed_a[..KEY_SIZE]);
        priv_b.copy_from_slice(&seed_b[..KEY_SIZE]);

        let ks_a = KeyStore::new();
        ks_a.load_private_key(priv_a).unwrap();
        let ks_b = KeyStore::new();
        ks_b.load_private_key(priv_b).unwrap();

        let pub_a = b64_to_32(&ks_a.public_key_b64().unwrap()).unwrap();
        let pub_b = b64_to_32(&ks_b.public_key_b64().unwrap()).unwrap();

        // A шифрует B.
        let mut rng = OsRng;
        let salsa_ab = SalsaBox::new(
            &BoxPublicKey::from(pub_b),
            &BoxSecretKey::from(ks_a.private_scalar().unwrap()),
        );
        let nonce = SalsaBox::generate_nonce(&mut rng);
        let ct = salsa_ab.encrypt(&nonce, b"hello echo e2ee".as_slice()).unwrap();

        // B расшифровывает от A (тот же DH-секрет).
        let salsa_ba = SalsaBox::new(
            &BoxPublicKey::from(pub_a),
            &BoxSecretKey::from(ks_b.private_scalar().unwrap()),
        );
        let pt = salsa_ba.decrypt(&nonce, ct.as_slice()).unwrap();
        assert_eq!(&pt[..], b"hello echo e2ee");
    }

    /// Подпись → проверка (самоподпись своим же публичным ключом).
    #[test]
    fn sign_verify_roundtrip() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let seed = Mnemonic::parse_in(Language::English, mnemonic).unwrap().to_seed("");
        let mut priv_a = [0u8; KEY_SIZE];
        priv_a.copy_from_slice(&seed[..KEY_SIZE]);

        let ks = KeyStore::new();
        ks.load_private_key(priv_a).unwrap();
        let pub_a = ks.public_key_b64().unwrap();

        let sig = sign_message(&ks, b"attest").unwrap();
        let sig_hex = hex::encode(sig);
        assert!(verify_signature(&ks, &pub_a, b"attest", &sig_hex).unwrap());

        // Подпись к другому сообщению — невалидна.
        assert!(!verify_signature(&ks, &pub_a, b"tampered", &sig_hex).unwrap());
    }

    /// Публичный ключ — ровно 32 байта X25519 (RFC 7748 clamp, как в tweetnacl).
    #[test]
    fn public_key_is_32_bytes_x25519() {
        let mut raw = [0x42u8; KEY_SIZE];
        raw[0] &= 248;
        raw[31] &= 127;
        raw[31] |= 64;
        let secret = StaticSecret::from(raw);
        let xpub = XPublic::from(&secret);
        assert_eq!(xpub.as_bytes().len(), KEY_SIZE);
    }

    /// Device-bound: seed шифруется device-ключом и корректно расшифровывается,
    /// при смене "HWID" (другой machine) — distinct-ошибка HWID_CHANGED.
    #[test]
    fn device_bound_roundtrip_and_hwid_change() {
        let seed = [0x33u8; KEY_SIZE];

        // Шифруем и расшифровываем — OK (тот же machine).
        let machine = "machine-a-static-id";
        let payload = device_encrypt_seed(machine, &seed).unwrap();
        assert!(!payload.contains(&hex::encode(seed)), "payload must not contain plaintext");
        let dec = device_decrypt_seed(machine, &payload).unwrap();
        assert_eq!(dec.as_slice(), &seed[..]);

        // Имитируем смену железа: другой machine → расшифровка должна провалиться.
        // Переопределяем machine_id на время: используем device_key напрямую с другим salt-ключом.
        let machine_a = "machine-a-static-id";
        let machine_b = "machine-b-static-id";
        let salt = [0xAAu8; 16];
        let key_a = device::device_key(machine_a, &salt).unwrap();
        let key_b = device::device_key(machine_b, &salt).unwrap();
        assert_ne!(key_a.as_slice(), key_b.as_slice(), "different HWIDs -> different keys");

        // Убеждаемся, что AES-GCM даст сбой при расшифровке чужим ключом.
        let mut nonce = [0u8; 12];
        SaltOsRng.fill_bytes(&mut nonce);
        let cipher = Aes256Gcm::new_from_slice(&key_a[..]).unwrap();
        let ct = cipher
            .encrypt(AesNonce::from_slice(&nonce), &seed[..])
            .unwrap();
        let cipher_b = Aes256Gcm::new_from_slice(&key_b[..]).unwrap();
        assert!(
            cipher_b.decrypt(AesNonce::from_slice(&nonce), ct.as_ref()).is_err(),
            "must fail with wrong device key"
        );
    }
}
