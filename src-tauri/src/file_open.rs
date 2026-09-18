//! Системное открытие файлов из приватного кэша — Android/iOS.
//!
//! Зачем модуль: файлы сообщений лежат в приватном AppCache, куда их кладёт
//! `ensureCachedFile()` (lib/files.ts) — скачанные и уже расшифрованные.
//! На десктопе `openPath` открывает такой файл системным приложением, но на
//! мобильных `file://`-путь из приватного каталога не работает в принципе:
//!   • Android 7+ → StrictMode бросает `FileUriExposedException`, как только
//!     file://-URI уезжает в чужое приложение (tauri-plugin-opener отдаёт
//!     ровно `args.url.toUri()`, поэтому ACTION_VIEW там не срабатывает);
//!   • iOS → песочница: `UIApplication.open` не пускает стороннее приложение
//!     к нашему контейнеру, а `UIDocumentInteractionController` требует
//!     копию документа.
//!
//! Поэтому открываем так:
//!   • Android — content:// URI через `FileProvider.getUriForFile()` +
//!     `Intent.createChooser(ACTION_VIEW)` — системный диалог выбора
//!     приложения, как в Telegram;
//!   • iOS — `QLPreviewController` (QuickLook) модалкой поверх приложения.
//!
//! Контракт ошибок (его читает `openFileMessage` в lib/files.ts):
//!   • `no-app-for-mime` — ни одного приложения для этого mime;
//!   • `unsupported`     — платформа не поддерживает системное открытие;
//!   • `file-not-found`  — файла нет по переданному пути;
//!   • всё остальное     — техническая ошибка, логируется с контекстом.
//!
//! Инварианты:
//!   • authority для FileProvider НЕ хардкодится: берём applicationId из
//!     самого Context (`getPackageName()`) → всегда совпадает с манифестным
//!     `${applicationId}.fileprovider` при смене applicationId в gradle;
//!   • ошибки не глотаются: JNI-сбой → Err с шагом и текстом исключения JVM.

/// `Duration`/таймаут моста нужны только мобильным реализациям.
#[cfg(any(target_os = "android", target_os = "ios"))]
use std::time::Duration;

/// Платформа не умеет системное открытие из приватного кэша.
pub const ERR_UNSUPPORTED: &str = "unsupported";
/// Для этого mime не нашлось ни одного приложения-вьюера.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub const ERR_NO_APP_FOR_MIME: &str = "no-app-for-mime";
/// Файла нет по переданному пути.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub const ERR_FILE_NOT_FOUND: &str = "file-not-found";

/// Сколько ждём ответ JNI/Swift-моста. Activity/UIKit отвечают мгновенно,
/// таймаут нужен только чтобы команда не «повисла» навсегда при сбое
/// диспатча на UI-поток.
#[cfg(any(target_os = "android", target_os = "ios"))]
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(15);

/// Открыть файл системным механизмом платформы (Android: chooser, iOS: QuickLook).
///
/// `path` — абсолютный путь к УЖЕ скачанному и расшифрованному файлу
/// (гарантия `ensureCachedFile`), `mime` — честный mime из меты файла
/// (`File.type` при отправке): по нему выбирается приложение-вьюер.
#[tauri::command]
pub async fn open_file_system(
    app: tauri::AppHandle,
    path: String,
    mime: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android::open_file_system(&app, path, mime)
    }
    #[cfg(not(target_os = "android"))]
    {
        // Команда существует на всех таргетах (фронт вызывает её безусловно),
        // но системное открытие через chooser реализует только Android.
        let _ = (&app, &path, &mime);
        Err(ERR_UNSUPPORTED.to_string())
    }
}

/// Показать файл системным предпросмотром iOS (QuickLook).
///
/// `path` — абсолютный путь к УЖЕ скачанному и расшифрованному файлу в
/// контейнере приложения; QuickLook читает его из песочницы напрямую.
#[tauri::command]
pub async fn open_file_ios(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        ios::open_file_ios(&app, path)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, &path);
        Err(ERR_UNSUPPORTED.to_string())
    }
}

// ───────────────────────────── Android ─────────────────────────────

#[cfg(target_os = "android")]
mod android {
    use super::{BRIDGE_TIMEOUT, ERR_FILE_NOT_FOUND, ERR_NO_APP_FOR_MIME};
    use jni::errors::Error as JniError;
    use jni::objects::JObject;
    use jni::JNIEnv;
    use std::path::Path;
    use std::sync::mpsc;
    use tauri::Manager;


    /// Открыть файл системным ACTION_VIEW: вся логика в MainActivity.kt
    /// (`echoOpenFileExternally`), Rust только вызывает её через JNI.
    ///
    /// Почему не чистый JNI (первая версия): wry грузит классы через кастомный
    /// app-classloader, из-за чего `call_static_method` по найденному через
    /// `find_class` androidx-классу ловит `NoSuchMethodError` на getUriForFile.
    /// Kotlin видит androidx напрямую — там же FCM-мост, там же открываем файл.
    ///
    /// Коды Kotlin-метода маппятся на контракт ошибок модуля:
    /// 0 ok / 1 file-not-found / 2 no-app-for-mime / 3 прочий сбой.
    pub fn open_file_system(
        app: &tauri::AppHandle,
        path: String,
        mime: String,
    ) -> Result<(), String> {
        // Инвариант фронтенда: файл уже в кэше. Проверяем явно — иначе
        // FileProvider ответит невнятным IllegalArgumentException.
        if !Path::new(&path).exists() {
            log::error!("[OPEN-MOBILE] android: файла нет по пути {path}");
            return Err(ERR_FILE_NOT_FOUND.to_string());
        }
        let mime = if mime.trim().is_empty() {
            "application/octet-stream".to_string()
        } else {
            mime
        };

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "android-no-main-window".to_string())?;

