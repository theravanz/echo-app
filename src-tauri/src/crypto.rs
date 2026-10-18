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
    PublicKey as BoxPublicKey, SalsaBox, SecretKey as BoxSecretKey,
};
use rand::{rngs::OsRng as SaltOsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Manager};
use x25519_dalek::{PublicKey as XPublic, StaticSecret};
use zeroize::Zeroizing;

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

    let cipher =
        Aes256Gcm::new_from_slice(&key[..]).map_err(|e| format!("[E2EE] AES init: {e}"))?;
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
    let wrapped: DeviceBoundPayload =
        serde_json::from_str(payload).map_err(|e| format!("[E2EE] payload parse: {e}"))?;

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

    let cipher =
        Aes256Gcm::new_from_slice(&key[..]).map_err(|e| format!("[E2EE] AES init: {e}"))?;
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
pub(crate) fn persist_device_key(
    app: &AppHandle<tauri::Wry>,
    user_id: &str,
    seed: &[u8],
) -> Result<(), String> {
    let machine = app.state::<StorageManager>().machine_id();
    let payload = device_encrypt_seed(&machine, seed)?;
    let storage = app.state::<StorageManager>();
    storage.e2ee_key_store(user_id, &payload)
}

// ═══════════════════════════════════════════════════════════════════
// Вспомогательные преобразования
// ═══════════════════════════════════════════════════════════════════

