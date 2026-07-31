#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod crypto;
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
            // Crypto commands (BIP-39 + x25519-dalek в фоновом потоке)
            crypto::generate_mnemonic,
            crypto::validate_mnemonic,
            crypto::generate_keys_from_mnemonic,
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
            vault::vault_save_private_key,
            vault::vault_load_private_key,
            vault::vault_delete_private_key,
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
            init_notification_manager(app.handle());

            app.listen("notification-clicked", |event| {
                println!("[Notifications] Clicked: {:?}", event.payload());
            });

            log::info!("[Setup] All managers initialized, ready for IPC");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
