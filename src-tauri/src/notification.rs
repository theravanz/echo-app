use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};

// === Notification Types ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub sound: bool,
    pub message_preview: bool,
    pub group_by_chat: bool,
    pub direct_messages_only: bool,
    pub push_notifications: bool,
    pub background_polling: bool,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            sound: true,
            message_preview: true,
            group_by_chat: true,
            direct_messages_only: false,
            push_notifications: true,
            background_polling: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingNotification {
    pub id: String,
    pub title: String,
    pub body: String,
    pub chat_id: Option<String>,
    pub sender_id: Option<String>,
    pub timestamp: String,
    pub delivered: bool,
}

// === Notification State ===

pub struct NotificationState {
    pub settings: NotificationSettings,
    pub fcm_token: Option<String>,
    pub pending_notifications: Vec<PendingNotification>,
    pub is_polling_active: bool,
    pub supabase_url: String,
    pub supabase_anon_key: String,
}

impl NotificationState {
    pub fn new(supabase_url: String, supabase_anon_key: String) -> Self {
        Self {
            settings: NotificationSettings::default(),
            fcm_token: None,
            pending_notifications: Vec::new(),
            is_polling_active: false,
            supabase_url,
            supabase_anon_key,
        }
    }
}

// === Notification Manager ===

pub struct NotificationManager {
    pub state: Mutex<NotificationState>,
    app_handle: AppHandle<tauri::Wry>,
}

impl NotificationManager {
    pub fn new(app_handle: AppHandle<tauri::Wry>, supabase_url: String, supabase_anon_key: String) -> Self {
        Self {
            state: Mutex::new(NotificationState::new(supabase_url, supabase_anon_key)),
            app_handle,
        }
    }

    pub fn update_settings(&self, settings: NotificationSettings) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        state.settings = settings.clone();
        let _ = self.app_handle.emit("notification-settings-changed", settings);
        Ok(())
    }

    pub fn get_settings(&self) -> Result<NotificationSettings, String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        Ok(state.settings.clone())
    }

    pub fn set_fcm_token(&self, token: String) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        state.fcm_token = Some(token.clone());
        let _ = self.app_handle.emit("fcm-token-updated", token);
        Ok(())
    }

    pub fn get_fcm_token(&self) -> Result<Option<String>, String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        Ok(state.fcm_token.clone())
    }

    pub fn show_notification(
        &self,
        title: String,
        body: String,
        chat_id: Option<String>,
    ) -> Result<(), String> {
        use tauri_plugin_notification::NotificationExt;

        let notif = self.app_handle.notification().builder()
            .title(&title)
            .body(&body);

        let notif = if let Some(ref cid) = chat_id {
            notif.extra("chatId", cid.clone())
        } else {
            notif
        };

        notif.show().map_err(|e| e.to_string())?;

        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        state.pending_notifications.push(PendingNotification {
            id: format!("notif_{}", chrono::Utc::now().timestamp_millis()),
            title,
            body,
            chat_id,
            sender_id: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            delivered: true,
        });

        Ok(())
    }

    pub async fn start_background_polling(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if state.is_polling_active {
            return Ok(());
        }
        state.is_polling_active = true;
        let supabase_url = state.supabase_url.clone();
        let supabase_key = state.supabase_anon_key.clone();
        drop(state);

        let app_handle = self.app_handle.clone();

        tokio::spawn(async move {
            let mut poll_interval = interval(Duration::from_secs(15));
            let client = reqwest::Client::new();

            loop {
                poll_interval.tick().await;

                let params = [
                    ("select", "id,sender_id,receiver_id,content,nonce,type,created_at,status"),
                    ("order", "created_at.desc"),
                    ("limit", "10"),
                ];

                match client
                    .get(format!("{}/rest/v1/messages", supabase_url))
                    .query(&params)
                    .header("apikey", &supabase_key)
                    .header("Authorization", format!("Bearer {}", &supabase_key))
                    .header("Content-Type", "application/json")
                    .send()
                    .await
                {
                    Ok(response) => {
                        if let Ok(data) = response.json::<serde_json::Value>().await {
                            if let Some(messages) = data.as_array() {
                                if !messages.is_empty() {
                                    let _ = app_handle.emit(
                                        "background-messages",
                                        serde_json::json!({
                                            "messages": messages,
                                            "checked_at": chrono::Utc::now().to_rfc3339()
                                        }),
                                    );
                                }
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("[Notification] Polling error: {:?}", e);
                    }
                }
            }
        });

        Ok(())
    }
}

// === Tauri Commands ===

#[tauri::command]
pub async fn get_notification_settings(
    manager: tauri::State<'_, NotificationManager>,
) -> Result<NotificationSettings, String> {
    manager.get_settings()
}

#[tauri::command]
pub async fn update_notification_settings(
    manager: tauri::State<'_, NotificationManager>,
    settings: NotificationSettings,
) -> Result<(), String> {
    manager.update_settings(settings)
}

#[tauri::command]
pub async fn set_fcm_token(
    manager: tauri::State<'_, NotificationManager>,
    token: String,
) -> Result<(), String> {
    manager.set_fcm_token(token)
}

#[tauri::command]
pub async fn get_fcm_token(
    manager: tauri::State<'_, NotificationManager>,
) -> Result<Option<String>, String> {
    manager.get_fcm_token()
}

#[tauri::command]
pub async fn show_local_notification(
    manager: tauri::State<'_, NotificationManager>,
    title: String,
    body: String,
    chat_id: Option<String>,
) -> Result<(), String> {
    manager.show_notification(title, body, chat_id)
}

#[tauri::command]
pub async fn start_background_polling(
    manager: tauri::State<'_, NotificationManager>,
) -> Result<(), String> {
    manager.start_background_polling().await
}
