# Echo Messenger

Кроссплатформенный защищённый мессенджер с E2EE, звонками и FCM-пушами. Стек: Next.js 16 + React 19 + Tauri 2 (Rust) + Supabase.

## Стек

- **Frontend**: Next.js 16, React 19, TypeScript
- **UI**: Tailwind CSS 4, shadcn/ui (Radix UI), Framer Motion, postprocessing
- **3D / FX**: `three`, `@react-three/fiber`
- **Backend**: Supabase (PostgreSQL + Realtime + Auth + Edge Functions)
- **Desktop Runtime**: Tauri 2 (Rust)
- **Crypto**: `tweetnacl` (x25519/crypto_box), `bip39`, AES-256-GCM vault
- **Push**: Supabase Edge Functions + FCM HTTP v1 (`send-message-push`, `send-call-push`)
- **Local Storage**: `rusqlite` (SQLite) + `@tauri-apps/plugin-sql`
- **Notifications**: `@tauri-apps/plugin-notification`, `sonner`
- **Media**: `music-metadata`, `zstd` (TGS), `image` (webp/png/jpeg)
- **Icons**: Tabler Icons (`react-icons/tb`), Lucide React

## Возможности

- E2EE-мессенджер: X25519 + crypto_box, seed phrase BIP-39
- Supabase Auth (телефон/email), хранение ключей в зашифрованном Vault
- Чаты в реальном времени: Supabase Realtime + polling fallback
- Офлайн-очередь: pending-сообщения с локальным temp-id
- QR-авторизация устройств: десктоп ↔ mobile через ephemeral X25519
- WebRTC звонки: SVC (L3T3_KEY), приоритет кодеков AV1>VP9>H.264, min 500 kbps
- FCM data-only push для сообщений и входящих звонков (high-priority, TTL 0s)
- Устройства: гео/VPN-детекция (ipwho.is → ipinfo.io → ipapi.co), карантин 32h
- Темы: CSS-переменные, glassmorphism, обои чатов, оверрайды цветов
- Стикеры: webp, tgs (zstd), webm, png
- Превью ссылок: YouTube + Microlink
- 3D-фон: PixelBlast, ParticleMesh, AnimatedSphere
- Публичные профили: `/p?u=<username>`
- Call log (не E2EE JSON в `messages.type = call_log`)
- Мультиаккаунт, i18n: RU, EN, DE, FR, ES, IT, PT, ZH, JA, AR
- Уведомления: on-screen toaster + системные (Tauri plugin) + background polling
- Сетевые режимы: `direct` / `relay` / `normal`

## Структура проекта

