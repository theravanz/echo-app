//! Настоящий выход из приложения на Android (системный back при пустом
//! back-стеке): `finishAndRemoveTask()` — Activity закрывается и задача
//! убирается из recents. НЕ Process.kill: приложение завершается штатно,
//! FCM/сервисы получают нормальный lifecycle (onDestroy и т.д.).
//!
//! Поток: JS (lib/back-nav.ts, событие echo-native-back) → invoke("exit_app")
//! → with_webview → jni_handle().exec на UI-потоке → Activity.finishAndRemoveTask.
//! На не-Android таргетах команда вернёт Err("unsupported"): системный back
//! там обрабатывается ОС (iOS home-gesture / desktop оконный менеджер).

#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_exit(&app)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Err("unsupported".to_string())
    }
}

#[cfg(target_os = "android")]
fn android_exit(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "android-no-main-window".to_string())?;

    window
        .with_webview(move |webview| {
            // exec() выполняется на UI-потоке Android и отдаёт JNIEnv + инстанс
            // MainActivity (наследник TauriActivity) — тот же паттерн, что в
            // file_open.rs. finishAndRemoveTask() есть у Activity с API 21+.
            webview.jni_handle().exec(move |env, activity, _wv| {
                if let Err(e) = env.call_method(activity, "finishAndRemoveTask", "()V", &[]) {
                    log::error!("[BACK-NAV] finishAndRemoveTask failed: {e}");
                    // Fallback: обычный finish() — приложение закроется, пусть
                    // и без снятия задачи из recents.
                    let _ = env.call_method(activity, "finish", "()V", &[]);
                }
                log::info!("[BACK-NAV] android exit requested (finishAndRemoveTask)");
            });
        })
        .map_err(|e| format!("android-with-webview: {e}"))?;

    Ok(())
}
