# OTA-обновления фронтенда (Tauri v2 + Next.js static export)

Схема:

```
Next.js build (out/)
  → tar.gz
  → minisign signature
  → Supabase Storage (public bucket)
      ├── manifest.json        ← манифест (cache-control: max-age=0)
      └── bundles/*.tar.gz     ← immutable архив (cache-control: 1 год)

Tauri app (Rust: tauri-plugin-hotswap)
  → GET manifest.json?t=<now>   ← обход CDN-кэша
  → проверка sequence / min_binary_version
  → download + minisign verify + extract
  → баннер «Перезапустить» → activateUpdate() → reload WebView
```

Плагин **не пересобирает нативный бинарник**: он подменяет Tauri asset provider
на распакованный бандл. Если бандл сломан, следующий запуск откатывается на
предыдущую/встроенную версию (heartbeat `notifyReady()`).

---

## 1. Переменные окружения

Добавь в `.env.local` (файл в `.gitignore`, **не коммить**):

```dotenv
# Уже есть в проекте:
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Публичный бакет OTA. Должен совпадать с endpoint в tauri.conf.json.
SUPABASE_BUCKET_NAME=echo-ota
NEXT_PUBLIC_OTA_BUCKET=echo-ota

# Только для publish-скрипта. НИКОГДА не добавляй в NEXT_PUBLIC_*:
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Подпись (см. раздел 2). Можно не задавать, если ключ лежит по умолчанию:
# OTA_SIGNING_KEY_PATH=~/.tauri/echo-ota.key
# OTA_SIGNING_KEY_PASSWORD=

# Необязательно: ссылка на установщик для старых нативных версий
# NEXT_PUBLIC_OTA_NATIVE_DOWNLOAD_URL=https://echo.example/download
```

`SUPABASE_URL` в скрипте берётся из `SUPABASE_URL` или
`NEXT_PUBLIC_SUPABASE_URL`. `SUPABASE_SERVICE_ROLE_KEY` нужен только на
машине/CI, которая публикует бандл. В клиент он не попадает.

Клиентский URL манифеста собирается как:

```
${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${NEXT_PUBLIC_OTA_BUCKET}/manifest.json
```

Его можно переопределить целиком через `NEXT_PUBLIC_OTA_MANIFEST_URL`.

---

## 2. Ключи подписи

Плагин проверяет **minisign**-подпись каждого архива. Публичный ключ зашит в
бинарник (`src-tauri/tauri.conf.json → plugins.hotswap.pubkey`), приватный
ключ хранится только у тебя/в CI.

Генерация (один раз):

```bash
pnpm tauri signer generate -w ~/.tauri/echo-ota.key
# спросит пароль; можно оставить пустым для локальной разработки
```

Получишь:

- `~/.tauri/echo-ota.key` — приватный ключ (никогда не коммить);
- `~/.tauri/echo-ota.key.pub` — публичный ключ.

Tauri кладёт в `.pub` base64 от всего minisign-файла. Плагину нужна строка
`RW...`:

```bash
base64 -d ~/.tauri/echo-ota.key.pub
# untrusted comment: minisign public key: ...
# RWQ...   ← вот эту строку в plugins.hotswap.pubkey
```

Скрипт `deploy:ota` сам сверяет `.pub` с `tauri.conf.json` и падает при
несовпадении — это защита от публикации бандла «чужим» ключом.

> Если ключ потерян/скомпрометирован: сгенерируй новый, обнови
> `plugins.hotswap.pubkey`, пересобери и переустанови нативное приложение.
> Старые клиенты с прежним pubkey новые бандлы принимать не будут.

---

## 3. Первая публикация

```bash
# 1. Убедись, что бакет существует и публичный (скрипт создаст при первом
#    запуске, если есть service_role key):
#    Supabase Dashboard → Storage → New bucket → Public

# 2. Собери, подпиши и загрузи:
pnpm deploy:ota

# Полезные варианты:
pnpm deploy:ota -- --skip-build          # out/ уже собран
pnpm deploy:ota -- --dry-run             # собрать+подписать, не загружать
pnpm deploy:ota -- --notes="Фикс тёмной темы" --mandatory
pnpm deploy:ota -- --sequence=42 --version=0.2.7-ota.42
pnpm deploy:ota -- --min-native=0.4.0
```

Что произойдёт:

1. `pnpm build` → `out/` (Next.js static export).
2. `out/` упаковывается в `.ota-build/echo-web-<version>-seq<N>.tar.gz`
   (`index.html` в корне архива).