fn b64_to_32(s: &str) -> Result<[u8; KEY_SIZE], String> {
    let v = BASE64
        .decode(s)
        .map_err(|e| format!("base64 decode: {}", e))?;
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

// ═══════════════════════════════════════════════════════════════════
// v:2 raw-bytes медиа (голосовые/файлы): NaCL box над СЫРЫМИ байтами
// ═══════════════════════════════════════════════════════════════════
// Формат хранения v:2 = plaintext это сырые байты медиа (НЕ base64-строка).
// Транспорт выбирается по платформе, криптология — ОДНА (encrypt_inner/
// decrypt_inner), поэтому шифротекст идентичен на всех платформах:
//   • desktop/iOS — raw IPC: тело запроса/ответа — сырые байты
//     (tauri::ipc::Request / tauri::ipc::Response);
//   • Android    — JSON+base64: raw-тело запроса там невозможно
//     (tauri всегда отдаёт InvokeBody::Json, см. docs InvokeBody).
// Старые медиа (base64-plaintext) читаются legacy-командами crypto_decrypt.

/// Размер nonce NaCL box (XSalsa20-Poly1305).
pub const NONCE_SIZE: usize = 24;

/// Разобрать raw-тело `crypto_encrypt_bytes`: `[32B recipient_pubkey][plaintext...]`.
fn parse_encrypt_body(body: &[u8]) -> Result<([u8; KEY_SIZE], &[u8]), String> {
    if body.len() < KEY_SIZE {
        return Err(format!(
            "[crypto] encrypt body must be [{KEY_SIZE}B pubkey][plaintext], got {} bytes",
            body.len()
        ));
    }
    let (pub_bytes, plain) = body.split_at(KEY_SIZE);
    let mut pub32 = [0u8; KEY_SIZE];
    pub32.copy_from_slice(pub_bytes);
    Ok((pub32, plain))
}

/// Разобрать raw-тело `crypto_decrypt_bytes`: `[32B sender_pubkey][24B nonce][ciphertext]`.
fn parse_decrypt_body(body: &[u8]) -> Result<([u8; KEY_SIZE], [u8; NONCE_SIZE], &[u8]), String> {
    const HEAD: usize = KEY_SIZE + NONCE_SIZE;
    if body.len() < HEAD {
        return Err(format!(
            "[crypto] decrypt body must be [{KEY_SIZE}B pubkey][{NONCE_SIZE}B nonce][ciphertext], got {} bytes",
            body.len()
        ));
    }
    let (pub_bytes, rest) = body.split_at(KEY_SIZE);
    let (nonce_bytes, ct) = rest.split_at(NONCE_SIZE);
    let mut pub32 = [0u8; KEY_SIZE];
    pub32.copy_from_slice(pub_bytes);
    let mut nonce24 = [0u8; NONCE_SIZE];
    nonce24.copy_from_slice(nonce_bytes);
    Ok((pub32, nonce24, ct))
}

/// base64 nonce → ровно 24 байта (формат ошибки как у `crypto_decrypt`).
fn b64_to_nonce(s: &str) -> Result<[u8; NONCE_SIZE], String> {
    let v = BASE64
        .decode(s)
        .map_err(|e| format!("[crypto] nonce decode: {}", e))?;
    if v.len() != NONCE_SIZE {
        return Err(format!(
            "[crypto] nonce must be {NONCE_SIZE} bytes, got {}",
            v.len()
        ));
    }
    let mut out = [0u8; NONCE_SIZE];
    out.copy_from_slice(&v);
    Ok(out)
}

/// Общая криптология raw- и json-вариантов: NaCL box на публичный ключ.
/// nonce инжектируется — тесты доказывают платформо-независимость v:2.
fn encrypt_inner_with_nonce(
    store: &KeyStore,
    their_pub: [u8; KEY_SIZE],
    nonce_bytes: [u8; NONCE_SIZE],
    plain: &[u8],
) -> Result<Vec<u8>, String> {
    let our_scalar = store.private_scalar()?;
    let salsa = SalsaBox::new(
        &BoxPublicKey::from(their_pub),
        &BoxSecretKey::from(our_scalar),
    );
    let nonce = crypto_box::aead::Nonce::<SalsaBox>::from_slice(&nonce_bytes);
    salsa
        .encrypt(nonce, plain)
        .map_err(|e| format!("[crypto] encrypt: {}", e))
}

/// Зашифровать СЫРЫЕ байты, сгенерировав nonce через OsRng (как `crypto_encrypt`).
fn encrypt_inner(
    store: &KeyStore,
    their_pub: [u8; KEY_SIZE],
    plain: &[u8],
) -> Result<([u8; NONCE_SIZE], Vec<u8>), String> {
    let mut rng = OsRng;
    let nonce = SalsaBox::generate_nonce(&mut rng);
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    nonce_bytes.copy_from_slice(nonce.as_slice());
    let ct = encrypt_inner_with_nonce(store, their_pub, nonce_bytes, plain)?;
    Ok((nonce_bytes, ct))
}

/// Расшифровать СЫРЫЕ байты. Плейнтекст — `Zeroizing` (зануляется при drop).
/// БЕЗ `String::from_utf8`: медиа — произвольные байты, не текст.
fn decrypt_inner(
    store: &KeyStore,
    sender_pub: [u8; KEY_SIZE],
    nonce_bytes: [u8; NONCE_SIZE],
    ct: &[u8],
) -> Result<Zeroizing<Vec<u8>>, String> {
    let our_scalar = store.private_scalar()?;
    let salsa = SalsaBox::new(
        &BoxPublicKey::from(sender_pub),
        &BoxSecretKey::from(our_scalar),
    );
    let nonce = crypto_box::aead::Nonce::<SalsaBox>::from_slice(&nonce_bytes);
    let pt = salsa
        .decrypt(nonce, ct)
        .map_err(|e| format!("[crypto] decrypt FAILED: {}", e))?;
    Ok(Zeroizing::new(pt))
}

/// Зашифровать СЫРЫЕ байты медиа (v:2) через raw IPC.
/// Тело: `[32B recipient_pubkey][plaintext]`; ответ: `[24B nonce][ciphertext]`.
/// Платформы без raw IPC (Android) используют `crypto_encrypt_bytes_json`.
#[tauri::command]
pub async fn crypto_encrypt_bytes(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let body = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err(
                "[crypto] crypto_encrypt_bytes requires a raw bytes body (use crypto_encrypt_bytes_json on Android)"
                    .to_string(),
            )
        }
    };

    let store = app.state::<KeyStore>();
    let (their_pub, plain) = parse_encrypt_body(body)?;
    let (nonce_bytes, ct) = encrypt_inner(&store, their_pub, plain)?;

    let mut out = Vec::with_capacity(NONCE_SIZE + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(tauri::ipc::Response::new(out))
}

/// Расшифровать СЫРЫЕ байты медиа (v:2) через raw IPC.
/// Тело: `[32B sender_pubkey][24B nonce][ciphertext]`; ответ: plaintext (сырые байты).
#[tauri::command]
pub async fn crypto_decrypt_bytes(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let body = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err(
                "[crypto] crypto_decrypt_bytes requires a raw bytes body (use crypto_decrypt_bytes_json on Android)"
                    .to_string(),
            )
        }
    };

    let store = app.state::<KeyStore>();
    let (sender_pub, nonce_bytes, ct) = parse_decrypt_body(body)?;
    let pt = decrypt_inner(&store, sender_pub, nonce_bytes, ct)?;
    Ok(tauri::ipc::Response::new(pt.to_vec()))
}

