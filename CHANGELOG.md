# Changelog

## [0.3.0] - 2026-09-18
### Shield Media, голосовые, файлы и raw-bytes IPC — полный E2EE-контур медиа

#### Добавлено
- **Системное открытие файлов на мобильных** (`src-tauri/src/file_open.rs`):
  команды `open_file_system(path, mime)` и `open_file_ios(path)`.
  • **Android** — `FileProvider.getUriForFile()` (content:// URI) + `Intent.createChooser(ACTION_VIEW)`
    с `FLAG_GRANT_READ_URI_PERMISSION`: юзер выбирает приложение, как в Telegram.
    authority собирается в рантайме из applicationId (`Context.getPackageName()` + `.fileprovider`) —
    хардкода нет, смена applicationId в gradle ничего не ломает. mime — честный, из меты файла.
    Нет вьюера для mime (`queryIntentActivities` пуст или `ActivityNotFoundException`) →
    `Err("no-app-for-mime")`. Дополнительно: нет файла по пути → `Err("file-not-found")`.
  • **iOS** — Swift-мост `gen/apple/Sources/app/EchoFileOpener.swift`
    (`@_cdecl("echo_open_file_ios")`): `QLPreviewController` с одним `QLPreviewItem`,
    презентация модалкой поверх rootViewController с анимацией (системный предпросмотр).
    Rust вызывает его через `run_on_main_thread` (UIKit — только main thread) и ждёт код ответа.
    tauri-plugin-скелет не нужен: Swift-файл компилируется в тот же бинарник.
  • На не-мобильных таргетах обе команды → `Err("unsupported")`; desktop-путь `openPath` не тронут.
- `gen/android/.../res/xml/file_paths.xml`: корни `cache-path` (AppCache = `Activity.getCacheDir()`,
  куда пишет `ensureCachedFile`), `files-path`, `external-cache-path`, `external-files-path`,
  `external-path` — иначе `getUriForFile()` падает с IllegalArgumentException.
- `<queries>` (ACTION_VIEW + `mimeType="*/*"`) в `AndroidManifest.xml`: без него на Android 11+
  `queryIntentActivities()` не видит чужие приложения и проверка «нет вьюера» врала бы.
- **Мини-плеер аудио-файлов** (`components/echo/app/audio-file-bubble.tsx`): файлы с
  `meta.mime.startsWith("audio/")` играются прямо в баббле — круглая Play/Pause, ЛИНЕЙНЫЙ
  прогресс-бар (волна осталась только у голосовых, чтобы их не путать), длительность из
  `loadedmetadata` («—:—» пока неизвестна), seek кликом по бару, повтор после конца — с начала,
  спиннер на месте кнопки при загрузке. Ленивая загрузка: сеть/расшифровка только по первому
  Play (`ensureCachedFile` → `readFile` → `blob:` URL); blob живёт в компоненте и
  `revokeObjectURL()` на размонтировании (глобального кэша, как `voiceUrlCache`, нет).
- **Клиентское шифрование медиа (Rust `media.rs`)**: медиа шифруется
  AES-256-GCM **до** загрузки в Supabase Storage. Медиа-ключ —
  детерминированный `HKDF-SHA256(ikm = E2EE seed, info = "echo/media")`
  из уже загруженного в `KeyStore` сида: ключ никогда не покидает Rust.
  Команды: `media_encrypt`, `media_decrypt`, `media_key_status`.
  Unit-тесты: roundtrip + отказ на чужом ключе.
- **Приватные bucket'ы + RLS** (`0007_media_privacy.sql`):
  `avatars`, `tracks`, `publications`, `stories` → `public = false`.
  Чтение — только аутентифицированным через короткоживущий signed-URL,
  запись/удаление — только владельцу. По прямой ссылке — только шифротекст.
- **Фронтенд-слой Shield**: `lib/media.ts` (encrypt/decrypt/compress),
  `hooks/echo/use-secure-media.ts` (`loadSecureMediaUrl` +
  `useSecureMediaUrl`), компоненты `secure-image.tsx` / `secure-avatar.tsx`.
- **Сжатие «как в Telegram»**: canvas-ресайз + WebP Q82
  (аватар ≤512px, обложки ≤1000px, публикации/истории ≤1440px);
  в БД — `storage_path` + `nonce` + `mime` вместо публичных URL
  (`0008_media_columns.sql`).
- **Голосовые сообщения (E2EE + Shield-хранение)**: hold-to-record
  (touch + mouse), свайп вверх → закрепление, свайп влево → отмена,
  живые круги громкости (WebAudio AnalyserNode, без ререндеров).
  Запись — webm/opus (Chromium) или mp4 (WebKit), mime в мете.
- **Файловые сообщения (≤10 МБ)**: прогресс-кольцо в TG-стиле
  (отмена/пауза/повтор), seek-плеер голосовых, drag & drop файлов
  в окно (desktop): геометрический hit-test, блюр-оверлей ChatArea,
  подсветка чата + отложенное открытие (600 мс).
- **Загрузка**: TUS-probe с авто-fallback на POST + ретраи при обрыве
  сети (~64 с). Кэш в AppCache, открытие системным приложением,
  reveal в Finder как fallback, «Скачать» в Downloads из контекст-меню.
- `lib/files.ts` → `openFileMessage`: платформенная ветка (`openPlatform()`):
  android → `invoke("open_file_system", { path: abs, mime })`, ios → `invoke("open_file_ios", { path: abs })`,
  desktop → прежний `openPath`. Абсолютный путь логируется в `[OPEN-MOBILE]` ДО вызова;
  ошибки мобильной ветки → тост «Нет приложения для этого файла» / «Не удалось открыть файл».
- `message-bubble.tsx`: `FileBubble` ветвится по mime — `audio/*` (и файл уже залит,
  `!uploadState`) → `AudioFileBubble`, всё остальное (video/*, документы, архивы) → как было.
  `VoiceBubble`, `ensureCachedFile`, `keyUserFor`, `meta.to` не тронуты (инварианты целы).
- **Raw-bytes IPC для медиа**: `crypto_encrypt_bytes` /
  `crypto_decrypt_bytes` (raw body: `[32B pub][plain]` → `[24B nonce][ct]`)
  — desktop/iOS; `crypto_*_bytes_json` (base64) — Android (raw body там
  невозможен). Общая криптология в `encrypt_inner`/`decrypt_inner` →
  шифротекст `v: 2` идентичен на всех транспортах
  (кросс-инвариант зафиксирован тестом).
- Лимит 10 МБ на трёх уровнях (клиент, бакет, TUS-Upload-Length);
  удаление медиа из Storage при «удалить у всех».

#### Исправлено
- **Расшифровка медиа строилась неверным DH-секретом** — ключ определяется
  второй стороной (`meta.to` для своих, `sender` для входящих), а не
  sender всегда. Добавлено поле `to` в VoiceMeta/FileMeta.
- Файловые сообщения проходили текстовый decrypt-пайплайн →
  «[E2EE Data Error]»/невидимость после перезагрузки.
- `BaseDirectory.Cache` vs `appCacheDir()` mismatch — файлы «исчезали»
  после перезапуска.
- Context menu не работал на voice/file бабблах.
- Hold-to-record на ПК: очистка hold-таймера при микродвижениях мыши
  отбраковывала запись — таймер чистится только для touch.
- Починен тест `device_bound_roundtrip_and_hwid_change` в `crypto.rs`.

#### Изменено
- Медиа-конвейер (voice/files) переведён с двойного base64 на сырые
  байты: −25% IPC payload, −62% пиковая память JS на 7.4 МБ файле.
  Мета: `v: 2`; legacy-сообщения играются через старый путь.
- Транспорт IPC выбирается детерминированно по UA (Android → json,
  остальные → raw). Транспорт не влияет на формат хранения.
- Отображение защищённого медиа подключено: профиль (3 уровня аватара),
  шапка чата, сайдбар (список + поиск), мини-карточка упоминания,
  обложка «сейчас играет», сетка публикаций.
- Legacy-медиа (залитые по публичным ссылкам) продолжают отображаться
  по прежним ссылкам.

#### Инварианты (НЕ нарушать)
- Hold-таймер записи НЕ отменяется движением мыши (ПК сломан дважды).
- Ключ расшифровки медиа = вторая сторона DH, не sender.
- `String::from_utf8` запрещён в media-командах (plaintext — произвольные
  байты).
- `elementFromPoint` врёт во время нативного drag — только
  getBoundingClientRect.
- over-события Tauri v2 НЕ содержат `paths` — гарды на paths убивают их.
- `BaseDirectory.Cache` ≠ `appCacheDir()` — читать/писать одну директорию.
- Новый type в `messages_type_check` — только полным списком
  существующих типов.

#### Прочее
- `crypto.rs`: `KEY_SIZE` экспортирован (`pub`) для `media.rs`.
- Транспорт-пробник (raw IPC) на MockRuntime: 5/5; cargo test 18/18;
  Node-тест раскладки байтов 8/8.
- Проверки релиза: `cargo check` (desktop) и `cargo check --target
  aarch64-linux-android` — 0 ошибок (из `file_open.rs` предупреждений нет);
  `npx tsc --noEmit` — чисто. `xcodebuild`/Xcode на Linux-машине недоступен:
  Swift проверен ревью и подключён через `project.pbxproj`; живой прогон
  (PNG/PDF/md/mp4 + mp3) — на устройствах (S25, iPhone 13 Pro).

## [0.2.9] - 2026-09-16
## [Фаза 1] — SQLCipher + версионированные миграции

### Добавлено
- **SQLCipher шифрование БД**: `rusqlite` с feature `bundled-sqlcipher` —
  весь файл `echo.db` зашифрован. Системный `sqlite3 .dump` без ключа
  не возвращает метаданные.
- **Двухслойная модель ключей**: DB-ключ device-bound (Argon2id от HWID +
  соль, расширен через HKDF-SHA256 в sub-key `echo/db-cipher`), Vault-ключ
  от seed пользователя по-прежнему шифрует чувствительные строки
  (seed, токены, OTP). Никакого `PRAGMA rekey` — безопасно для
  мультиаккаунта и boot-до-логина.
- **Собственный connection pool**: 4 пред-ключованных SQLCipher-соединения
  в LIFO-очереди. `PoolGuard` derefs на `rusqlite::Connection`, поэтому
  все 22 существующие `conn.lock()` вызова работают без изменений.
- **Версионированные миграции** (`migrations/V001__initial_schema.sql`,
  `V002__split_auth_progress.sql`): идемпотентные, транзакционные,
  версия хранится в `refinery_schema_history` (version + checksum).
  Запускаются один раз при старте, до инициализации Vault.
- **`secure_store` / `app_settings`**: таблица `auth_progress`
  семантически разделена. `active_theme_id` → `app_settings`
  (публичные настройки внутри зашифрованной БД), всё остальное
  (`seed`, токены, `auth_progress` JSON) → `secure_store`.
  `auth_progress` помечена DEPRECATED, больше не пишется новым кодом.
- **Один разовый миграционный скрипт**: `migrate_legacy_to_sqlcipher()`
  переносит существующие plaintext-БД в SQLCipher. При ошибке старый
  файл **не удаляется** — показывается экран восстановления.
- **HKDF** (`hkdf = "0.12"`) для domain-separated расширения
  device-ключа в под-ключи.

### Изменено
- `Cargo.toml`: `rusqlite` → `features = ["bundled-sqlcipher"]`
- `storage.rs`: `Mutex<Connection>` → `Pool` (4 соединения).
  `run_migrations()` заменяет runtime `CREATE TABLE`/`ALTER TABLE`
  логику в `StorageManager::new()`.
- Порядок init в `lib.rs` сохранён: storage (таблицы + миграции) → vault.

### Безопасность
- HWID-смена: БД становится недоступной (ключ не деривируется) →
  файл архивируется в `echo.db.stale`, recovery мнемоникой.
- Никаких rekey-операций (исключает риск битой БД при прерывании).

### Тесты (все 8 pass)
- `pool_concurrent_queries_no_deadlock` — 8 паралл. потоков, 0 deadlock.
- `legacy_db_migrates_to_sqlcipher_and_reads_back` — миграция данных.

## [0.2.8] - 2026-08-21

### Исправлено (Android)
- **SQLCipher на Android**: `bundled-sqlcipher` в одиночку не собирается под
  `aarch64-linux-android` — SQLCipher падает в дефолтный крипто-бэкенд
  OpenSSL и не может найти `<openssl/crypto.h>` в NDK. Добавлена
  таргетная перегрузка зависимости для Android c
  `bundled-sqlcipher-vendored-openssl`: собирает и статически линкует
  OpenSSL 3 (openssl-src) через openssl-sys, отдаёт заголовки через
  `DEP_OPENSSL_INCLUDE`. Десктоп/iOS не затронуты (системный OpenSSL /
  CommonCrypto). Валидировано: release-сборка `aarch64-linux-android`
  завершается без ошибок (1m45s).
- В `Cargo.lock` добавлены `openssl-src` и `openssl-sys`.

## [0.2.7] - 2026-08-14
## [Фаза 0] — ЭКСТРЕННАЯ ЛИКВИДАЦИЯ УТЕЧЕК КЛЮЧЕЙ

### Шаги:

1.  **Удаленны команды-утечки из `lib.rs`:**
  - `vault_save_private_key`
  - `vault_load_private_key`
  - `crypto::generate_keys_from_mnemonic` (в текущем виде)

2.  **Переписан `crypto.rs`:**
  - Создано `KeyStore` struct, который хранит приватный ключ в `Zeroizing<[u8; 32]>` внутри Rust.
  - Реализованно правильное вычисление публичного ключа через `x25519-dalek` (с clamping по RFC 7748). Устраннено расхождение с tweetnacl-js.
  - Новые команды:
    - `crypto_derive_keys(mnemonic) → { public_key }` (приватный остаётся в KeyStore)
    - `crypto_encrypt(recipient_pubkey, plaintext) → { ciphertext, nonce }`
    - `crypto_decrypt(sender_pubkey, ciphertext, nonce) → plaintext`
    - `crypto_sign(message) → signature`
    - `crypto_verify(sender_pubkey, message, signature) → bool`
  - **НИ ОДНА команда не возвращает приватный ключ или seed.**

3.  **Переписан `vault.rs`:**
  - Убран `vault_save/load_private_key`.
  - Vault теперь шифрует/расшифровывает **только данные БД** (токены, настройки).
  - Ключ Vault деривируется из user credentials (пароль или seed hash), а не device-only. Добавить `vault_derive_key(user_secret)`.
  - При logout: `zeroize()` ключа в памяти + удаление файла `.echo_key.bin`.

4.  **Полная переделка `use-e2ee.ts`:**
  - Удалено `privateKeyRef`, `nacl.box`, `decodeBase64(privateKey)`.
  - Удалено `tweetnacl` и `tweetnacl-util` из `package.json`.
  - Хук становится тонким proxy:
      ```
      encryptMessage(text, recipientId) → invoke('crypto_encrypt', { ... })
      decryptMessage(ciphertext, nonce, senderId) → invoke('crypto_decrypt', { ... })
      ```
  - Фронтенд работает ТОЛЬКО с публичными ключами и шифротекстом.

5.  **Обновлеенно `storage.rs`:**
  - Убрано двойное шифрование seed.
  - Таблица `accounts`: убрана колонка `encrypted_seed`. Seed больше не хранится в БД вообще. Он хранится только в KeyStore в памяти.
  - Если нужно восстановление по seed — mnemonic шифруется Vault-ключом (один слой), но **никогда не передаётся на фронтенд**.

### Критерии завершения Фазы 0:
- [✔] `grep -r "private_key" src-tauri/src/` не находит ни одного возврата приватного ключа в IPC-командах
- [✔] `grep -r "tweetnacl" app/ hooks/ lib/` возвращает пустой результат
- [✔] grep -r "privateKeyRef" hooks/ возвращает пустой результат
- [✔] Unit-тесты в Rust: derive → encrypt → decrypt roundtrip проходит корректно
- [✔] Ручный тест: авторизация → отправка сообщения → получение → расшифровка работают через новый IPC
- [✔] DevTools → Memory → поиск по приватному ключу возвращает 0 результатов

## [0.2.6] - 2026-08-06
### Fixed

### Added
- **Multi-provider geo + VPN detection** (`lib/device-info.ts`): cross-platform detector определяет ОС/браузер/тип устройства, получает гео по IP через цепочку `ipwho.is` → `ipinfo.io` → `ipapi.co` и считает VPN при несовпадении IP-таймзоны и таймзоны устройства. Используется и при регистрации, и в реальном времени в Settings → Devices.
- **Supabase migration `0006_devices.sql`**: `devices.id` изменён с UUID на TEXT (приложение пишет `device_<uuid>_<ts>`), добавлены колонки `device_type`, `os_name`, `browser_name`, `ip_address`, `location`, `timezone`, `is_vpn`, создан уникальный индекс `(user_id, hwid)`, добавлены RLS-политики и SECURITY DEFINER-функция `terminate_device_session` для удаления чужих сессий.

### Changed
- **`lib/db.ts`**: интерфейс `Device` и `saveDevice` расширены новыми полями гео/устройства; SQLite слой теперь принимает и сохраняет `device_type`, `os_name`, `browser_name`, `ip_address`, `location`, `timezone`, `is_vpn`.
- **`src-tauri/src/storage.rs`**: схема SQLite `devices` расширена новыми колонками, добавлена идемпотентная авто-миграция существующих таблиц, `save_device`/`get_devices` возвращают и принимают расширенный набор полей.
- **`app/app/page.tsx`**: при регистрации устройства вызывается `detectDevice(true)` и собираются метаданные ОС/браузера/гео; запись в нативный SQLite и Supabase выполняется через `upsert` по `(user_id, hwid)` с фолбэком на базовый набор колонок; при перелогине метаданные устройства обновляются, а устаревшие локальные записи с другим `hwid` очищаются.
- **Settings → Devices** (`components/echo/app/settings-modal.tsx`): локация/VPN отображается "живым" гео текущего устройства даже если запись в БД устарела; добавлена плашка карантина с таймером, блокирующая смену приватных настроек для новых устройств в течение 32 часов; улучшена иконка платформы (iOS/macOS/Windows/Linux/ChromeOS).

### Security
- **Push diagnostic**: `send-message-push` и `send-call-push` в клиенте (`hooks/echo/use-messages.ts`, `app/app/page.tsx`) теперь логируют результат/ошибку edge-функции с полным контекстом (`e?.context ?? e?.message ?? e`), чтобы видеть 404 (не задеплоена), 500 (секреты FCM) или `skipped: no_device_token` (у получателя нет токена).
- Карантин нового устройства: действия с приватными настройками блокируются до окончания 32-часового периода.
- RLS + SECURITY DEFINER-функция `terminate_device_session` исключают возможность удаления чужих сессий из клиента.
- Гео-детекция не раскрывает детали ошибок внешних сервисов в UI, все фолбэки тихие.

### Fixed
- `invalid input syntax for type uuid: "device_..."` при регистрации устройства — `devices.id` приведён к TEXT в миграции, клиент и Rust пишут строковые идентификаторы.
- Отображение "iOS Chrome" / "Linux armv8l" в списке устройств — канонизация ОС через `userAgent`/`userAgentData` и явная карта иконок.
- Пустые или устаревшие локации/VPN в Devices — теперь показывается live-гео текущей сессии; при VPN-расхождении в `location` сохраняются оба варианта через `/`.

## [0.2.5] - 2026-08-02

### Added
- **Edge Function `send-call-push`** (`supabase/functions/send-call-push/index.ts`): отправляет высокоприоритетный FCM **data-only** пуш для пробуждения Tauri/Rust-бэкенда Android из глубокого сна. Принимает `target_fcm_token`, `room_id`, `caller_id`, `caller_name`, `caller_avatar`; отправляет на `https://fcm.googleapis.com/v1/projects/<PROJECT_ID>/messages:send` с `priority: "high"`, `ttl: "0s"` и объектом `data: { type: "incoming_call", ... }`. Объект `notification` **категорически отсутствует** — только data-payload, чтобы ОС не показывала стандартную шторку и Rust мог сам управлять экраном входящего звонка.
- **Call-log helper** (`hooks/echo/call-log.ts`): общий модуль с `CallLogMeta` (`status: "outgoing" | "incoming" | "missed"`, `duration`, `withVideo`), `parseCallLogJson(content)` (безопасный парсинг с фолбэком в `missed` при повреждённом JSON) и `serializeCallLog(meta)` для подготовки payload перед INSERT.
- **Реальный INSERT логов звонков** в `app/app/page.tsx`: `handleCallLog` теперь сериализует метаданные лога в JSON через `serializeCallLog` и выполняет `supabase.from("messages").insert({ ..., type: "call_log", status: "sent" })` вместо оптимистичного append-only в локальный стейт.

### Changed
- **E2EE-пайплайн защищён от `call_log`**:
  - `hooks/echo/use-messages.ts` (fetch истории): добавлен байпас `if (m.type === "call_log")` — для таких сообщений `decryptMessage` не вызывается, вместо этого парсится незашифрованный JSON из `content` и добавляются `call_status`/`call_duration`. Для остальных типов дешифратор обёрнут в `try/catch` (возвращает `"[E2EE Error]"` вместо падения при гонке ключей или bad-padding).
  - `hooks/echo/use-realtime.ts` (INSERT и UPDATE события): добавлен байпас `call_log` в оба обработчика (`postgres_changes` INSERT и UPDATE). Для `call_log`: парсится JSON, сообщение доставляется в чат через `onNewMessage`/`onUpdateMessage` с полями `call_status`/`call_duration`, а в шторку уведомлений передаётся пустая строка (логи не должны отображаться в системных уведомлениях). Для остальных сообщений E2EE-дешифратор работает без изменений.

### Security
- Логи звонков (`type: "call_log"`) **не шифруются E2EE** — поле `content` хранит plain JSON с системными метаданными (`status`, `duration`, `withVideo`). Это сознательное решение: дешифратор `nacl.box.open` вызывается только для приватных сообщений; для системных данных вызов исключён, что исключает падение дешифратора на неожиданных типах и предотвращает утечку padding-ошибок в консоль.
- Edge-функция валидирует входные поля (400 на `missing required fields`), проверяет наличие `FIREBASE_PROJECT_ID`/`FIREBASE_ACCESS_TOKEN` в окружении (500 при misconfiguration) и не раскрывает внутренние детали ошибок FCM клиенту.
- CORS настроен на `Access-Control-Allow-Origin: "*"` + allowlisted методы `POST, OPTIONS` и заголовки `authorization, x-client-info, apikey, content-type`.

---


## [0.2.4] - 2026-08-02

### Added
- **QR-based E2EE key exchange** between desktop (Tauri/React) and mobile (Rust): dynamic QR code replaces the old `echo.app` stub. Desktop generates an ephemeral X25519 keypair via tweetnacl, renders a QR with `app://auth?session_id=<id>&web_pub_key=<base64url>` and subscribes to a Supabase Realtime channel `auth_<id>` via `postgres_changes`.
- **Mobile QR scanner** (`components/echo/app/qr-login-scanner.tsx`): in-app camera scanner using `jsQR`, integrated into Settings → Devices. Parses the deep-link QR, invokes the Rust backend to encrypt the local E2EE key and broadcasts it to the desktop.
- **Rust QR auth module** (`src-tauri/src/qr_auth.rs`): new Tauri command `qr_send_e2ee_key` — loads the E2EE key from the local vault, generates an ephemeral `crypto_box` (XSalsa20-Poly1305 / X25519, tweetnacl-compatible) keypair, encrypts the key, and sends the payload to Supabase via `reqwest` POST to `broadcast_message` RPC.
- **Supabase Realtime transport**: new migration `0003_auth_broadcasts.sql` — `auth_broadcasts` table + `broadcast_message` SECURITY DEFINER RPC + `ALTER PUBLICATION supabase_realtime ADD TABLE auth_broadcasts`. Removes the need for a dedicated WebSocket signaling server.
- **Android CAMERA permission** (`AndroidManifest.xml`): required for the in-app QR scanner.

### Changed
- **QR payload format**: switched from hex to base64url for `web_pub_key`, and shortened query params to `s` (session_id) and `k` (web_pub_key), reducing QR density from version 25+ to version 11 (61×61 modules).
- **QR code size**: increased from 140px to 220px for better mobile camera readability.
- **Camera constraints**: scanner now requests `facingMode: "environment"` with `ideal` width/height 1280×720 and `audio: false`, preferring the main rear camera over ultra-wide (0.6×) lenses.
- **Settings modal**: added "Scan QR to Sign In" button under Devices; scanner overlays the modal without clipping.
- **Vault migration**: private key is now migrated from `localStorage` to Tauri vault before QR login if needed (`migratePrivateKeyToVault`), fixing "Vault is empty" errors for users who previously stored keys in localStorage.

### Fixed
- QR code unscannable on mobile due to excessive density (139 hex chars in 140px QR).
- Ultra-wide camera (0.6×) failing to focus at close range during QR scan.
- `savePrivateKey` silently swallowing vault errors and falling back to localStorage; now throws so the caller can handle the failure.
- Scanner overlay clipped by `overflow-hidden` on the Settings modal (moved overlay to sibling level + added `stopPropagation`).

### Security
- End-to-end encryption: the shared secret is derived via X25519 Diffie-Hellman (ephemeral keypairs) and the E2EE key is sealed with XSalsa20-Poly1305. Supabase only sees ciphertext; keys never leave the devices.
- Ephemeral key material (`webKeyPairRef`) is zeroized from memory after successful exchange or component unmount.
- `broadcast_message` RPC validates that channel names start with `auth_` and uses `SECURITY DEFINER` to prevent privilege escalation.

---

## [0.2.3] - 2026-07-30

### Added
- Public profile page `/p?u=[username]`: sticky header with full Echo logo and a "Скачать" button, avatar, display name, bio and channel subscribers count.
- Primary action button on profile page: "Написать сообщение" (user) / "Перейти в канал" (channel) — checks Supabase session and opens the chat, or redirects to `/auth?returnTo=/p?u=[username]`.
- Secondary button "Открыть в браузере" on profile page — opens the public web profile at `https://echo-mes.vercel.app/@username`.
- Text & Icon color override system: new CSS class `echo-color-override` on `<body>` remaps hardcoded `text-white/X`, `bg-white/X`, and `border-white/X` utilities to theme CSS variables (`--icon-primary`, `--icon-muted`, `--surface-white`) via `color-mix(in oklch, ...)`, so theme colors now affect text and icons without reload.
- New **Block 6 — Text & Icon Colors** in Interface Settings: toggle "Override Hardcoded Colors", "Text Sharpness / Contrast" slider (maps to `--text-sharpness`), "Sync All Text Colors" button, and 7 color pickers (Primary Text, Muted Text, Card Text, Sidebar Text, Icon Primary, Icon Muted, Surface White).
- Exported `applyColorOverride(enabled: boolean)` in `lib/themes/engine.ts`.
- Added `colorOverrideEnabled` and `textSharpness` fields to `LocalThemeState` and wired them through persist/load, export/import, and Supabase sync.
- Settings modal badges: **Beta** for Interface and Alerts; **In Development** for Storage, Network, and Language.
- Settings navigation restructure: Privacy and Devices moved under **Security**.
- Desktop Settings sidebar: Security is now a collapsible accordion with expandable Privacy/Devices sub-items.
- Mobile Settings: Security opens as a separate fullscreen drill-down screen/modal with Privacy and Devices choices.
- Chat wallpapers now use theme-aware colors (`--chat-wallpaper`, `--chat-wallpaper-overlay`, `--icon-primary`) so they adapt to light/dark themes.

### Changed
- `app/p/`: converted dynamic route `[username]` to a static route with a `u` query parameter, because `output: 'export'` (static export for Tauri) does not support runtime dynamic segments.
- `app/p/page.tsx`: new server entry that renders the client component.
- `app/p/PublicProfilePage.tsx`: client component now reads `useSearchParams().get('u')` (wrapped in `<Suspense>` as required by Next 16); rebuilt profile card with sticky header, primary action and browser fallback.
- Deep-link handlers in `app/page.tsx` and `app/app/page.tsx`: all `/p/[username]` navigations replaced with `/p?u=[username]` (including `returnTo`).
- `app/globals.css`: added ~100 new CSS override rules under `body.echo-color-override` plus `--text-sharpness` default in `:root`.
- `components/echo/app/interface-settings.tsx`: extended color items with `TEXT_ICON_ITEMS`, updated theme init/load, preset export/import, and cloud sync to include new override fields.
- `components/echo/app/settings-modal.tsx`: added `Badge` component, `isSecurity` section grouping, `securityExpanded` desktop accordion state, and mobile Security drill-down view.
- `components/echo/app/chat-wallpaper.tsx`: replaced hardcoded dark gradients with theme-aware CSS variables so wallpapers follow the active theme.
- `components/echo/app/mobile-tab-bar.tsx`: restyled hotbar to use theme-aware background and active/muted foreground colors; added active indicator pill.
- `components/echo/app/chat-sidebar.tsx`: replaced hardcoded `text-white/...` in search inputs/placeholders with `text-foreground`, `text-muted-foreground`, `hover:bg-primary/5`, etc., for light-theme readability.

### Fixed
- `GET /p/[username]` returned HTTP 500 ("missing exported function generateStaticParams()" / "dynamicParams: true cannot be used with output: export"). Resolved by moving to a static route + query param.
- Cold start deep-link bug where links were ignored for already authenticated users.
- Added missing deep-link scheme registration for Android in `tauri.conf.json`.
- Missing `?chat=username` parameter handling in the main app (now automatically opens the requested chat).
- UX: User is now redirected directly to the chat after authentication if coming from a profile link.
- Removed unused `Share2`/`Copy` icon imports and the "Скопировать ссылку" button from the profile page.
- TypeScript compilation clean (`npx tsc --noEmit` 0 errors) and Rust check clean (`cargo check` 0 errors) after adding the override system.
- Chat wallpaper dark gradient bleed on light theme; wallpapers now inherit theme colors instead of hardcoded values.
- Mobile hotbar unreadable text on light theme due to hardcoded `text-white/...` utilities.
- Mobile search field unreadable placeholders/borders on light theme due to hardcoded white opacities.

---


## [0.2.2] - 2026-07-28

### Added
- Chat redesign: new message bubbles, improved shell, shadows and states.
- Chat background system: wallpaper presets and background picker.
- Message context menu: reply, edit, copy and related actions.
- Mentions in chat (`@username`) with clickable mini profile cards.
- Profile mini card: avatar, username, display name and bio snippet; separate card styling outside bubble.
- App icon regenerated via `pnpm tauri icon` and linked in app metadata.

### Changed
- `app/layout.tsx`: added app icons.
- `src-tauri/tauri.conf.json`: branding renamed to `Echo`.
- Updated chat/profile panels, accent color helpers and mobile behavior.

### Fixed
- Restored missing/broken app icon after earlier UI changes.
- Bubble/style regressions mentioned in recent bugfix commits.