```
echo-tauri/
├── app/
│   ├── page.tsx                         # Session check → /app or /auth
│   ├── layout.tsx
│   ├── globals.css
│   ├── auth/
│   │   ├── page.tsx                     # Phone/email + BIP-39 + device register
│   │   └── qr/
│   │       └── page.tsx                 # QR pairing approval
│   ├── app/
│   │   └── page.tsx                     # Main app (chats, messages, calls)
│   ├── p/
│   │   ├── page.tsx                     # Static profile route
│   │   └── PublicProfilePage.tsx        # Public profile viewer
│   └── components/
│       ├── MainApp.tsx
│       ├── PixelBlast.tsx
│       ├── ParticleMesh.tsx
│       └── WelcomeScreen.tsx
│
├── components/
│   ├── auth/
│   │   └── country-selector.tsx
│   ├── echo/
│   │   ├── animated-sphere.tsx
│   │   ├── app/
│   │   │   ├── settings-modal.tsx       # Settings + devices + profile
│   │   │   ├── message-bubble.tsx       # Bubble, reactions, edit, reply
│   │   │   ├── message-context-menu.tsx
│   │   │   ├── media-picker.tsx         # Stickers / gif / media
│   │   │   ├── link-preview.tsx
│   │   │   ├── chat-sidebar.tsx
│   │   │   ├── chat-wallpaper.tsx
│   │   │   ├── chat-background-picker.tsx
│   │   │   ├── interface-settings.tsx
│   │   │   ├── profile-edit-panel.tsx
│   │   │   ├── profile-view-panel.tsx
│   │   │   ├── qr-login-scanner.tsx
│   │   │   ├── mobile-tab-bar.tsx
│   │   │   ├── CallLogMessage.tsx
│   │   │   └── CallOverlay.tsx
│   │   └── ...
│   ├── StickerRenderer.tsx
│   ├── theme-provider.tsx
│   └── ui/                              # shadcn/ui primitives
│
├── hooks/
│   ├── use-mobile.ts
│   ├── use-toast.ts
│   ├── use-translation.ts               # i18n dictionary
│   └── echo/
│       ├── types.ts
│       ├── use-echo-app.ts
│       ├── use-e2ee.ts                  # X25519 encrypt/decrypt
│       ├── use-messages.ts              # Send/read + push diagnostics
│       ├── use-realtime.ts              # Postgres changes + broadcast
│       ├── use-notifications.ts
│       ├── use-notification-settings.ts
│       ├── use-chat-list.ts
│       ├── use-profiles.ts
│       ├── use-profile-details.ts
│       ├── use-connection.ts            # direct/relay/normal
│       ├── use-network-queue.ts
│       ├── use-contact-accent.ts
│       ├── use-fcm.ts                   # FCM token registration
│       ├── use-webrtc-call.ts           # WebRTC + SDP/ICE signaling
│       └── call-log.ts
│
├── lib/
│   ├── supabase.ts                      # Supabase client
│   ├── db.ts                            # Native SQLite + device sessions
│   ├── device-info.ts                   # OS/browser + geo/VPN detection
│   ├── fcm.ts                           # FCM token getter (native + JS fallback)
│   ├── firebase.ts                      # Legacy artifact
│   ├── auth-hydrator.ts                 # Session restore
│   ├── auth-storage.ts                  # Auth progress persistence
│   ├── sticker-decoder.ts               # Sticker formats via Tauri IPC
│   ├── color.ts
│   ├── utils.ts
│   └── themes/
│       ├── types.ts
│       ├── defaults.ts
│       └── engine.ts                    # CSS vars, glass, wallpaper, icons
│
├── supabase/
│   ├── config.toml
│   ├── functions/
│   │   ├── send-message-push/           # FCM data-only push for messages
│   │   └── send-call-push/              # FCM data-only push for calls
│   └── migrations/
│       └── 0006_devices.sql             # devices schema: TEXT id, geo, VPN, RLS
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs                       # Tauri commands + init
│   │   ├── crypto.rs                    # BIP-39 + x25519 keygen
│   │   ├── vault.rs                     # AES-256-GCM encrypt/decrypt
│   │   ├── storage.rs                   # SQLite: devices, themes, wallpapers, sessions
│   │   ├── notification.rs              # FCM token, polling, settings
│   │   ├── qr_auth.rs                   # QR E2EE key exchange
│   │   └── stickers.rs                  # webp/tgs/webm/png decoders
│   ├── capabilities/
│   │   └── default.json
│   ├── tauri.conf.json
│   ├── Cargo.toml
│   └── gen/schemas/
│
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── CHANGELOG.md
└── README.md
```

## Архитектура и ключевые решения

### Авторизация и ключи
- Вход по телефону/email через Supabase Auth.
- BIP-39 seed phrase для восстановления.
- E2EE-ключи: x25519 (`crypto_box`), private key хранится в AES-256-GCM Vault (SQLite), localStorage не используется.

### Устройства и безопасность
- Устройства сохраняются в нативный SQLite и синхронизируются с Supabase (`devices`, upsert по `user_id, hwid`).
- `device_tokens` хранит FCM-токен получателя для edge-функций.
- Гео/VPN-детекция через цепочку `ipwho.is → ipinfo.io → ipapi.co`; при расхождении IP/таймзоны — `is_vpn = true`.
- Новые устройства проходят 32-часовой карантин; в это время блокируются действия с приватными настройками.
- RLS на `devices` + SECURITY DEFINER-функция `terminate_device_session` для безопасного завершения сессий.

