# 🗺️ ECHO MESSENGER: MIGRATION ROADMAP

## ФАЗА 0: ЭКСТРЕННАЯ ЛИКВИДАЦИЯ УТЕЧЕК КЛЮЧЕЙ
**Цель:** Приватный ключ НИКОГДА не покидает память Rust-процесса.
**Срок:** 3–5 дней
**Риск:** Высокий (ломается вся существующая крипто-логика на фронте)

### Шаги:

1.  **Удалить команды-утечки из `lib.rs`:**
    - `vault_save_private_key`
    - `vault_load_private_key`
    - `crypto::generate_keys_from_mnemonic` (в текущем виде)

2.  **Переписать `crypto.rs`:**
    - Создать `KeyStore` struct, который хранит приватный ключ в `Zeroizing<[u8; 32]>` внутри Rust.
    - Реализовать правильное вычисление публичного ключа через `x25519-dalek` (с clamping по RFC 7748). Устранить расхождение с tweetnacl-js.
    - Новые команды:
        - `crypto_derive_keys(mnemonic) → { public_key }` (приватный остаётся в KeyStore)
        - `crypto_encrypt(recipient_pubkey, plaintext) → { ciphertext, nonce }`
        - `crypto_decrypt(sender_pubkey, ciphertext, nonce) → plaintext`
        - `crypto_sign(message) → signature`
        - `crypto_verify(sender_pubkey, message, signature) → bool`
    - **НИ ОДНА команда не возвращает приватный ключ или seed.**

3.  **Переписать `vault.rs`:**
    - Убрать `vault_save/load_private_key`.
    - Vault теперь шифрует/расшифровывает **только данные БД** (токены, настройки).
    - Ключ Vault деривируется из user credentials (пароль или seed hash), а не device-only. Добавить `vault_derive_key(user_secret)`.
    - При logout: `zeroize()` ключа в памяти + удаление файла `.echo_key.bin`.

4.  **Полная переделка `use-e2ee.ts`:**
    - Удалить `privateKeyRef`, `nacl.box`, `decodeBase64(privateKey)`.
    - Удалить `tweetnacl` и `tweetnacl-util` из `package.json`.
    - Хук становится тонким proxy:
        ```
        encryptMessage(text, recipientId) → invoke('crypto_encrypt', { ... })
        decryptMessage(ciphertext, nonce, senderId) → invoke('crypto_decrypt', { ... })
        ```
    - Фронтенд работает ТОЛЬКО с публичными ключами и шифротекстом.

5.  **Обновить `storage.rs`:**
    - Убрать двойное шифрование seed.
    - Таблица `accounts`: убрать колонку `encrypted_seed`. Seed больше не хранится в БД вообще. Он деривируется из mnemonic при каждом запуске или хранится только в KeyStore в памяти.
    - Если нужно восстановление по seed — mnemonic шифруется Vault-ключом (один слой), но **никогда не передаётся на фронтенд**.

### Критерии завершения Фазы 0:
- [ ] `grep -r "private_key" src-tauri/src/` не находит ни одного возврата приватного ключа в IPC-командах
- [ ] `grep -r "tweetnacl" app/ hooks/ lib/` возвращает пустой результат
- [ ] `grep -r "privateKeyRef" hooks/` возвращает пустой результат
- [ ] Unit-тесты в Rust: derive → encrypt → decrypt roundtrip проходит корректно
- [ ] Ручный тест: авторизация → отправка сообщения → получение → расшифровка работают через новый IPC
- [ ] DevTools → Memory → поиск по приватному ключу возвращает 0 результатов

---

## ФАЗА 1: SQLCIPHER + ВЕРСИОНИРОВАННЫЕ МИГРАЦИИ
**Цель:** Весь файл БД зашифрован. Метаданные не видны. Миграции надёжны.
**Срок:** 2–3 дня
**Зависимость:** Фаза 0 (Vault должен быть исправлен первым)
**Риск:** Средний (миграция данных, возможная потеря при ошибке)

### Шаги:

1.  **Заменить `rusqlite` на `rusqlite` с feature `bundled-sqlcipher`:**
    - В `Cargo.toml`: `rusqlite = { version = "...", features = ["bundled-sqlcipher"] }`
    - В `storage.rs`: `Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | ...)` + `PRAGMA key = '...'`
    - Ключ БД деривируется из Vault-ключа (не хранится отдельно).

