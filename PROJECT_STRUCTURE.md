# Структура проекта Echo Tauri

> Дата создания: 07.04.2026

---

## Общая схема
```
echo-tauri/
├── Frontend: Next.js 16 + React 19 + TypeScript + Tailwind/shadcn
├── Backend:  Tauri v2 + Rust
└── Сборка:   Tauri APK + Next.js out/
```

---

## Корень проекта

```
echo-tauri/
├── package.json              # Node.js зависимости и скрипты
├── pnpm-lock.yaml            # Замки зависимостей
├── pnpm-workspace.yaml       # Рабочее пространство pnpm
├── tsconfig.json             # TS конфиг
├── next.config.ts            # Next.js конфиг
├── next.config.js            # Next.js конфиг (legacy/fallback)
├── eslint.config.mjs         # Линтинг
├── postcss.config.mjs        # PostCSS/Tailwind
├── .env.local                # Локальные переменные окружения
├── .env.production           # Продовые переменные
├── .gitignore
├── README.md
├── LICENSE
│
├── Cargo.lock                # Rust замки зависимостей
├── Echo-debug-signed.apk     # Собранный debug APK
├── Echo-debug-signed.apk.idsig
│
├── app/                      # СТАРЫЙ Next.js pages router (deprecated)
│   ├── page.tsx
│   ├── layout.tsx
│   ├── globals.css
│   ├── favicon.ico
│   ├── auth/page.tsx
│   └── components/
│       ├── PixelBlast.tsx
│       └── WelcomeScreen.tsx
│
├── out/                      # СТАРЫЙ билд Next.js
│
├── src/                      # НОВЫЙ исходный код фронтенда + общий Rust main
│   ├── main.rs               # Rust entry point
│   └── lib/
│       └── firebase.ts       # Инициализация Firebase клиента
│
├── components/               # Компоненты фронтенда
│   ├── ui/                   # Базовые UI примитивы (shadcn/ui)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── toast.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── sheet.tsx
│   │   ├── tabs.tsx
│   │   ├── table.tsx
│   │   ├── badge.tsx
│   │   ├── separator.tsx
│   │   ├── scroll-area.tsx
│   │   ├── skeleton.tsx
│   │   ├── tooltip.tsx
│   │   ├── checkbox.tsx
│   │   ├── radio-group.tsx
│   │   ├── slider.tsx
│   │   ├── progress.tsx
│   │   ├── label.tsx
│   │   ├── avatar.tsx
│   │   ├── switch.tsx
│   │   ├── textarea.tsx
│   │   ├── popover.tsx
│   │   ├── hover-card.tsx
│   │   ├── context-menu.tsx
│   │   ├── menubar.tsx
│   │   ├── navigation-menu.tsx
│   │   ├── accordion.tsx
│   │   ├── collapsible.tsx
│   │   ├── aspect-ratio.tsx
│   │   ├── pagination.tsx
│   │   ├── kbd.tsx
│   │   ├── item.tsx
│   │   ├── input-group.tsx
│   │   ├── input-otp.tsx
│   │   ├── sonner.tsx
│   │   ├── spinner.tsx
│   │   ├── toaster.tsx
│   │   ├── use-mobile.tsx
│   │   └── use-toast.ts
│   └── ...
│
├── lib/                      # Вспомогательные модули фронтенда
│   ├── firebase.ts           # Firebase helpers
│   ├── supabase.ts           # Supabase helpers
│   ├── db.ts                 # Работа с БД
│   ├── auth-hydrator.ts      # Гидрирование сессии/токенов
│   └── utils.ts              # Утилиты clsx/tailwind-merge
│
├── hooks/                    # Кастомные React-хуки
│   ├── echo/
│   │   ├── types.ts
│   │   ├── use-chat-list.ts
│   │   ├── use-connection.ts
│   │   ├── use-e2ee.ts       # End-to-end encryption логика
│   │   ├── use-echo-app.ts
│   │   ├── use-fcm.ts        # Push-уведомления
│   │   ├── use-messages.ts
│   │   ├── use-network-queue.ts
│   │   ├── use-notification-settings.ts
│   │   ├── use-notifications.ts
│   │   ├── use-profiles.ts
│   │   └── use-realtime.ts
│   ├── use-mobile.ts
│   ├── use-toast.ts
│   └── use-translation.ts
│
├── public/                   # Статика (изображения, иконки)
│
├── .next/                    # Next.js dev кеш
├── node_modules/
├── target/                   # Rust бинарники верхнего уровня
│
├── src-tauri/                # Tauri приложение
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── tauri.conf.json       # Конфиг Tauri
│   ├── build.rs              # Сборочный скрипт
│   ├── .gitignore
│   │
│   ├── src/                  # Rust код бэкенда
│   │   ├── main.rs           # Entry point
│   │   ├── lib.rs            # Публичный API модуля
│   │   ├── vault.rs          # Хранилище ключей/секретов
│   │   ├── crypto.rs         # БИП-39, X25519, AES-GCM, Ed25519, SHA2
│   │   ├── storage.rs        # Работа с файлами/БД
│   │   ├── notification.rs   # Логика уведомлений
│   │   └── ...
│   │
│   ├── capabilities/
│   │   └── default.json      # Tauri ACL permissions
│   │
│   ├── gen/
│   │   ├── schemas/          # Схемы Tauri ACL
│   │   └── android/          # Сгенерированный Android Gradle проект
│   │
│   └── icons/                # Иконки приложения
│       ├── icon.png
│       ├── icon.ico
│       ├── icon.icns
│       ├── 32x32.png
│       ├── 128x128.png
│       └── ...
│
└── components/               # Общие компоненты (не из ui/)
```