/// JSON+base64 вариант `crypto_encrypt_bytes` (Android: raw-тело невозможно).
/// Криптология идентична raw-варианту — общий `encrypt_inner`, поэтому v:2
/// шифротекст совпадает байт-в-байт при одинаковом nonce.
#[tauri::command]
pub async fn crypto_encrypt_bytes_json(
    app: tauri::AppHandle,
    recipient_pubkey: String,
    plaintext: String,
) -> Result<EncryptResult, String> {
    let store = app.state::<KeyStore>();
    let their_pub = b64_to_32(&recipient_pubkey)?;
    let plain = Zeroizing::new(
        BASE64
            .decode(&plaintext)
            .map_err(|e| format!("[crypto] plaintext decode: {}", e))?,
    );

    let (nonce_bytes, ct) = encrypt_inner(&store, their_pub, &plain)?;
    Ok(EncryptResult {
        ciphertext: BASE64.encode(&ct),
        nonce: BASE64.encode(nonce_bytes),
    })
}

/// JSON+base64 вариант `crypto_decrypt_bytes` (Android).
/// Возвращает base64 СЫРЫХ байт — `String::from_utf8` здесь запрещён.
#[tauri::command]
pub async fn crypto_decrypt_bytes_json(
    app: tauri::AppHandle,
    sender_pubkey: String,
    nonce: String,
    ciphertext: String,
) -> Result<String, String> {
    let store = app.state::<KeyStore>();
    let sender_pub = b64_to_32(&sender_pubkey)?;
    let nonce_bytes = b64_to_nonce(&nonce)?;
    let ct = Zeroizing::new(
        BASE64
            .decode(&ciphertext)
            .map_err(|e| format!("[crypto] ciphertext decode: {}", e))?,
    );

    let pt = decrypt_inner(&store, sender_pub, nonce_bytes, &ct)?;
    Ok(BASE64.encode(&pt))
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

    let salsa = SalsaBox::new(&BoxPublicKey::from(sender), &BoxSecretKey::from(esk));

    let nonce_bytes = hex::decode(&nonce_hex).map_err(|e| format!("[crypto] nonce hex: {}", e))?;
    if nonce_bytes.len() != 24 {
        return Err(format!(
            "[crypto] nonce must be 24 bytes, got {}",
            nonce_bytes.len()
        ));
    }
    let nonce = crypto_box::aead::Nonce::<SalsaBox>::from_slice(&nonce_bytes);
    let ct = hex::decode(&ciphertext_hex).map_err(|e| format!("[crypto] ciphertext hex: {}", e))?;

    let pt = salsa
        .decrypt(nonce, ct.as_slice())
        .map_err(|e| format!("[crypto] QR decrypt FAILED: {}", e))?;
    Ok(QrDecrypt {
        plaintext: BASE64.encode(&pt),
    })
}
// ═══════════════════════════════════════════════════════════════════
// Группы (Zero-Knowledge): генерация сида + KDF + упаковка ключей
// ═══════════════════════════════════════════════════════════════════
// Сервер — «слепой» ретранслятор: Name/Bio и групповые сиды он видит только
// в шифротексте. Вся криптография — здесь, в Rust (ключи не покидают backend):
//   1. Group Master Seed — 32 случайных байта (OsRng).
//   2. KDF: HKDF-SHA256(seed, info) — domain-separated ключи:
//        "echo/group/info" → Info_Key (метаданные Name/Bio/avatar),
//        "echo/group/msg0" → Message_Key_0 (первый ключ цепочки сообщений).

use hkdf::Hkdf;

/// Domain-separation info для группового KDF (HKDF-SHA256).
const GROUP_INFO_KEY_INFO: &[u8] = b"echo/group/info";
const GROUP_MSG0_KEY_INFO: &[u8] = b"echo/group/msg0";

