//! QR-авторизация: полный конвейер шифрования и отправки E2EE-ключа.
//!
//! Мобилка сканирует QR (`app://auth?session_id=…&web_pub_key=…`), вычисляет
//! общий секрет (DH) со своим E2EE-приватным ключом (он живёт ТОЛЬКО в Rust
//! `KeyStore` и никуда не возвращается), шифрует E2EE-ключ (XSalsa20-Poly1305
//! через crypto_box::SalsaBox — совместимо с tweetnacl nacl.box) и отправляет
//! зашифрованный пакет в канал Supabase Realtime через REST RPC broadcast_message.
//! Сервер видит только ciphertext.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use crypto_box::{
    aead::{Aead, AeadCore, OsRng},
    PublicKey, SalsaBox, SecretKey,
};
use serde_json::json;
use tauri::Manager;

/// Транспорт: POST зашифрованного пакета в Supabase Realtime через RPC.
///
/// Имитирует JS-клиент Supabase: anon-ключ в `apikey` и `Authorization: Bearer`.
/// Сервер (RPC broadcast_message) пересылает payload подписчикам канала
/// `auth_<session_id>` через postgres_changes. Видит только ciphertext.
pub async fn send_e2ee_key_broadcast(
    supabase_url: &str,
    supabase_anon_key: &str,
    session_id: &str,
    mob_pub_key_hex: &str,
    encrypted_key_hex: &str,
    nonce_hex: &str,
) -> Result<(), String> {
    let body = json!({
        "channel": format!("auth_{}", session_id),
        "event": "key_exchange",
        "payload": {
            "mob_pub_key": mob_pub_key_hex,
            "encrypted_key": encrypted_key_hex,
            "nonce": nonce_hex,
        }
    });

    let endpoint = format!("{}/rest/v1/rpc/broadcast_message", supabase_url);

    // Диагностика: показываем реальный адрес, на который уходит запрос.
    // Если в логе виден https://unconfigured.echo.invalid — на устройстве
    // стоит НЕ этот билд (старая сборка), а не проблема конфигурации.
    log::info!(
        "[QR-Broadcast] Sending E2EE key to channel auth_{} via {}",
        session_id,
        endpoint
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&endpoint)
        .header("apikey", supabase_anon_key)
        .header("Authorization", format!("Bearer {}", supabase_anon_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("[QR-Broadcast] HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("[QR-Broadcast] RPC returned {}: {}", status, text));
    }

    log::info!(
        "[QR-Broadcast] E2EE key sent to channel auth_{}",
        session_id
    );
    Ok(())
}

/// Tauri-команда: полный конвейер QR-авторизации для мобилки.
///
/// E2EE-ключ берётся из Rust `KeyStore` (это собственный приватный ключ
/// устройства, деривированный из seed). Фронтенд НЕ передаёт приватный ключ
/// и НЕ может его прочитать — он покидает KeyStore только зашифрованным.
///
/// Шаги:
/// 1. Парсит web_pub_key из hex (из QR).
/// 2. Берёт свой E2EE-приватный ключ из KeyStore и шифрует его в конверт.
/// 3. Создаёт JSON-конверт { e2eeKey, session }.
/// 4. Шифрует через SalsaBox (XSalsa20-Poly1305 = nacl.box).
/// 5. Отправляет ciphertext в канал auth_<session_id> через REST RPC.
#[tauri::command]
pub async fn qr_send_e2ee_key(
    app: tauri::AppHandle,
    session_id: String,
    web_pub_key: String,
    session_data: Option<serde_json::Value>,
    // URL и anon-ключ приходят из JS (NEXT_PUBLIC_* вшиты в бандл, а Rust-рантайм
    // их не видит — std::env::var вернул бы fallback с протухшим ключом → 401).
    // Опциональны для обратной совместимости; при отсутствии — старый fallback.
    supabase_url: Option<String>,
    supabase_anon_key: Option<String>,
) -> Result<(), String> {
    use crate::crypto::KeyStore;

    // 0. Приватный ключ устройства — из Rust KeyStore (никогда не возвращается в JS).
    let store = app.state::<KeyStore>();
    let scalar = store.private_scalar()?;
    let e2ee_key = BASE64.encode(scalar);

    // 1. Распарсить web_pub_key из hex → [u8; 32].
    let web_pub_bytes =
        hex::decode(&web_pub_key).map_err(|e| format!("[QR] Неверный hex web_pub_key: {}", e))?;
    let web_pub_array: [u8; 32] = web_pub_bytes
        .try_into()
        .map_err(|_| "[QR] web_pub_key должен быть 32 байта".to_string())?;
    let web_public = PublicKey::from(web_pub_array);

    // 2. Сгенерировать эфемерную X25519-пару.
    let mut rng = OsRng;
    let mob_secret = SecretKey::generate(&mut rng);
    let mob_public = mob_secret.public_key();
    let mob_pub_key_hex = hex::encode(mob_public.as_bytes());

    // 3. Создать JSON-конверт { e2eeKey, session }.
    let envelope = json!({
        "e2eeKey": e2ee_key,
        "session": session_data,
    });
    let message = serde_json::to_vec(&envelope)
        .map_err(|e| format!("[QR] Ошибка сериализации конверта: {}", e))?;

    // 4. Зашифровать через SalsaBox (XSalsa20-Poly1305, nacl.box-совместимо).
    let salsa_box = SalsaBox::new(&web_public, &mob_secret);
    let nonce = SalsaBox::generate_nonce(&mut rng); // 24 байта
    let ciphertext = salsa_box
        .encrypt(&nonce, message.as_slice())
        .map_err(|e| format!("[QR] Ошибка шифрования: {:?}", e))?;

    let encrypted_key_hex = hex::encode(&ciphertext);
    let nonce_hex = hex::encode(nonce.as_slice());

    // 5. Отправить в канал auth_<session_id> через Supabase RPC.
    // Параметры из JS — в приоритете; env/fallback — только для совместимости.
    let supabase_url = supabase_url
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("NEXT_PUBLIC_SUPABASE_URL").ok())
        .unwrap_or("https://aoxzpqwiwuzypydexfrn.supabase.co".to_string());
    let supabase_anon_key = supabase_anon_key
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("NEXT_PUBLIC_SUPABASE_ANON_KEY").ok())
        .unwrap_or("sb_publishable_AZAFBfQ2W5HPP9a78ty4hA_cokr8Y19".to_string());

    send_e2ee_key_broadcast(
        &supabase_url,
        &supabase_anon_key,
        &session_id,
        &mob_pub_key_hex,
        &encrypted_key_hex,
        &nonce_hex,
    )
    .await?;

    log::info!(
        "[QR] E2EE key exchange complete: channel auth_{}",
        session_id
    );
    Ok(())
}
