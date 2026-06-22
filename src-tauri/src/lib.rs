use tauri::Manager;

// Команда, вызываемая из JS при клике на уведомление
#[tauri::command]
fn handle_notification_click(app: tauri::AppHandle, chat_id: String) {
  // Фокусируем окно при клике
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.set_focus();
  }
  // Эмитим событие в JS-фронтенд
  let _ = app.emit("notification-clicked", chat_id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![handle_notification_click])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Слушаем клики по уведомлениям
      app.listen("notification-clicked", |event| {
        println!("[Notifications] Clicked: {:?}", event.payload());
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