2.  **Внедрить `refinery` для миграций:**
    - Создать `src-tauri/migrations/V001__initial_schema.sql`, `V002__add_messages_index.sql`, etc.
    - Удалить runtime ALTER TABLE логику из `StorageManager::new()`.
    - Миграции запускаются один раз при старте, до инициализации Vault.
    - Версия схемы хранится в таблице `refinery_schema_history`.

3.  **Разделить чувствительные и публичные данные:**
    - Таблица `auth_progress` → разделить на `secure_store` (ключи, токены, зашифровано) и `app_settings` (темы, обои, открытый текст внутри зашифрованной БД).
    - Убрать использование `auth_progress` как универсального key-value.

4.  **Заменить `Mutex<Connection>` на connection pool:**
    - Внедрить `deadpool-sqlite` или `r2d2_sqlite`.
    - Pool size: 3–4 соединения (чтение/запись/фоновая синхронизация).

5.  **Миграция существующих данных:**
    - Написать one-time скрипт: открыть старую SQLite → прочитать все данные через старый Vault → создать новую SQLCipher БД → записать данные через новый Vault.
    - После успешной миграции: удалить старый `echo.db`.
    - Обработать ошибку миграции: не удалять старую БД, показать пользователю экран восстановления.

### Критерии завершения Фазы 1:
- [ ] `sqlite3 echo.db .dump` требует пароль и не показывает метаданные
- [ ] `refinery migrate` выполняется без ошибок на чистой установке
- [ ] `refinery migrate` идемпотентен (повторный запуск не ломает схему)
- [ ] Connection pool работает без deadlock при параллельных запросах
- [ ] Все существующие данные мигрированы и читаются корректно

---

## ФАЗА 2: АБСТРАКЦИИ НАД ТРАНСПОРТОМ / PUSH / AUTH
**Цель:** Supabase/FCM становятся подключаемыми адаптерами, а не хардкодом. Подготовка к mesh.
**Срок:** 4–6 дней
**Зависимость:** Фаза 1
**Риск:** Средний (рефакторинг интерфейсов, регрессия онлайн-функционала)

### Шаги:

1.  **Вынести конфигурацию из кода:**
    - Создать `config.toml` / `config.json` в `app_data_dir`.
    - Supabase URL/key, FCM project ID — загружаются из конфига при старте.
    - Удалить hardcoded значения из `lib.rs`.
    - Конфиг опционален: если отсутствует → offline-only режим.

2.  **Создать trait'ы в Rust:**
    ```
    trait AuthProvider: authenticate(), refresh_token(), logout()
    trait MessageTransport: send(), receive(), subscribe()
    trait PushTransport: register_device(), wake_up(), poll()
    trait KeyExchange: initiate_pairing(), complete_pairing()
    ```
    - Каждая trait имеет async методы.
    - Реализации: `SupabaseAuth`, `FcmPush`, `LocalPollingPush`, `SupabaseRealtimeTransport`.
    - Будущие реализации: `MeshTransport`, `LoRaTransport`, `DataMuleTransport`.

3.  **Рефакторинг `notification.rs`:**
    - `NotificationManager` принимает `Box<dyn PushTransport>` вместо Supabase credentials.
    - FCM-реализация инкапсулирована в `FcmPushTransport`.
    - Добавлена `LocalPollingPushTransport` (foreground service stub).

4.  **Рефакторинг `qr_auth.rs`:**
    - `KeyExchange` trait с двумя реализациями: `SupabaseKeyExchange` (текущая) и `LocalSocketKeyExchange` (заглушка для будущего).
    - QR-код содержит только публичный ключ + metadata, не credentials.

5.  **Рефакторинг `lib.rs`:**
    - Dependency injection через builder pattern.
    - Выбор реализации транспорта зависит от конфига и доступности сети.
    - Регистрация команд через модульные плагины (`crypto_plugin`, `storage_plugin`, `transport_plugin`).