3. Архив подписывается `tauri signer sign`.
4. Генерируется `manifest.json`:
   ```json
   {
     "version": "0.2.7-ota.1",
     "sequence": 1,
     "min_binary_version": "0.3.0",
     "url": "https://.../bundles/echo-web-0.2.7-ota.1-seq1.tar.gz",
     "signature": "...",
     "notes": "...",
     "pub_date": "...",
     "mandatory": false,
     "bundle_size": 1132867,
     "sha256": "..."
   }
   ```
5. Архив → `bundles/...`, манифест → `manifest.json` и
   `manifests/seq-N.json`.
6. Только после успешной загрузки обновляется `ota-version.json`
   (sequence увеличивается на 1).

`sequence` — единственное поле, по которому плагин сравнивает версии.
Он должен строго возрастать. Не откатывай его назад.

> В ТЗ поле называлось `min_native_version`; в контракте
> `tauri-plugin-hotswap` оно называется `min_binary_version`. Клиент понимает
> оба, но генерируем мы `min_binary_version`.

---

## 4. Как это работает в приложении

- `src-tauri/src/hotswap.rs` — инициализация плагина + resolver, который
  добавляет `?t=<unix_ms>` к `manifest.json` (Supabase CDN не отдаёт старый
  манифест).
- `src-tauri/capabilities/default.json` — `hotswap:default`.
- `src-tauri/tauri.conf.json`:
  - `plugins.hotswap.endpoint` — публичный URL `manifest.json`;
  - `plugins.hotswap.pubkey` — строка `RW...`;
  - CSP `connect-src` разрешает `https://*.supabase.co`.
- `components/echo/app/update-manager.tsx` (монтируется в `app/layout.tsx`):
  - при старте вызывает `notifyReady()` (heartbeat/rollback);
  - раз в 6 часов и при возврате в приложение проверяет манифест;
  - если `getVersion() < min_binary_version` — OTA не ставит, показывает
    уведомление «обновите приложение»;
  - иначе `downloadUpdate()` в фоне (тихо), затем баннер
    «Доступно обновление интерфейса — Перезапустить»;
  - по клику `activateUpdate()` + `window.location.reload()`.
- `lib/ota.ts` — типы, URL, semver-сравнение, fetch с cache-buster.

В `next dev` OTA выключен (`OTA_ENABLED`), чтобы не подменять dev-ассеты.
Включить принудительно: `NEXT_PUBLIC_OTA_DEV=true`.

---

## 5. Проверка после публикации

```bash
# Манифест должен отдаваться с max-age=0
curl -sI "https://<project>.supabase.co/storage/v1/object/public/echo-ota/manifest.json"

# Архив доступен и это gzip
curl -sI "https://<project>.supabase.co/storage/v1/object/public/echo-ota/bundles/<file>.tar.gz"
```

На устройстве:

1. Запусти приложение (старую нативную сборку).
2. Через ~5 секунд должен скачаться бандл; в логах:
   `[hotswap] Checking OTA manifest: ...`, `[OTA] bundle ... downloaded`.
3. Появится баннер. Нажми «Перезапустить» — WebView перезагрузится на новой
   версии без перезапуска процесса.
4. При следующем запуске `notifyReady()` подтвердит версию. Если приложение
   упадёт до подтверждения — откат (grace period: 2 запуска).

---

## 6. Частые проблемы

| Симптом | Причина / решение |
|---|---|
| `HTTP 404` при проверке | Бакет/путь не совпадает с `plugins.hotswap.endpoint`; манифест ещё не опубликован. |
| `signature verification failed` | Публичный ключ в `tauri.conf.json` не соответствует приватному ключу, которым подписан архив. Скрипт проверяет это заранее. |
| Обновление не приходит после публикации | CDN закэшировал `manifest.json`. Проверь `Cache-Control: max-age=0`; клиент дополнительно шлёт `?t=`. |
| `CORS` в консоли WebView | Бакет должен быть **public**; Supabase Storage отдаёт `Access-Control-Allow-Origin` для публичных объектов. |
| После `pnpm install` dev-сервер сыпет stale-chunk ошибками | Перезапусти `pnpm dev` / `pnpm tauri dev` (Next.js Turbopack кэш). |
| `sequence` не растёт | `ota-version.json` обновляется только после успешной загрузки. Проверь, что скрипт дошёл до конца. |
| Старая нативная версия не получает OTA | Это ожидаемо: `min_binary_version` выше. Покажи пользователю ссылку на установщик. |

---

## 7. Политика магазинов

OTA, который меняет только HTML/CSS/JS внутри WebView, обычно разрешён, но
правила Apple/Google меняются. Перед публикацией в App Store / Google Play
сверься с актуальными guidelines (Apple 3.3.2, Google Play Device and Network
Abuse).
