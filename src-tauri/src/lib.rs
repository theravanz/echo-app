mod crypto;
mod notification;

use notification::NotificationManager;
use tauri::{AppHandle, Emitter, Listener, Manager};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            // Notification commands
            handle_notification_click,
            notification::get_notification_settings,
            notification::update_notification_settings,
            notification::set_fcm_token,
            notification::get_fcm_token,
            notification::show_local_notification,
            notification::start_background_polling,
            // Crypto commands (BIP-39 + Curve25519 в фоновом потоке)
            crypto::generate_mnemonic,
            crypto::validate_mnemonic,
            crypto::generate_keys_from_mnemonic,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            init_notification_manager(app.handle());

            app.listen("notification-clicked", |event| {
                println!("[Notifications] Clicked: {:?}", event.payload());
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::BackButton = event {
                // Отправляем событие во фронтенд вместо стандартного поведения
                let _ = window.emit("android-back-button", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