### Сообщения
- E2EE: `nacl.box` перед INSERT в `messages`.
- Realtime: `postgres_changes` INSERT/UPDATE + fallback polling.
- Push: data-only FCM HTTP v1 через edge-функции. В пуш не попадает контент, только метаданные.
- Типы: `text`, `sticker`, `gif`, `call_log` (системные логи звонков, не шифруются).

### Звонки
- WebRTC signaling через Supabase Realtime Broadcast (эфемерные каналы, без записи в БД).
- ICE: публичные Google/Stunman STUN; российские серверы категорически запрещены.
- Кодеки: AV1 > VP9 > H.264, SVC `L3T3_KEY`, min bitrate 500 kbps.
- FCM high-priority data-only пуш будит Tauri-бэкенд из сна.
- Call logs: INSERT в `messages` с `type = call_log`, статус `missed/outgoing/incoming`, длительность.

### Темы и UI
- Движок тем: CSS-переменные + glassmorphism + color override.
- Обои чатов: solid/doodle/photo с blur режимом.
- Иконки приложения: сменные пресеты (default/neon-cyber/minimal-dark).

### Стикеры
- Поддерживаемые форматы: webp, tgs (zstd), webm, png.
- Декодинг через Rust + отрисовка на `<canvas>`.

## Запуск

### Требования

- Node.js >= 18, pnpm
- Rust 1.77+ (для Tauri)
- Supabase проект

### Команды

```bash
pnpm install
pnpm dev                 # Next.js dev server
pnpm tauri dev           # Tauri desktop (dev)
pnpm build               # Next.js build
pnpm tauri build         # Tauri desktop (prod)
pnpm lint
```

### Переменные окружения

Файлы: `.env.local`, `.env.production`

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=<project_url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>

# Firebase / FCM (для Edge Functions push)
FIREBASE_PROJECT_ID=echo-mes
FIREBASE_ACCESS_TOKEN=<service_account_oauth2_token>
```

Примечание: `NEXT_PUBLIC_*` переменные брендинга/аналитики можно оставить пустыми.

### База данных

Применить миграции Supabase:
```bash
supabase migration up
```

Миграция `0006_devices.sql`:
- `devices.id` → TEXT (идемпотентно для существующих UUID).
- Новые колонки: `device_type`, `os_name`, `browser_name`, `ip_address`, `location`, `timezone`, `is_vpn`.
- Уникальный индекс `(user_id, hwid)`.
- RLS + `terminate_device_session`.

### Edge Functions

Развёртывание (пример):
```bash
supabase functions deploy send-message-push
supabase functions deploy send-call-push
```

Не забудьте установить секреты в Supabase:
```bash
supabase secrets set FIREBASE_PROJECT_ID=echo-mes
supabase secrets set FIREBASE_ACCESS_TOKEN=...
```

## Деплой фронтенда (Tauri)

Сборка веб-фронтенда для Tauri:
```bash
pnpm build
```

Сборка десктопного бинаря:
```bash
pnpm tauri build
```

Иконки/брендинг обновляются через `pnpm tauri icon`.

## Известные ограничения

- Основная логика мессенджера сконцентрирована в `app/app/page.tsx` (~1500+ строк).
- Отдельных страниц `ChatView`, `ChatList`, `UserProfile`, `ProfilePage` нет.
- Профиль живёт внутри `settings-modal.tsx` + фрагментами в `app/app/page.tsx`.
- TURN-релеи пока заглушка (запланировано внедрение coturn на EU-инфраструктуре).
- Иконки Android генерируются через `pnpm tauri icon`.

## Безопасность

- E2EE end-to-end: контент сообщений не хранится в открытом виде.
- Push-уведомления data-only: в системную шторку попадают только метаданные, контент не раскрывается.
- В `messages` только `call_log` не шифруется намеренно.
- Защита от СОРМ: ICE-сигналы идут только через независимые STUN (Google/Stunman), российские серверы не используются.
- Логирование чувствительных данных сведено к минимуму; фолбэки гео-сервисов тихие.

## License

GNU General Public License v3.0 — Echo Messenger
