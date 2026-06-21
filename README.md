# Echo Messenger

Кроссплатформенный защищённый мессенджер (E2EE) на Next.js + Tauri.

- **Frontend**: Next.js 16, React 19, TypeScript
- **UI**: Tailwind CSS 4, shadcn/ui (Radix UI), Framer Motion
- **Backend**: Supabase (PostgreSQL + Realtime + Auth)
- **Crypto**: `tweetnacl`, `bip39`, `tweetnacl-util`
- **Иконки**: Tabler Icons (`react-icons/tb`), Lucide React
- **3D / FX**: `three`, `@react-three/fiber`, `postprocessing`
- **Уведомления**: `@tauri-apps/plugin-notification`, `sonner`
- **Tauri**: Rust backend, plugin notification + log (debug)

## Возможности

- Регистрация / вход через Supabase Auth
- Чаты в реальном времени через Supabase Realtime
- E2EE: генерация seed phrase, ключей, шифрование/дешифрование сообщений
- Поиск пользователей по `profiles.username` и `profiles.display_name`
- Типы сообщений: text, sticker, gif
- Редактирование, удаление, reply, copy, spoiler, markdown-подобное форматирование
- Офлайн-очередь: pending-сообщения с локальным temp-id
- Сетевые режимы: `direct` / `relay` / `normal`
- Уведомления (Tauri plugin + in-app toaster)
- Настройки: Identity, Security, Alerts, Interface, Network, Storage, Privacy, Devices, Language
- Multi-account bridge (UI-каркас)
- 3D-сцены и visual FX (PixelBlast, AnimatedSphere)
- i18n: RU, EN, DE, FR, ES, IT, PT, ZH, JA, AR

## Структура проекта

```
echo-tauri/
├── app/
│   ├── page.tsx                      # Корень: проверка сессии → /app или /auth
│   ├── layout.tsx
│   ├── auth/
│   │   └── page.tsx                  # Регистрация / вход / восстановление seed
│   ├── app/
│   │   └── page.tsx                  # Основной экран (монолит ~1500+ строк)
│   └── components/
│       ├── MainApp.tsx
│       ├── PixelBlast.tsx
│       └── WelcomeScreen.tsx
│
├── components/
│   ├── auth/
│   │   └── country-selector.tsx
│   ├── echo/app/
│   │   ├── message-bubble.tsx
│   │   ├── media-picker.tsx
│   │   ├── link-preview.tsx
│   │   └── settings-modal.tsx
│   └── ui/                           # shadcn/ui примитивы
│
├── hooks/
│   ├── use-mobile.ts
│   ├── use-toast.ts
│   ├── use-translation.ts
│   └── echo/
│       ├── use-echo-app.ts
│       ├── use-e2ee.ts
│       └── use-notifications.ts
│
├── lib/
│   ├── supabase.ts
│   ├── firebase.ts                   # Артефакт предыдущего стека (не используется)
│   └── utils.ts
│
├── public/
│   └── logo-full.svg
│
├── scripts/
│   └── fix-symlinks.sh
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/
│   └── gen/schemas/
│
├── package.json
├── Cargo.toml
├── tsconfig.json
└── ...
```

## Ключевые файлы и их роль

### app/page.tsx

Входная точка. Проверяет сессию Supabase и редиректит:
- есть сессия → `/app`
- нет сессии → `/auth`

### app/auth/page.tsx

Полноценный экран авторизации:
- sign up / sign in
- выбор страны (code phone)
- генерация/подтверждение BIP39 seed phrase
- загрузка/создание E2EE ключей в Supabase (`profiles.public_key`)
- регистрация устройства (`devices`), quarantine-проверка

### app/app/page.tsx

Основной экран мессенджера, монолит. Содержит:
- состояние чатов, выбранный чат, сообщения, ввод
- табы: `chats`, `feed`, `community`
- отправку/редактирование/удаление сообщений
- шифрование/дешифрование через `useE2EE`
- поиск пользователей (`profiles.username`, `profiles.display_name`)
- ожидание сообщений через Supabase Realtime + polling fallback
- offline pending-очередь
- интеграцию `SettingsModal`, `MediaPicker`

### Компоненты

- **components/echo/app/settings-modal.tsx** — модалка настроек + мини-профиль пользователя
- **components/echo/app/message-bubble.tsx** — пузырь сообщения (reply, edit, reactions, spoiler, markdown-like)
- **components/echo/app/media-picker.tsx** — выбор медиа/стикеров/gif
- **components/echo/app/link-preview.tsx** — превью внешних ссылок (YouTube + Microlink)

### Хуки

- **hooks/echo/use-echo-app.ts** — бизнес-логика мессенджера
- **hooks/echo/use-e2ee.ts** — E2EE ключи и шифрование
- **hooks/echo/use-notifications.ts** — уведомления
- **hooks/use-translation.ts** — словарь переводов

## Архитектура и ограничения

- Основная логика мессенджера сконцентрирована в `app/app/page.tsx` (~1500+ строк).
- Отдельных страниц `ChatView`, `ChatList`, `UserProfile`, `ProfilePage` **нет**.
- Профиль живёт внутри `settings-modal.tsx` + фрагментами в `app/app/page.tsx`.
- В коде используются таблицы Supabase: `profiles`, `messages`, `devices`.

## Запуск

### Предварительные требования

- Node.js >= 18, pnpm
- Supabase проект
- Rust + Tauri CLI (для десктопной сборки)

### Команды

```bash
pnpm install
pnpm dev
pnpm tauri dev
pnpm build
pnpm tauri build
pnpm lint
```

### Переменные окружения

В корне проекта:
- `.env.local` / `.env.production`

Нужны переменные Supabase:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
