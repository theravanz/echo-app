#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod crypto;
mod device;
mod notification;
mod qr_auth;
mod stickers;
mod storage;
mod vault;

use notification::NotificationManager;
use storage::StorageManager;
use tauri::{AppHandle, Emitter, Listener, Manager};
use vault::Vault;

/// Команда, вызываемая из JS при клике на уведомление
#[tauri::command]
fn handle_notification_click(app: tauri::AppHandle, chat_id: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    let _ = app.emit("notification-clicked", chat_id);
}

/// Включает WebKitGTK media_stream для getUserMedia() (камера/микрофон).
/// wry 0.55 НЕ устанавливает enable-media-stream по умолчанию →
/// WebKitGTK блокирует getUserMedia с NotAllowedError.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn enable_media_stream(app: &AppHandle<tauri::Wry>) {
    use webkit2gtk::{SettingsExt, WebViewExt};

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(|webview| {
            if let Some(settings) = webview.inner().settings() {
                settings.set_enable_media_stream(true);
                log::info!("[Media] WebKitGTK media_stream enabled");
            } else {
                log::warn!("[Media] WebKitGTK settings() returned None");
            }
        });
    } else {
        log::warn!("[Media] main webview window not found");
    }
}

/// No-op для не-Linux платформ (Windows/macOS используют WebView2/WKWebView,
/// где getUserMedia работает по умолчанию или через другие механизмы).
#[cfg(not(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
fn enable_media_stream(_app: &AppHandle<tauri::Wry>) {}

/// Инициализация менеджера уведомлений
fn init_notification_manager(app: &AppHandle<tauri::Wry>) {
    let supabase_url = std::env::var("NEXT_PUBLIC_SUPABASE_URL")
        .unwrap_or_else(|_| "https://aoxzpqwiwuzypydexfrn.supabase.co".to_string());
    let supabase_anon_key = std::env::var("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        .unwrap_or_else(|_| "sb_publishable_AZAFBfQ2W5HPP9a78ty4hA_cokr8Y19".to_string());

    let manager = NotificationManager::new(app.clone(), supabase_url, supabase_anon_key);
    app.manage(manager);
    log::info!("[Notifications] Manager initialized");
}

/// Инициализация менеджера локального хранилища SQLite (rusqlite, одно соединение)
fn init_storage_manager(app: &AppHandle<tauri::Wry>) {
    // Логируем все возможные пути
    if let Ok(dir) = app.path().app_data_dir() {
        log::info!("[Storage] app_data_dir: {:?}", dir);
    } else {
        log::error!("[Storage] app_data_dir FAILED");
    }
    
    if let Ok(dir) = app.path().app_local_data_dir() {
        log::info!("[Storage] app_local_data_dir: {:?}", dir);
    } else {
        log::error!("[Storage] app_local_data_dir FAILED");
    }
    
    let manager = StorageManager::new(app);
    app.manage(manager);
    log::info!("[Storage] Manager initialized (rusqlite monopoly)");
}

/// Инициализация Vault (AES-256-GCM шифрование с привязкой к устройству)
fn init_vault(app: &AppHandle<tauri::Wry>) {
    let mut vault = Vault::new();
    match vault.initialize(app) {
        Ok(()) => {
            log::info!("[Vault] Initialized successfully (AES-256-GCM)");
        }
        Err(e) => {
            log::error!("[Vault] Failed to initialize: {}", e);
            // Не падаем — vault будет проверять ready флаг при каждой операции
        }
    }
    app.manage(vault);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // tauri-plugin-sql УДАЛЁН — монополия rusqlite
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init());

    // Single-instance плагин доступен только на десктопе (Windows/Linux/macOS).
    // На Android/iOS он не нужен и не компилируется.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        // Перехватываем второй экземпляр (warm start на десктопе).
        // Если в CLI-аргументах есть echomes:// — эмитим событие
        // для уже работающего фронтенда.
        if let Some(url) = args.iter().find(|a| a.starts_with("echomes://")) {
            let _ = app.emit("deep-link://new-url", vec![url.clone()]);
        }
        // Выводим окно на передний план
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }));

    builder
        .invoke_handler(tauri::generate_handler![
            // Notification commands
            handle_notification_click,
            notification::get_notification_settings,
            notification::update_notification_settings,
            notification::set_fcm_token,
            notification::get_fcm_token,
            notification::show_local_notification,
            notification::start_background_polling,
            // Crypto commands (BIP-39 + X25519/x25519-dalek, E2EE ключ в KeyStore)
            crypto::generate_mnemonic,
            crypto::validate_mnemonic,
            crypto::crypto_derive_keys,
            crypto::crypto_set_key,
            crypto::crypto_get_public_key,
            crypto::crypto_status,
            crypto::crypto_encrypt,
            crypto::crypto_decrypt,
            crypto::crypto_sign,
            crypto::crypto_verify,
            crypto::crypto_clear,
            crypto::crypto_persist_key,
            crypto::crypto_restore_key,
            crypto::crypto_qr_ephemeral_keypair,
            crypto::crypto_qr_decrypt,
            // QR Auth commands (E2EE key exchange: crypto + broadcast via Supabase Realtime)
            qr_auth::qr_send_e2ee_key,
            // Storage commands (rusqlite, AES-256-GCM через vault)
            storage::save_session,
            storage::get_session,
            storage::get_latest_session,
            storage::delete_session,
            storage::get_all_sessions,
            storage::save_device,
            storage::get_devices,
            storage::delete_device,
            storage::save_account,
            storage::get_account,
            // Theme commands
            storage::save_theme,
            storage::get_theme,
            storage::get_all_themes,
            storage::delete_theme,
            storage::get_active_theme_id,
            storage::set_active_theme_id,
            // Chat wallpaper commands
            storage::save_chat_wallpaper,
            storage::get_chat_wallpaper,
            storage::delete_chat_wallpaper,
            // Auth progress commands (persist auth across app restarts)
            storage::save_auth_progress,
            storage::get_auth_progress,
            storage::delete_auth_progress,
            // Vault commands (AES-256-GCM encryption)
            vault::vault_encrypt,
            vault::vault_decrypt,
            vault::vault_status,
            vault::vault_derive_key,
            vault::vault_logout,
            // Sticker commands
            stickers::decode_webp_info,
            stickers::decode_webp_to_rgba,
            stickers::decode_tgs_info,
            stickers::decode_tgs_frame,
            stickers::decode_webm_info,
            stickers::decode_webm_frame,
            stickers::decode_png_info,
            stickers::decode_png_to_rgba,
            stickers::is_android,
            stickers::is_mobile,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Порядок важен: сначала storage (создаёт таблицы), потом vault (шифрует)
            init_storage_manager(app.handle());
            init_vault(app.handle());
            // Phase 0: E2EE-приватный ключ живёт в Rust KeyStore (Zeroizing).
            // Управляем до команд, чтобы crypto::crypto_* всегда видели состояние.
            app.manage(crypto::KeyStore::new());
            init_notification_manager(app.handle());
            enable_media_stream(app.handle());

            app.listen("notification-clicked", |event| {
                println!("[Notifications] Clicked: {:?}", event.payload());
            });

            log::info!("[Setup] All managers initialized, ready for IPC");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