/// HKDF-SHA256(seed, info) → 32 байта. Seed зануляется вызывающим кодом.
fn group_kdf(seed: &[u8; KEY_SIZE], info: &[u8]) -> Result<[u8; KEY_SIZE], String> {
    let hk = Hkdf::<Sha256>::new(None, &seed[..]);
    let mut okm = [0u8; KEY_SIZE];
    hk.expand(info, &mut okm)
        .map_err(|e| format!("[Group] HKDF expand: {e}"))?;
    Ok(okm)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupSeedBundle {
    /// base64 Group Master Seed (32B) — нужен фронту ТОЛЬКО для локального
    /// сохранения в зашифрованное хранилище; на сервер не уходит.
    pub seed: String,
    /// base64 Info_Key (HKDF "echo/group/info").
    pub info_key: String,
    /// base64 Message_Key_0 (HKDF "echo/group/msg0").
    pub msg_key_0: String,
}

/// Шаг 1–2: сгенерировать Group Master Seed + вывести Info_Key / Message_Key_0.
#[tauri::command]
pub async fn group_gen_seed() -> Result<GroupSeedBundle, String> {
    tokio::task::spawn_blocking(|| {
        let mut rng = SaltOsRng;
        let mut seed = [0u8; KEY_SIZE];
        rng.fill_bytes(&mut seed);
        let info_key = group_kdf(&seed, GROUP_INFO_KEY_INFO)?;
        let msg_key_0 = group_kdf(&seed, GROUP_MSG0_KEY_INFO)?;
        let out = GroupSeedBundle {
            seed: BASE64.encode(seed),
            info_key: BASE64.encode(info_key),
            msg_key_0: BASE64.encode(msg_key_0),
        };
        seed.fill(0);
        Ok(out)
    })
    .await
    .map_err(|e| format!("[Group] task: {e}"))?
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupSealedBox {
    pub ciphertext: String,
    pub nonce: String,
    /// base64 эфемерного X25519-публичного ключа (нужен получателю для DH).
    pub eph_pub: String,
}

/// Шаг 3: зашифровать метаданные группы (JSON UTF-8, base64 на входе).
/// Шифрование — Info_Key через SalsaBox с эфемерной X25519-парой; результат
/// идёт в Edge Function как encrypted_metadata/metadata_nonce.
#[tauri::command]
pub async fn group_seal_metadata(
    app: tauri::AppHandle,
    info_key_b64: String,
    metadata_b64: String,
) -> Result<GroupSealedBox, String> {
    let store = app.state::<KeyStore>();
    // Привязка к сессии: ключ должен быть загружен (создатель авторизован).
    if !store.has_key() {
        return Err("[Group] E2EE key not loaded".to_string());
    }
    let info_key = b64_to_32(&info_key_b64)?;
    let metadata = BASE64
        .decode(&metadata_b64)
        .map_err(|e| format!("[Group] metadata decode: {e}"))?;
    // Self-box: получатель = собственный публичный ключ. SalsaBox строится
    // от info_key как «приватного» скаляра: X25519-clamp в dalek
    // детерминирован, seal/open получат тот же DH и расшифровка сойдётся
    // тем же info_key (см. group_open_metadata — следующая итерация).
    let scalar = store.private_scalar()?;
    let secret = StaticSecret::from(scalar);
    let self_pub = XPublic::from(&secret);
    let salsa = SalsaBox::new(
        &BoxPublicKey::from(*self_pub.as_bytes()),
        &BoxSecretKey::from(info_key),
    );
    let mut rng = OsRng;
    let nonce = SalsaBox::generate_nonce(&mut rng);
    let ct = salsa
        .encrypt(&nonce, metadata.as_slice())
        .map_err(|e| format!("[Group] metadata seal: {e:?}"))?;
    Ok(GroupSealedBox {
        ciphertext: BASE64.encode(&ct),
        nonce: BASE64.encode(nonce.as_slice()),
        eph_pub: store.public_key_b64()?,
    })
}

/// Шаг 4: упаковать Group Master Seed + ключи для одного участника.
/// DH: собственный приватный ключ (KeyStore, не покидает Rust) +
/// публичный X25519 участника. Пакет = JSON { seed, info_key, msg_key_0,
/// chain_index: 0 } (base64-поля), зашифрованный SalsaBox.
#[tauri::command]
pub async fn group_seal_key_packet(
    app: tauri::AppHandle,
    recipient_pubkey: String,
    seed_b64: String,
    info_key_b64: String,
    msg_key_0_b64: String,
) -> Result<GroupSealedBox, String> {
    let store = app.state::<KeyStore>();
    let our_scalar = store.private_scalar()?;
    let their_pub = b64_to_32(&recipient_pubkey)?;
    // Валидируем формат входных ключей (ровно 32B base64), содержимое не логируем.
    let seed = b64_to_32(&seed_b64)?;
    let info_key = b64_to_32(&info_key_b64)?;
    let msg_key_0 = b64_to_32(&msg_key_0_b64)?;
    let packet = serde_json::json!({
        "seed": BASE64.encode(seed),
        "info_key": BASE64.encode(info_key),
        "msg_key_0": BASE64.encode(msg_key_0),
        "chain_index": 0,
    });
    let message = serde_json::to_vec(&packet)
        .map_err(|e| format!("[Group] packet JSON: {e}"))?;
    let salsa = SalsaBox::new(
        &BoxPublicKey::from(their_pub),
        &BoxSecretKey::from(our_scalar),
    );
    let mut rng = OsRng;
    let nonce = SalsaBox::generate_nonce(&mut rng);
    let ct = salsa
        .encrypt(&nonce, message.as_slice())
        .map_err(|e| format!("[Group] packet seal: {e:?}"))?;
    Ok(GroupSealedBox {
        ciphertext: BASE64.encode(&ct),
        nonce: BASE64.encode(nonce.as_slice()),
        eph_pub: store.public_key_b64()?,
    })
}

/// Расшифровать пакет ключей из group_key_mailbox (первый вход участника).
/// SalsaBox(пакет_от_создателя = DH(creator_priv, member_pub); здесь обратное:
/// DH(member_priv, creator_pub)) — тот же общий секрет. `sender_pub_b64` —
/// публичный ключ создателя (profiles.public_key[creator_id]).
#[tauri::command]
pub async fn group_open_key_packet(
    app: tauri::AppHandle,
    sender_pub_b64: String,
    ciphertext_b64: String,
    nonce_b64: String,
) -> Result<GroupSeedBundle, String> {
    let store = app.state::<KeyStore>();
    let our_scalar = store.private_scalar()?;
    let sender_pub = b64_to_32(&sender_pub_b64)?;
    let salsa = SalsaBox::new(
        &BoxPublicKey::from(sender_pub),
        &BoxSecretKey::from(our_scalar),
    );
    let nonce_bytes = BASE64
        .decode(&nonce_b64)
        .map_err(|e| format!("[Group] packet nonce decode: {e}"))?;
    if nonce_bytes.len() != 24 {
        return Err(format!("[Group] packet nonce must be 24 bytes, got {}", nonce_bytes.len()));
    }
    let nonce = crypto_box::aead::Nonce::<SalsaBox>::from_slice(&nonce_bytes);
    let ct = BASE64
        .decode(&ciphertext_b64)
        .map_err(|e| format!("[Group] packet ct decode: {e}"))?;
    let pt = salsa
        .decrypt(nonce, ct.as_slice())
        .map_err(|e| format!("[Group] packet open FAILED: {e:?}"))?;
    // JSON { seed, info_key, msg_key_0, chain_index }.
    let v: serde_json::Value = serde_json::from_slice(&pt)
        .map_err(|e| format!("[Group] packet JSON: {e}"))?;
    let get = |k: &str| -> Result<String, String> {
        v.get(k).and_then(|x| x.as_str()).map(String::from)
            .ok_or_else(|| format!("[Group] packet missing field {k}"))
    };
    Ok(GroupSeedBundle {
        seed: get("seed")?,
        info_key: get("info_key")?,
        msg_key_0: get("msg_key_0")?,
    })
}

/// Расшифровать метаданные группы Info_Key. Тот же бокс, что при seal:
/// shared = DH(clamp(info_key), creator_pub). `sender_pub_b64` — публичный
/// ключ создателя (нужен для восстановления идентичного общего секрета).
#[tauri::command]
pub async fn group_open_metadata(
    info_key_b64: String,
    sender_pub_b64: String,
    metadata_ct_b64: String,
    nonce_b64: String,
) -> Result<String, String> {
    let info_key = b64_to_32(&info_key_b64)?;
    let sender_pub = b64_to_32(&sender_pub_b64)?;
    let salsa = SalsaBox::new(
        &BoxPublicKey::from(sender_pub),
        &BoxSecretKey::from(info_key),
    );
    let nonce_bytes = BASE64
        .decode(&nonce_b64)
        .map_err(|e| format!("[Group] metadata nonce decode: {e}"))?;
    if nonce_bytes.len() != 24 {
        return Err(format!("[Group] metadata nonce must be 24 bytes, got {}", nonce_bytes.len()));
    }
    let nonce = crypto_box::aead::Nonce::<SalsaBox>::from_slice(&nonce_bytes);
    let ct = BASE64
        .decode(&metadata_ct_b64)
        .map_err(|e| format!("[Group] metadata ct decode: {e}"))?;
    let pt = salsa
        .decrypt(nonce, ct.as_slice())
        .map_err(|e| format!("[Group] metadata open FAILED: {e:?}"))?;
    String::from_utf8(pt).map_err(|e| format!("[Group] metadata UTF-8: {e}"))
}

// ═══════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    /// Деривация ключа из мнемоники отдаёт только публичный ключ.
    #[test]
    fn derivation_exposes_only_public_key() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let seed = Mnemonic::parse_in(Language::English, mnemonic)
            .unwrap()
            .to_seed("");
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
        let seed_a = Mnemonic::parse_in(Language::English, mnemonic_a)
            .unwrap()
            .to_seed("");
        let mnemonic_b =
            "legal winner thank year wave sausage worth useful legal winner thank yellow";
        let seed_b = Mnemonic::parse_in(Language::English, mnemonic_b)
            .unwrap()
            .to_seed("");

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
        let ct = salsa_ab
            .encrypt(&nonce, b"hello echo e2ee".as_slice())
            .unwrap();

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
        let seed = Mnemonic::parse_in(Language::English, mnemonic)
            .unwrap()
            .to_seed("");
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
        assert!(
            !payload.contains(&hex::encode(seed)),
            "payload must not contain plaintext"
        );
        let dec = device_decrypt_seed(machine, &payload).unwrap();
        assert_eq!(dec.as_slice(), &seed[..]);

        // Имитируем смену железа: другой machine → расшифровка должна провалиться.
        // Переопределяем machine_id на время: используем device_key напрямую с другим salt-ключом.
        let machine_a = "machine-a-static-id";
        let machine_b = "machine-b-static-id";
        let salt = [0xAAu8; 16];
        let key_a = device::device_key(machine_a, &salt).unwrap();
        let key_b = device::device_key(machine_b, &salt).unwrap();
        assert_ne!(
            key_a.as_slice(),
            key_b.as_slice(),
            "different HWIDs -> different keys"
        );

        // Убеждаемся, что AES-GCM даст сбой при расшифровке чужим ключом.
        let mut nonce = [0u8; 12];
        SaltOsRng.fill_bytes(&mut nonce);
        let cipher = Aes256Gcm::new_from_slice(&key_a[..]).unwrap();
        let ct = cipher
            .encrypt(AesNonce::from_slice(&nonce), &seed[..])
            .unwrap();
        let cipher_b = Aes256Gcm::new_from_slice(&key_b[..]).unwrap();
        assert!(
            cipher_b
                .decrypt(AesNonce::from_slice(&nonce), ct.as_ref())
                .is_err(),
            "must fail with wrong device key"
        );
    }
    // ─── v:2 raw-bytes медиа: raw/json транспорты, инварианты, legacy ───

    /// Два пира с детерминированными ключами + их публичные ключи (32B).
    fn two_peers() -> (KeyStore, KeyStore, [u8; KEY_SIZE], [u8; KEY_SIZE]) {
        let ks_a = KeyStore::new();
        let ks_b = KeyStore::new();
        let mut seed_a = [0x11u8; KEY_SIZE];
        let mut seed_b = [0x22u8; KEY_SIZE];
        seed_a[0] ^= 0x5A;
        seed_b[0] ^= 0xA5;
        ks_a.load_private_key(seed_a).unwrap();
        ks_b.load_private_key(seed_b).unwrap();
        let pub_a = b64_to_32(&ks_a.public_key_b64().unwrap()).unwrap();
        let pub_b = b64_to_32(&ks_b.public_key_b64().unwrap()).unwrap();
        (ks_a, ks_b, pub_a, pub_b)
    }

    /// Псевдослучайные байты (детерминированно, без внешних крейтов).
    fn random_bytes(len: usize) -> Vec<u8> {
        let mut x: u64 = 0x2545_F491_4F6C_DD1D;
        (0..len)
            .map(|_| {
                x = x
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                (x >> 33) as u8
            })
            .collect()
    }

    /// raw-транспорт 10 МБ: тело `[32B pub][plain]` → ответ `[24B nonce][ct]` → назад.
    #[test]
    fn bytes_raw_roundtrip_10mb() {
        let (ks_a, ks_b, pub_a, pub_b) = two_peers();
        let plain = random_bytes(10 * 1024 * 1024);

        // JS собирает raw-тело: [recipient_pubkey][plaintext]
        let mut body = Vec::with_capacity(KEY_SIZE + plain.len());
        body.extend_from_slice(&pub_b);
        body.extend_from_slice(&plain);

        let (their_pub, parsed_plain) = parse_encrypt_body(&body).unwrap();
        assert_eq!(their_pub, pub_b);
        assert_eq!(parsed_plain, &plain[..]);

        let (nonce, ct) = encrypt_inner(&ks_a, their_pub, parsed_plain).unwrap();
        assert_eq!(ct.len(), plain.len() + 16, "box добавляет 16B Poly1305-тега");

        // Rust отвечает raw-телом: [nonce][ciphertext]
        let resp = {
            let mut r = Vec::with_capacity(NONCE_SIZE + ct.len());
            r.extend_from_slice(&nonce);
            r.extend_from_slice(&ct);
            r
        };
        // JS режет ответ как [24B nonce][ct]: nonce → мета (base64), ct → Storage.
        assert_eq!(&resp[..NONCE_SIZE], &nonce[..]);
        let cipher_from_response = &resp[NONCE_SIZE..];
        assert_eq!(cipher_from_response, &ct[..]);
        // Storage-объект: ровно ciphertext (plaintext + 16B тега), без заголовков.
        assert_eq!(cipher_from_response.len(), plain.len() + 16);

        // JS собирает тело decrypt: [sender_pubkey][nonce][ciphertext]
        let mut dec_body = Vec::with_capacity(KEY_SIZE + NONCE_SIZE + cipher_from_response.len());
        dec_body.extend_from_slice(&pub_a);
        dec_body.extend_from_slice(&nonce);
        dec_body.extend_from_slice(cipher_from_response);

        let (sender_pub, nonce24, ct_parsed) = parse_decrypt_body(&dec_body).unwrap();
        assert_eq!(sender_pub, pub_a);
        assert_eq!(nonce24, nonce);
        let pt = decrypt_inner(&ks_b, sender_pub, nonce24, ct_parsed).unwrap();
        assert_eq!(pt.as_slice(), &plain[..]);
    }

    /// json-транспорт (Android) 10 МБ: та же криптология, base64 на входе/выходе.
    #[test]
    fn bytes_json_roundtrip_10mb() {
        let (ks_a, ks_b, pub_a, pub_b) = two_peers();
        let plain = random_bytes(10 * 1024 * 1024);

        // Android-команда: base64 → decode → encrypt_inner
        let decoded = BASE64.decode(&BASE64.encode(&plain)).unwrap();
        let (nonce, ct) = encrypt_inner(&ks_a, pub_b, &decoded).unwrap();

        // Ответ — base64 СЫРЫХ байт (никакого from_utf8)
        let ct_back = BASE64.decode(&BASE64.encode(&ct)).unwrap();
        let nonce_back = b64_to_nonce(&BASE64.encode(nonce)).unwrap();

        let pt = decrypt_inner(&ks_b, pub_a, nonce_back, &ct_back).unwrap();
        assert_eq!(pt.as_slice(), &plain[..]);
    }

    /// КРОСС-инвариант: raw- и json-транспорты дают ОДИН шифротекст при одном
    /// nonce — доказательство платформо-независимости v:2.
    #[test]
    fn raw_and_json_transports_produce_identical_ciphertext() {
        let (ks_a, _ks_b, _pub_a, pub_b) = two_peers();
        let plain = random_bytes(256 * 1024);
        let nonce = [0x5Au8; NONCE_SIZE];

        // raw: plaintext идёт байтами; json: plaintext идёт base64-строкой.
        let ct_raw = encrypt_inner_with_nonce(&ks_a, pub_b, nonce, &plain).unwrap();
        let decoded = BASE64.decode(&BASE64.encode(&plain)).unwrap();
        let ct_json = encrypt_inner_with_nonce(&ks_a, pub_b, nonce, &decoded).unwrap();

        assert_eq!(ct_raw, ct_json);
        assert_eq!(BASE64.encode(&ct_raw), BASE64.encode(&ct_json));
    }

    /// Чужой ключ → aead::Error (тег не сходится), обе стороны DH.
    #[test]
    fn bytes_decrypt_with_wrong_key_fails() {
        let (ks_a, _ks_b, pub_a, pub_b) = two_peers();
        let (nonce, ct) = encrypt_inner(&ks_a, pub_b, b"voice payload").unwrap();

        let ks_c = KeyStore::new();
        let mut seed_c = [0x77u8; KEY_SIZE];
        seed_c[3] ^= 0x01;
        ks_c.load_private_key(seed_c).unwrap();
        let pub_c = b64_to_32(&ks_c.public_key_b64().unwrap()).unwrap();

        // Чужой приватный ключ + свой pubkey.
        let err = decrypt_inner(&ks_c, pub_c, nonce, &ct).unwrap_err();
        assert!(err.contains("decrypt FAILED"), "unexpected: {err}");
        // Верный pubkey отправителя, но чужой приватный ключ.
        let err = decrypt_inner(&ks_c, pub_a, nonce, &ct).unwrap_err();
        assert!(err.contains("decrypt FAILED"), "unexpected: {err}");
    }

    /// R4a: legacy-медиа шифровалось из base64-СТРОКИ. Новый raw-путь
    /// расшифрует её «успешно», но вернёт ASCII base64 вместо аудио — именно
    /// поэтому расшифровка ветвится по meta.v (v:2 vs legacy).
    #[test]
    fn legacy_base64_plaintext_yields_ascii_not_media_r4a() {
        let (ks_a, ks_b, pub_a, pub_b) = two_peers();
        let audio = random_bytes(64 * 1024);
        let audio_b64 = BASE64.encode(&audio);

        // Старый конвейер: plaintext = base64-строка аудио.
        let (nonce, ct) = encrypt_inner(&ks_a, pub_b, audio_b64.as_bytes()).unwrap();

        let pt = decrypt_inner(&ks_b, pub_a, nonce, &ct).unwrap();
        assert_eq!(pt.as_slice(), audio_b64.as_bytes(), "вернулась base64-строка");
        assert_ne!(pt.as_slice(), &audio[..], "это НЕ аудио — плеер получит мусор");
        // Валидный UTF-8: aead отрабатывает без ошибки — защищает только v:2.
        assert!(String::from_utf8(pt.to_vec()).is_ok());
    }

    /// R4b: обратное — новый БИНАРНЫЙ шифротекст старым `crypto_decrypt`
    /// расшифровывается, но падает на `String::from_utf8`: старые билды
    /// получают явный clean failure, а не тихую порчу.
    #[test]
    fn new_binary_ciphertext_breaks_legacy_from_utf8_r4b() {
        let (ks_a, ks_b, pub_a, pub_b) = two_peers();
        // Гарантированно невалидный UTF-8 плейнтекст (как реальное аудио).
        let audio = vec![0xFFu8, 0xFE, 0xFD, 0x80, 0x00, 0xC0];
        let (nonce, ct) = encrypt_inner(&ks_a, pub_b, &audio).unwrap();

        let pt = decrypt_inner(&ks_b, pub_a, nonce, &ct).unwrap();
        assert_eq!(pt.as_slice(), &audio[..], "новый путь отдаёт сырые байты");

        let legacy = String::from_utf8(pt.to_vec());
        assert!(legacy.is_err(), "legacy from_utf8 должен падать");
        let msg = format!("[crypto] UTF-8: {}", legacy.unwrap_err());
        assert!(msg.starts_with("[crypto] UTF-8:"));
    }

    /// Валидация raw-тел: короткое тело не читается как pubkey+payload.
    #[test]
    fn raw_body_layout_validation() {
        assert!(parse_encrypt_body(&[]).is_err());
        assert!(parse_encrypt_body(&[0u8; KEY_SIZE - 1]).is_err());
        // Ровно pubkey → пустой plaintext (валидный box из одного тега).
        let (pub32, plain) = parse_encrypt_body(&[7u8; KEY_SIZE]).unwrap();
        assert_eq!(pub32, [7u8; KEY_SIZE]);
        assert!(plain.is_empty());

        assert!(parse_decrypt_body(&[0u8; KEY_SIZE + NONCE_SIZE - 1]).is_err());
        let mut body = vec![9u8; KEY_SIZE];
        body.extend_from_slice(&[3u8; NONCE_SIZE]);
        body.extend_from_slice(b"ct");
        let (pub32, nonce24, ct) = parse_decrypt_body(&body).unwrap();
        assert_eq!(pub32, [9u8; KEY_SIZE]);
        assert_eq!(nonce24, [3u8; NONCE_SIZE]);
        assert_eq!(ct, b"ct");
    }

    /// nonce из меты: base64 ровно 24 байта, иначе понятная ошибка.
    #[test]
    fn nonce_b64_validation() {
        let n = b64_to_nonce(&BASE64.encode([1u8; NONCE_SIZE])).unwrap();
        assert_eq!(n, [1u8; NONCE_SIZE]);
        let err = b64_to_nonce(&BASE64.encode([1u8; NONCE_SIZE - 1])).unwrap_err();
        assert!(err.contains("nonce must be 24 bytes"), "unexpected: {err}");
        assert!(b64_to_nonce("не-base64!").is_err());
    }
}