---

## Основные слои проекта

### 1. Frontend

Модуль **Frontend** отвечает за интерфейс пользователя и бизнес-логику мессенджера, работающую поверх Tauri как сопутствующего окружения.

Расположение: `app/`, `src/`, `components/`, `hooks/`, `lib/`

#### Технологии
- **Next.js 16** — фреймворк приложения.
- **React 19** — UI библиотека.
- **TypeScript 5** — языковой стандарт.
- **Tailwind CSS 4** — утилитарные стили.
- **shadcn/ui** — набор UI компонентов на базе Radix UI.
- **Firebase** — аутентификация и, возможно, аналитика.
- **Supabase** — альтернативный backend для данных/реалтайма.
- **@tauri-apps/api** — мост между JS/TS и Rust.
- **three / @react-three/fiber / postprocessing** — визуальные эффекты.

#### Задачи
- Экраны аутентификации и onboarding (`app/auth`).
- Интерфейс чата и списка диалогов (`hooks/echo/`).
- End-to-end шифрование на стороне фронта (`use-e2ee.ts`).
- Push-уведомления (`use-fcm.ts`, `use-notifications.ts`).
- Реалтаймовое обновление статусов и сообщений (`use-realtime.ts`).
- Работа с профилями (`use-profiles.ts`).
- Очередь сообщений при потере сети (`use-network-queue.ts`).

### 2. Rust Backend

Модуль **Rust Backend** занимается безопасной криптографией, локальным хранением и интеграцией с системными возможностями ОС.

Расположение: `src-tauri/src/`

#### Основные модули
- `main.rs` — точка входа, инициализация плагинов и логгера.
- `lib.rs` — публичные команды и маршрутизация.
- `vault.rs` — защищённое хранилище ключей/секретов.
- `crypto.rs` — криптографические примитивы:
  - BIP-39 seed phrase
  - X25519 key exchange
  - AES-GCM
  - Ed25519 signing
  - SHA-2 hashing
- `storage.rs` — работа с локальными файлами и SQLite (`rusqlite`).
- `notification.rs` — логика показа уведомлений через `tauri-plugin-notification`.

#### Зависимости
- `tauri 2` + плагины: `log`, `notification`, `shell`.
- `reqwest` — HTTP-запросы.
- `tokio` — асинхронный рантайм.
- `chrono` — работа с датой/временем.
- `rusqlite` — локальная реляционная БД.
- Криптографические библиотеки:
  - `bip`
  - `x25519-dalek`
  - `aes-gcm`
  - `ed25519-dalek`
  - `sha2`
  - `rand`

### 3. Конфигурация

#### Файлы фронтенда
- `package.json` — версии и скрипты:
  - `pnpm dev` — запуск Next.js.
  - `pnpm build` — сборка приложения.
- `tsconfig.json` — настройки TypeScript.
- `next.config.ts` — настройки Next, включая обработку статики.
- `eslint.config.mjs` — линтинг и форматирование.
- `postcss.config.mjs` — конфигурация PostCSS для Tailwind.
- `.env.local`, `.env.production` — секреты и параметры окружения.

#### Файлы бэкенда
- `src-tauri/Cargo.toml` — зависимости, мета-информация и версия Rust.
- `src-tauri/tauri.conf.json` — идентификаторы приложения, иконки, окна, плагины.
- `src-tauri/capabilities/default.json` — ACL права (доступ к файлам, уведомлениям, сети и т.д.).
- `src-tauri/build.rs` — сборочный скрипт для генерирования ресурсов перед сборкой.

---

## Особенности / замечания

- В проекте есть **старый** код в папке `app/` и `out/` — это страницы на базе старого `pages router`.
- Основная разработка ведётся поверх **Tauri**, предполагается разделение на доменные папки в будущем.
- Используются одновременно **Firebase** и **Supabase** — стоит уточнить, какой сервис используется для чего на данном этапе.
- Для криптографии используется вспомогательный `tweetnacl` на фронте.
- Поддержка мобильных платформ есть: Tauri генерирует Android проект в `src-tauri/gen/android/` и есть сверстанный debug APK.