### Критерии завершения Фазы 2:
- [ ] Приложение запускается без Supabase credentials (offline-only mode)
- [ ] `grep -r "supabase" src-tauri/src/` находит только адаптер, не бизнес-логику
- [ ] `grep -r "hardcoded\|AZAFBfQ2" src-tauri/` возвращает пустой результат
- [ ] Можно добавить новую реализацию `PushTransport` без изменения `NotificationManager`
- [ ] Онлайн-функционал (auth, realtime, push) работает как раньше через адаптеры

---

## ФАЗА 3: ДЕКОМПОЗИЦИЯ ФРОНТЕНД-МОНОЛИТА
**Цель:** `page.tsx` перестаёт быть god-component. Код тестируем и поддерживаем.
**Срок:** 5–7 дней
**Зависимость:** Фаза 0 (новый crypto API), Фаза 2 (новые хуки)
**Риск:** Низкий (чисто фронтенд, не ломает бэкенд)

### Шаги:

1.  **Выделить страницы/экраны:**
    - `ChatListView` — список чатов
    - `ChatView` — переписка
    - `UserProfileView` — просмотр профиля
    - `SettingsView` — настройки
    - `AuthView` — авторизация (уже частично есть)

2.  **Выделить state management:**
    - Zustand / Jotai store для чатов, сообщений, контактов.
    - Убрать useState/useEffect из page.tsx.
    - Store подписывается на Tauri events, а не поллит Supabase напрямую.

3.  **Разбить хуки по ответственности:**
    - `use-e2ee.ts` → уже переписан в Фазе 0
    - `use-messages.ts` → разделить на `use-send-message`, `use-receive-message`, `use-message-store`
    - `use-realtime.ts` → заменить на `use-transport-subscription` (абстракция из Фазы 2)
    - `use-profiles.ts` → разделить на `use-my-profile`, `use-contact-profile`

4.  **Компонентная декомпозиция:**
    - `message-bubble.tsx`, `chat-sidebar.tsx`, `profile-edit-panel.tsx` — уже существуют, но зависят от page.tsx state.
    - Перевести на props + store subscriptions.
    - Вынести бизнес-логику из компонентов в hooks/stores.

5.  **Типизация:**
    - Генерация TS-типов из Rust через `specta` или `ts-rs`.
    - Удалить ручные типы в `hooks/echo/types.ts`.
    - Строгая типизация всех IPC-вызовов.

### Критерии завершения Фазы 3:
- [ ] `page.tsx` < 200 строк (только роутинг и layout)
- [ ] Каждый компонент/hook < 300 строк
- [ ] Нет прямых вызовов `supabase` в компонентах (только через stores/adapters)
- [ ] TS-типы генерируются автоматически из Rust
- [ ] ESLint/TSC проходят без ошибок

---

## ФАЗА 4: ИНТЕГРАЦИЯ P2P-ТРАНСПОРТА (MESH PREP)
**Цель:** Локальный mesh, Wi-Fi NAN, Data Mules.
**Срок:** 2–4 недели
**Зависимость:** Фазы 0–3 полностью завершены
**Риск:** Высокий (новая сложная функциональность)

> ⚠️ **Эта фаза НЕ начинается, пока Фазы 0–3 не пройдены.**
> Без правильного фундамента mesh-код станет ещё одним слоем AI slop.

### Направления (детальный план формируется после завершения Фазы 3):
- Bluetooth LE + Meshtastic adapter
- Wi-Fi NAN / Multipeer Connectivity adapter
- TTL-based routing + summary vectors
- Foreground Service (Android) / Background Fetch (iOS)
- Data Mule protocol
- Ionospheric HF link (долгосрочно)

---

## ⚡ ОБЩИЕ ПРАВИЛА ВЫПОЛНЕНИЯ

1.  **Каждая фаза = отдельная ветка + PR + code review (самим собой).**
2.  **Не писать новый функционал во время рефакторинга.** Только замена старого.
3.  **Тесты пишутся ДО кода (TDD) для Фазы 0 и Фазы 1.** Для криптографии и БД это обязательно.
4.  **Коммиты атомарные.** Один коммит = одно логическое изменение. Сообщения в формате Conventional Commits.
5.  **После каждой фазы:** полное ручное тестирование + smoke test на всех таргетах (Desktop, Android, iOS).
6.  **Документация обновляется ВМЕСТЕ с кодом**, не после.
