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
    use jni::objects::{JObject, JString, JValue};
    use jni::JNIEnv;
    use std::path::Path;
    use std::sync::mpsc;
    use tauri::wry::prelude::find_class;
    use tauri::Manager;

    /// `Intent.FLAG_GRANT_READ_URI_PERMISSION` (0x1) — обязателен, иначе чужое
    /// приложение не прочитает content:// URI от FileProvider.
    /// `Intent.FLAG_ACTIVITY_NEW_TASK` (0x10000000) — страховка на случай,
    /// если Context окажется не Activity.
    const INTENT_FLAGS: i32 = 0x1000_0001;
    /// `PackageManager.MATCH_DEFAULT_ONLY`.
    const MATCH_DEFAULT_ONLY: i32 = 0x0001_0000;
    /// Класс-источник FileProvider (androidx.core, приходит с appcompat).
    const FILE_PROVIDER_CLASS: &str = "androidx.core.content.FileProvider";
    /// Системное исключение «нет приложения под Intent».
    const ACTIVITY_NOT_FOUND_CLASS: &str = "android/content/ActivityNotFoundException";

    /// Открыть файл системным ACTION_VIEW через FileProvider + chooser.
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
                // инстанс Activity (это и Context для FileProvider, и цель
                // для startActivity).
                webview.jni_handle().exec(move |env, activity, _wv| {
                    let result = start_view_intent(env, activity, &path, &mime);
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

    /// FileProvider → Uri → ACTION_VIEW + chooser → startActivity.
    /// Любой JNI-сбой превращается в Err с именем шага; pending-исключение JVM
    /// гасится, иначе следующий JNI-вызов на этом потоке упадёт.
    fn start_view_intent(
        env: &mut JNIEnv<'_>,
        activity: &JObject<'_>,
        path: &str,
        mime: &str,
    ) -> Result<(), String> {
        let result = build_and_start(env, activity, path, mime);
        if result.is_err() {
            clear_pending_exception(env);
        }
        result
    }

    fn build_and_start(
        env: &mut JNIEnv<'_>,
        activity: &JObject<'_>,
        path: &str,
        mime: &str,
    ) -> Result<(), String> {
        // 1. File(path)
        let path_j = env.new_string(path).map_err(step("new_string(path)"))?;
        let file = env
            .new_object(
                "java/io/File",
                "(Ljava/lang/String;)V",
                &[JValue::Object(&path_j)],
            )
            .map_err(step("new File(path)"))?;

        // 2. authority = "<applicationId>.fileprovider" — applicationId берём
        //    у Context, а не из константы в коде.
        let package = env
            .call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])
            .map_err(step("getPackageName"))?
            .l()
            .map_err(step("getPackageName → String"))?;
        let package: String = env
            .get_string(&JString::from(package))
            .map_err(step("getPackageName → Rust String"))?
            .into();
        let authority = format!("{package}.fileprovider");

        // 3. uri = FileProvider.getUriForFile(context, authority, file).
        //    Класс ищем через app-classloader (find_class ходит в
        //    Activity.getAppClass → Class.forName): androidx в
        //    system-classloader не виден.
        let provider = find_class(env, activity, FILE_PROVIDER_CLASS.to_string())
            .map_err(step("find androidx.core.content.FileProvider"))?;
        let authority_j = env
            .new_string(&authority)
            .map_err(step("new_string(authority)"))?;
        let uri = env
            .call_static_method(
                provider,
                "getUriForFile",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;",
                &[
                    JValue::Object(activity),
                    (&authority_j).into(),
                    JValue::Object(&file),
                ],
            )
            .map_err(step("FileProvider.getUriForFile"))?
            .l()
            .map_err(step("FileProvider.getUriForFile → Uri"))?;

        // 4. Intent(ACTION_VIEW).setDataAndType(uri, mime) + grant-read.
        let action = env
            .new_string("android.intent.action.VIEW")
            .map_err(step("new_string(ACTION_VIEW)"))?;
        let mime_j = env.new_string(mime).map_err(step("new_string(mime)"))?;
        let intent = env
            .new_object(
                "android/content/Intent",
                "(Ljava/lang/String;)V",
                &[(&action).into()],
            )
            .map_err(step("new Intent(ACTION_VIEW)"))?;
        env.call_method(
            &intent,
            "setDataAndType",
            "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;",
            &[JValue::Object(&uri), (&mime_j).into()],
        )
        .map_err(step("Intent.setDataAndType"))?;
        env.call_method(
            &intent,
            "addFlags",
            "(I)Landroid/content/Intent;",
            &[JValue::Int(INTENT_FLAGS)],
        )
        .map_err(step("Intent.addFlags"))?;
        // 5. Есть ли вообще вьюер для mime? Пустой список = "no-app-for-mime"
        //    (PackageManager видит чужие приложения благодаря <queries> в
        //    AndroidManifest.xml).
        if !has_viewer(env, activity, &intent)? {
            log::warn!("[OPEN-MOBILE] android: нет приложения для mime {mime}");
            return Err(ERR_NO_APP_FOR_MIME.to_string());
        }

        // 6. chooser = Intent.createChooser(intent, null) — юзер сам выбирает
        //    приложение (как «Поделиться» в Telegram).
        let chooser = env
            .call_static_method(
                "android/content/Intent",
                "createChooser",
                "(Landroid/content/Intent;Ljava/lang/CharSequence;)Landroid/content/Intent;",
                &[JValue::Object(&intent), JValue::Object(&JObject::null())],
            )
            .map_err(step("Intent.createChooser"))?
            .l()
            .map_err(step("Intent.createChooser → Intent"))?;
        env.call_method(
            &chooser,
            "addFlags",
            "(I)Landroid/content/Intent;",
            &[JValue::Int(INTENT_FLAGS)],
        )
        .map_err(step("chooser.addFlags"))?;

        // 7. context.startActivity(chooser)
        match env.call_method(
            activity,
            "startActivity",
            "(Landroid/content/Intent;)V",
            &[JValue::Object(&chooser)],
        ) {
            Ok(_) => Ok(()),
            Err(e) => {
                // Гонка: вьюер мог исчезнуть между проверкой и запуском —
                // отдаём фронтенду тот же контракт "no-app-for-mime".
                if is_activity_not_found(env) {
                    clear_pending_exception(env);
                    Err(ERR_NO_APP_FOR_MIME.to_string())
                } else {
                    Err(format!("android-jni[startActivity]: {e}"))
                }
            }
        }
    }

    /// `PackageManager.queryIntentActivities(intent, MATCH_DEFAULT_ONLY)`.
    /// true — хотя бы одно приложение умеет открыть этот mime.
    fn has_viewer(
        env: &mut JNIEnv<'_>,
        activity: &JObject<'_>,
        intent: &JObject<'_>,
    ) -> Result<bool, String> {
        let pm = env
            .call_method(
                activity,
                "getPackageManager",
                "()Landroid/content/pm/PackageManager;",
                &[],
            )
            .map_err(step("getPackageManager"))?
            .l()
            .map_err(step("getPackageManager → PackageManager"))?;
        let viewers = env
            .call_method(
                &pm,
                "queryIntentActivities",
                "(Landroid/content/Intent;I)Ljava/util/List;",
                &[JValue::Object(intent), JValue::Int(MATCH_DEFAULT_ONLY)],
            )
            .map_err(step("queryIntentActivities"))?
            .l()
            .map_err(step("queryIntentActivities → List"))?;
        let empty = env
            .call_method(&viewers, "isEmpty", "()Z", &[])
            .map_err(step("List.isEmpty"))?
            .z()
            .map_err(step("List.isEmpty → bool"))?;
        Ok(!empty)
    }

    /// Брошено ли сейчас `ActivityNotFoundException`.
    fn is_activity_not_found(env: &mut JNIEnv<'_>) -> bool {
        match env.exception_occurred() {
            Ok(throwable) => env
                .is_instance_of(&throwable, ACTIVITY_NOT_FOUND_CLASS)
                .unwrap_or(false),
            Err(_) => false,
        }
    }

    /// Погасить pending-исключение JVM (с логом в logcat для диагностики).
    fn clear_pending_exception(env: &mut JNIEnv<'_>) {
        if let Ok(true) = env.exception_check() {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
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