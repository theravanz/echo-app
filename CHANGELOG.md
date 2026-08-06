# Changelog

## [0.2.6] - 2026-08-06

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