        window
            .with_webview(move |webview| {
                // exec() выполняется на UI-потоке Android и отдаёт JNIEnv +
                // инстанс MainActivity (наследник TauriActivity): цель для
                // вызова echoOpenFileExternally.
                webview.jni_handle().exec(move |env, activity, _wv| {
                    let result = call_open_externally(env, activity, &path, &mime);
                    if let Err(e) = &result {
                        log::error!("[OPEN-MOBILE] android intent failed (mime {mime}): {e}");
                    }
                    // Отправляем результат в команду; sender живёт в замыкании.
                    let _ = tx.send(result);
                });
            })
            .map_err(|e| format!("android-with-webview: {e}"))?;

        match rx.recv_timeout(BRIDGE_TIMEOUT) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err("android-bridge-closed".to_string())
            }
            Err(mpsc::RecvTimeoutError::Timeout) => Err("android-bridge-timeout".to_string()),
        }
    }

    /// JNI-вызов MainActivity.echoOpenFileExternally(path, mime) → Int.
    /// Kotlin-метод исключения не бросает (все перехвачены), pending
    /// погашаем на всякий случай, чтобы не уронить следующие вызовы.
    fn call_open_externally(
        env: &mut JNIEnv<'_>,
        activity: &JObject<'_>,
        path: &str,
        mime: &str,
    ) -> Result<(), String> {
        let path_j = env.new_string(path).map_err(step("new_string(path)"))?;
        let mime_j = env.new_string(mime).map_err(step("new_string(mime)"))?;
        let code = env
            .call_method(
                activity,
                "echoOpenFileExternally",
                "(Ljava/lang/String;Ljava/lang/String;)I",
                &[(&path_j).into(), (&mime_j).into()],
            )
            .map_err(step("MainActivity.echoOpenFileExternally"))?
            .i()
            .map_err(step("echoOpenFileExternally → Int"))?;
        if let Ok(true) = env.exception_check() {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
        match code {
            0 => Ok(()),
            1 => Err(ERR_FILE_NOT_FOUND.to_string()),
            2 => Err(ERR_NO_APP_FOR_MIME.to_string()),
            other => Err(format!("android-open-externally-failed: {other}")),
        }
    }

    /// Единый формат JNI-ошибки: шаг + текст исключения/ошибки jni.
    fn step(step: &'static str) -> impl Fn(JniError) -> String {
        move |e| format!("android-jni[{step}]: {e}")
    }
}
// ────────────────────────────── iOS ───────────────────────────────

#[cfg(target_os = "ios")]
mod ios {
    use super::BRIDGE_TIMEOUT;
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int};
    use std::sync::mpsc;

    extern "C" {
        /// Swift-мост: `gen/apple/Sources/app/EchoFileOpener.swift`
        /// (`@_cdecl("echo_open_file_ios")`). Возвращает 0 — ok, 1 — файла нет,
        /// 2 — не удалось показать предпросмотр.
        fn echo_open_file_ios(path: *const c_char) -> c_int;
    }

    /// Показать файл через QLPreviewController (QuickLook).
    ///
    /// Swift-файл компилируется в тот же бинарник (Xcode-таргет собирает
    /// Sources/app), поэтому обходимся без tauri-plugin-скелета: не нужны
    /// Kotlin/Swift-обвязка плагина, permissions-схема и mobile-плагин IPC.
    /// Меньше кода в сравнении с `pnpm tauri plugin new --ios`.
    pub fn open_file_ios(app: &tauri::AppHandle, path: String) -> Result<(), String> {
        // UIKit-вызовы только на main thread: команда приходит из tokio, а
        // презентация обязана идти с UI-потока.
        let (tx, rx) = mpsc::channel::<c_int>();
        let path_c =
            CString::new(path.into_bytes()).map_err(|_| "ios-path-with-nul-byte".to_string())?;

        app.run_on_main_thread(move || {
            // SAFETY: указатель на NUL-terminated строку, живущую до конца
            // замыкания; Swift-функция только читает его синхронно.
            let code = unsafe { echo_open_file_ios(path_c.as_ptr()) };
            let _ = tx.send(code);
        })
        .map_err(|e| format!("ios-run-on-main-thread: {e}"))?;

        match rx.recv_timeout(BRIDGE_TIMEOUT) {
            Ok(0) => Ok(()),
            Ok(1) => Err(super::ERR_FILE_NOT_FOUND.to_string()),
            Ok(code) => Err(format!("ios-preview-failed: {code}")),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err("ios-bridge-closed".to_string()),
            Err(mpsc::RecvTimeoutError::Timeout) => Err("ios-bridge-timeout".to_string()),
        }
    }
}