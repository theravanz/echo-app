# Changelog

## [Unreleased]

### Исправлено

- **Группы: чужие сообщения больше не теряются** (`use-messages.ts`, `use-realtime.ts`, `use-e2ee.ts`):
  - `fetchMessages` выбирал только DM-пары (`sender/receiver = me ↔ chat`), из-за чего сообщения других участников группы вообще не попадали в историю — для групп теперь выборка `receiver_id = groupId` (все отправители);
  - расшифровка текста групп пробрасывает `chatId` в `decryptMessage` (4-й аргумент → `msg_key_0`), realtime INSERT/UPDATE распознаёт групповые `receiver_id` и тоже шлёт groupId; собственные эхи из polling дедуплицируются по `seenIds`;
  - «Очистить чат» в группе удаляет только свои сообщения (RLS и так не пускает чужие).
- **Группы: ник и аватар отправителя** (`use-group-senders.ts`, `message-bubble.tsx`, `chat-area.tsx`):
  - новый хук `useGroupSenders` батчем грузит `profiles` по DISTINCT `sender_id` (с кэшем на открытый чат);
  - чужие пузыри — слева с цветным ником и зашифрованным аватаром (`SecureAvatar`), свои — справа без авы; цвет ника — детерминированный `groupSenderColor(id)` из палитры.
- **Группы: шифрование файлов и голосовых** (`lib/group-media.ts`, `lib/group-upload.ts`, `lib/files.ts`, `lib/voice.ts`, `chat-area.tsx`, `message-bubble.tsx`, `audio-file-bubble.tsx`):
  - DM-медиа шифровались NaCl box под публичный ключ одного получателя — в группе это нерабочая схема; введён формат `v=3/enc='group'` (AES-GCM 256 через `msg_key_0`, Web Crypto, iv 12B);
  - `encryptAndUploadGroupFile` / `encryptAndUploadGroupVoice` — тот же `FileUploadHandle`-контракт, бакеты те же (files/voice); путь приведён к RLS-контракту бакета: первый сегмент = `auth.uid()` отправителя, дальше подпапка группы — `"<sender_uuid>/g_<group_uuid>/f_<ts>.enc"` (files) и `"<sender_uuid>/g_<group_uuid>/v_<ts>.enc"` (voice). Прежний `"<groupId>/group-<ts>.enc"` отбивался Storage'ом с HTTP 400 (первый сегмент пути ≠ владелец);
  - скачивание/открытие/плееры принимают `groupKeyB64` и раньше DH-ветки расшифровывают v=3.
- **Группы: аватар группы не отображался** (`lib/groups.ts`, `hooks/echo/use-chat-list.ts`):
  - аватар грузился в бакет `avatars` по пути `"groups/<groupId>/avatar-<ts>.enc"` — первый сегмент не равен `auth.uid()` создателя, поэтому Storage отклонял загрузку (RLS: владение = первый сегмент пути). Теперь путь `"<creator_uuid>/g_<group_uuid>/avatar-<ts>.enc"`;
  - в зашифрованные метаданные группы добавлено поле `avatar_nonce`: `SecureAvatar`/`SecureImage` расшифровывают конверт AES-GCM только с nonce, без него аватар не показывался даже при успешной загрузке.
- **QR-вход: `refresh_token_already_used` на втором устройстве** (`supabase/functions/qr-issue-session/index.ts`, `components/echo/app/qr-login-scanner.tsx`, `app/auth/page.tsx`, `app/auth/qr/page.tsx`, `lib/db.ts`):
  - причина — телефон и ПК делили ОДНУ пару `access/refresh`: сканер клал текущие токены мобилки в E2EE-конверт, десктоп делал `setSession()` на них же; при `enable_refresh_token_rotation=true` кто первый обновился — тот и забирал цепочку, второй получал `400 Already Used` и вылетал;
  - теперь QR выпускает ПК НЕЗАВИСИМУЮ сессию: сканер зовёт `qr-issue-session`, кладёт в конверт одноразовый `token_hash`, десктоп гасит его через `verifyOtp({ token_hash, type: 'email' })` и получает свою пару токенов; общий refresh больше не шарится;
  - `qr-issue-session` чинит phone-аккаунты без email: проставляет детерминированный shadow-email `u_<hexid>@echo-qr.local` (идемпотентно, `updateUserById`, письма никуда не шлются) и выпускает тикет уже на него;
  - второй путь (`login_challenges`) — тоже тикет вместо полного `session` (заодно не храним refresh-токен в таблице, читаемой по токену);
  - watchdog (`lib/db.ts`) при `Already Used` / невалидном refresh больше НЕ делает локальный `signOut` (раньше выкидывал в `/auth` посреди работы) — только warn, ждём следующий цикл;
  - обратно совместимо: старый конверт `{ access_token, refresh_token }` (мобилка на старой сборке) десктоп по-прежнему принимает через `setSession`.
  - ⚠️ после деплоя функции уже пострадавшие пары (расшаренный токен) надо перелогинить по QR один раз — дальше сессии независимые.

### Добавлено

- **Каркас профиля группы + роли** (`group-profile-panel.tsx`, `use-group-members.ts`, `types.ts`, миграция `0012_group_roles.sql`):
  - `group_members.role` (`owner|admin|member`, создатели → owner, админов может быть много); чтение состава/ролей уже работает по RLS 0011;
  - `GroupProfilePanel` открывается по клику на группу (шапка/аватар/описание/счётчик + участники, сгруппированные по ролям с бейджами) — НАСТРОЙКИ группы, назначение админов и выход оставлены заглушками с TODO-маркерами (твоя часть: RPC-контракты `group_set_admin` / `group_remove_member` / `group_leave` зафиксированы в шапке миграции 0012);
  - `Chat.my_role`, `useGroupMembers` (`members/myRole/isOwner/isAdmin` + заготовки-обёртки мутаций) готовы к подключению.

### Изменено

- **Группы: клик по отправителю открывает его профиль** (`message-bubble.tsx`, `chat-area.tsx`, `use-profile-details.ts`):
  - аватар и ник отправителя в групповом чате стали кликабельными → справа открывается панель профиля ЭТОГО участника (`ProfileViewPanel`), а не профиль группы;
  - панель профиля группы осталась доступна отдельно (клик по шапке группы);
  - мобильный баг: при открытии профиля участника сначала показывался профиль группы, а потом уже участник — теперь панель выбирается по факту запроса профиля, а во время загрузки данных показывается спиннер (иначе рендерилась ветка «профиль группы»);
  - `useProfileDetails` сбрасывает прежние данные при смене `userId`, чтобы не показывался профиль предыдущего человека.

## [0.3.2] - 2026-10-16 - 2026-10-18

### Добавлено

- **Симметричное E2EE-шифрование в группах (`use-e2ee.ts`)** — реализован алгоритм шифрования/расшифровки сообщений через Web Crypto API (AES-GCM 256-bit) с использованием группового ключа `msg_key_0`.
- **Zero-Knowledge группы (backend & RLS)** — деплой Edge Function `create-group` и миграции таблиц (`groups`, `group_members`, `group_key_mailbox`).
- **Боковая панель папок (`AppNavRail`)** — навигация по папкам вынесена в отдельный компонент (`components/echo/app/app-nav-rail.tsx`):
  - логотип обновлён до PNG-версии (`/logo.png`) с оптимизированным размером (`w-11 h-11`), повышенной яркостью (`brightness-125`) и эффектом свечения (`drop-shadow`);
  - увеличены интерактивные области и иконки папок до 52px;
  - в нижнюю часть панели добавлена кнопка настройки папок (`TbAdjustmentsHorizontal`);
  - добавлены всплывающие уведомления «скоро» для создания и настройки папок.
- **Log Out на мобиле** — выход теперь доступен и в мобильных настройках (раньше — только в десктопном сайдбаре).

### Изменено

- **Типизация и сборка чатов (`types.ts`, `use-chat-list.ts`)** — интерфейс `Chat` расширен полями `type: 'group' | 'direct'` и `msg_key_0`; функция `buildGroupChats` пробрасывает ключи и метаданные при гидратации состояния.
- **Сайдбар списка чатов (`ChatSidebar`)**:
  - основные вкладки приложения перенесены в нижний навигационный бар сайдбара;
  - карточки чатов, аватары (56px) и шрифты укрупнены для лучшей читаемости в стиле macOS Telegram;
  - удалены дублирующие элементы управления.
- **Модалка создания группы (`Group Create Modal`)** — доведены до ума, сглажены и полностью отполированы анимации открытия и закрытия окна.
- **Навигация в настройках**: кнопки «назад» во всех sub-view (Devices, Privacy, Language, Alerts, Interface, Security, Network/Storage) ведут в Identity; Esc закрывает sub-view → затем модалку; крестик закрытия в шапке сайдбара; лок скролла подложки.
- **Network/Storage** — честная заглушка «Coming soon» вместо пустого экрана; мёртвых кнопок нет — пункты без обработчиков (Network, Storage, Security-подпункты, Connect New Node, Export Identity, Execute Purge) отвечают тостом «скоро» (тостер уже смонтирован в `app/layout.tsx`).
- **Декомпозиция settings-modal** — монолит на 1378 строк разобран на `components/echo/app/settings/` (оркестратор, конфиг, примитивы, sidebar, views) и `hooks/echo/settings/` (`use-devices`, `use-device-geo`); старый путь импорта сохранён как re-export shim.

### Исправлено

- **Сбой отправки и ошибки RLS в группах (`messages` Table)**:
  - политики RLS (`Echo insert messages policy` & `Echo select messages policy`) обновлены с учетом участников из `group_members`;
  - снято жесткое ограничение внешнего ключа `messages_receiver_id_fkey` на таблицу `profiles` для поддержки полиморфного `receiver_id` (UUID профилей и групп).
- **Ошибка интерфейса групп (`chat-header.tsx`, `use-chat-list.ts`)** — убраны неопределенные поля `@undefined`, добавлен дефолтный текст «Группа создана» для пустой истории и динамический счетчик участников в шапке.
- **QR-вход Tauri Desktop → телефон** (`components/echo/app/qr-login-scanner.tsx`, `src-tauri/src/qr_auth.rs`):
  - сканер кладёт в зашифрованный конверт текущие токены мобилки (`access_token` + `refresh_token`) вместо magiclink `token_hash` из `qr-issue-session` — та выпускается через `generateLink({ email })`, а у phone-аккаунтов email нет вообще (422), да и десктопный `setSession()` такой конверт принять не мог;
  - `qr_send_e2ee_key` принимает `supabase_url`/`supabase_anon_key` явными invoke-параметрами — Rust-рантайм Tauri не видит `NEXT_PUBLIC_*` env (они вшиты только в JS-бандл), старый захардкоженный fallback-ключ давал 401 на `POST /rest/v1/rpc/broadcast_message`.
- **Модалка настроек больше не «часть чата»** (`app/app/page.tsx`, `components/echo/app/settings/settings-modal.tsx`):
  - обёртка — обычный `div fixed inset-0 z-[200]` без `dragX`-трансформа (transform у предка ломал nested `position: fixed`, модалка схлопывалась в слой чата);
  - окно — сплошное `bg-background` без прозрачности/блюра/шума (было `bg-background/95` + `backdrop-blur` — чат просвечивал сквозь).
- **Сайдбар настроек скроллится** (`components/echo/app/settings/settings-sidebar.tsx`, `app/globals.css`):
  - у `aside` добавлены `overflow-y-auto` + `min-h-0` — пункты ниже сгиба больше не обрезаются; у сайдбара и контента теперь собственные скроллы;
  - новый класс `.settings-scroll` — тонкий видимый скроллбар (глобально в `app/app` скроллбары скрыты — было непонятно, что внизу есть ещё).
- **Контекстное меню больше не блюрит сообщение** (`message-context-menu.tsx`): оверлей `bg-black/60 backdrop-blur-md` поверх всего, включая выбранное сообщение (текст было не прочитать), заменён на прозрачный кликкетчер; приглушение фона остаётся через `isDimmed` соседних бабблов.
- **Шумные 401/404 в консоли и Supabase edge-логах** (`lib/db.ts`, `hooks/echo/use-connection.ts`, `app/app/page.tsx`):
  - connectivity-probe переведён с `GET /rest/v1/` на `GET /auth/v1/health` (200 без ключа; раньше — 401 на каждый опрос, в StrictMode дублями);
  - `noise.png` (404, файла нет в `public/`) заменён инлайн SVG-noise.

### Удалено

- **Устаревшая веб-архитектура** — полностью вырезаны старые папки проекта, предназначенные исключительно для веб-версии (времена до миграции на десктопный стек Tauri).
- **Шаблонный код** — зачищена случайно оставшаяся папка `src` с дефолтным `main.rs` («Hello World» на Rust), созданная при инициализации сторонних инструментов.
- **Файлы для IDE и AI агентов** - полностью очищены из общего github файлы разных IDE и skills для agents ai.

## [0.3.1] - 2026-10-03
### Message-кэш в SQLCipher — plaintext переписки больше не в localStorage

#### Изменено
- **Message-кэш переехал в Rust-слой (SQLCipher)** (`hooks/echo/use-messages.ts`):
  ключи `echo_msgs_cache_${userId}_${chatId}` теперь читаются/пишутся через
  `cacheGet`/`cacheSet` из `hooks/echo/chat-cache.ts` → `secure_store`
  зашифрованной БД (через `save/get_auth_progress`, fallback plugin-sql).
  Прежние прямые `localStorage.getItem/setItem` убраны. Чтение кэша
  асинхронное, до сетевого fetch — офлайн-рендер из кэша сохранён.
- **Кэш списка чатов** (`hooks/echo/use-chat-list.ts`) — там же, в
  `secure_store` (переведён ранее в этой итерации).
- **Прозрачная одноразовая миграция** (`hooks/echo/chat-cache.ts`):
  при первом `cacheGet` в Tauri, если в `secure_store` пусто, а в
  localStorage есть legacy-ключ — значение переносится в SQLCipher
  и из localStorage удаляется (plaintext-следы чистим). Если SQL
  недоступен — legacy-копия сохраняется, warn в консоли.
  При чтении из SQL устаревшая localStorage-копия ключа удаляется
  (`cleanupLegacyCopy`). Провал записи в SQL никогда не удаляет
  localStorage-оригинал.

#### Инвариант (новый)
- **Plaintext переписки в localStorage — запрещено.** Расшифрованные
  сообщения живут только в памяти + SQLCipher через `chat-cache.ts`.
  Все новые кэши с расшифрованным контентом — только там.

#### Известные ограничения
- **[KNOWN] plaintext-in-localstorage**: ключи `echo_drafts_${userId}`,
  `echo_accounts`, `echo_device_hwid` продолжают жить в localStorage —
  drafts содержат расшифрованный набранный текст. Не тронуты в этой
  итерации, выносятся в SQLCipher отдельным аудитом (drafts меняются
  на каждый keystroke → нужен debounce-план миграции).
- Миграция legacy message-кэша срабатывает per-chat при первом открытии
  чата, а не пачкой на старте — plaintext-ключ, который ни разу не
  открывали после обновления, останется в localStorage до открытия чата.

#### Фиксы зависания загрузки списка (эта же итерация)
- **Offline-init больше не ждёт `getSession()`** (`app/app/page.tsx`):
  supabase-js при отсутствии сети может виснуть в refresh-сессии
  (fetch без таймаута) → до чтения кэша дело не доходило. userId теперь
  достаётся синхронно из локального storage (`sb-<ref>-auth-token`,
  fallback `echo_accounts`) и сразу вызывается `fetchChats`.
- **IPC к Rust-слою ограничен таймаутом 1.5s** (`hooks/echo/chat-cache.ts`):
  `cacheGetBounded`/`cacheSetBounded` — если invoke завис/хранилище
  недоступно, отдаём null и продолжаем (онлайн-фетч загрузит с сервера).
  Кэш никогда не блокирует рендер.
- **Убран plugin-sql fallback** из `chat-cache.ts`: tauri-plugin-sql
  удалён из сборки (монополия rusqlite), fallback был мёртвым кодом.

#### Root cause: кэш и устройства мертвы на legacy-БД — баг версий миграций
- **Баг парсинга версии миграции** (`src-tauri/src/storage.rs`):
  `trim_matches('0')` срезал нули С ОБОИХ концов имени —
  `"001__initial_schema"` → `"1__initial_schema"` → `parse()` падал →
  `unwrap_or(0)` → V001 записывалась в `refinery_schema_history` как
  `version=0`, а V002+ при каждом старте «находились» применёнными
  (EXISTS(version=0) бил в запись V001) и **скипались навсегда**.
  На реальной БД (дамп через тест) подтверждено: HISTORY=[(0,V001)],
  secure_store/app_settings отсутствовали, devices без новых колонок —
  отсюда `no such table: secure_store` (кэш чатов/сообщений не работал),
  `devices has no column named device_type` и 401-каскад.
- **Фикс**: версия строго из числового префикса имени (`V001` → 1),
  плохое имя = ошибка, не молча 0.
- **`V003__repair_legacy_versioning.sql`**: удаляет испорченные записи
  (version=0), страховочно создаёт secure_store/app_settings и переносит
  данные из auth_progress.
- **Repair devices-колонок кодом** (SQLite не умеет условный ADD COLUMN):
  сверка PRAGMA table_info, недостающие колонки добавляются ALTER'ом.
  Верифицировано на реальной БД: HISTORY=[(1,V001),(2,V002),(3,V003)],
  secure_store/app_settings созданы, devices доколонован.
- **`cacheSet` теперь возвращает успех записи (boolean)**: раньше
  миграция удаляла legacy-копию из localStorage, даже если запись в
  SQL провалилась (ошибка глоталась) — данные терялись в обоих местах.
- CACHE_IO_TIMEOUT поднят до 3с (busy_timeout в Rust — 5с, 1.5с
  срезали легитимные операции под контеншном).

#### Cache-first старт: сначала БД, потом сеть
- `app/app/page.tsx` init перестроен по принципу «БД → сеть»:
  1. Юзер ставится из **локальной сессии** сразу (без ожидания сетевого
     `profiles`-запроса).
  2. `fetchChats` вызывается **до** всех сетевых старт-операций —
     список рендерится из SQLCipher-кэша, свежак подтягивается следом.
  3. Только потом сеть: профиль (уточняет `user_metadata`, обновляет
     юзера), регистрация устройства + geo-детект, quarantine-проверка.
- Раньше кэш списка читался ПОСЛЕ профиля/geo/регистрации устройства —
  список ждал сеть, хотя данные были локально.
- Убран дублирующий `fetchChats` в конце device-блока (уже вызван выше).
- Ошибка профиля больше не откатывает юзера: warn
  `[App] profile fetch failed, using local session` и работаем дальше
  на локальной сессии (важно для офлайна и медленной сети).

#### Офлайн-старт опирается на статус связи (без ожидания сети)
- `useChatList(user, connectionStatus)` / `useMessages(chats, connectionStatus)`:
  перед сетевым запросом проверяется `navigator.onLine` И статус из
  `useConnection`. Если статус `disconnected` — сеть **не трогаем вообще**:
  список/история рендерятся из SQLCipher-кэша мгновенно, вместо ожидания
  сетевых таймаутов (раньше именно их ждали десятки секунд, хотя сайдбар
  уже показывал Offline).
- **Жёсткий abort-таймаут сети** (8с) через `AbortSignal` на обоих запросах
  (`messages`, `profiles`) — защита от «статус connected, а сеть мертва»,
  больше никаких многоминутных зависаний.
- **Ресинк при возврате сети**: reconnect-коллбек `useConnection` теперь
  кроме досылки offline-очереди вызывает `fetchChats` — список
  синхронизируется с сервером, кэш на экране обновляется (unread counts,
  новые чаты) без ожидания пользователя.
- `page.tsx`: порядок хуков переставлен — `useNetworkQueue`/`useConnection`
  идут до `useChatList`, чтобы статус был доступен списку в первом рендере.
- Диагностика: `[CHAT-CACHE] offline (status), using cached chats —
  network skipped` / `... using cached messages — network skipped`.

#### Latenсу офлайн-старта: L1-память, single-flight, сериализация записей
- Причина медленного появления списка: IPC к Rust (в логе —
  `IPC custom protocol failed, Tauri will now use the postMessage
  interface`) + дублирующиеся вызовы (StrictMode даёт по 2 одинаковых
  invoke на ключ) + WAL (один писатель; параллельные записи ждали
  busy_timeout 5с). Итог: одно чтение кэша растягивалось на секунды.
- **`hooks/echo/chat-cache.ts`**: L1 in-memory Map (повторные чтения —
  0 IPC), single-flight (одинаковые параллельные чтения делят один
  invoke), `enqueueWrite` — записи строго по одной. Тайминги: warn
  `slow get/save_auth_progress <key>: Nms` при >300мс.
- **Записи кэша — fire-and-forget** в `use-chat-list`/`use-messages`:
  UI не ждёт Rust-слой, при таймауте bounded-обёртки запись всё равно
  доезжает (память обновляется по факту успеха).
- CACHE_IO_TIMEOUT поднят до 5с (равен busy_timeout в Rust).
- **CSP**: в `connect-src` добавлен `ipc://localhost` — чтобы вернуть
  быстрый custom-protocol IPC вместо postMessage-fallback.

#### Фикс слетающей авторизации в офлайне (эта же итерация)
- **`autoRefreshToken: false`** (`lib/db.ts`): gotrue при обрыве сети
  уходил в retry-цикл обновления токена (fetch без таймаута →
  AuthRetryableFetchError, в логе — `Failed to load resource: token,
  network connection was lost`), после исчерпания попыток **сам удалял
  сессию** → пользователь вылетал на /auth после airplane mode.
- **Ручной guarded refresh** вместо автомата: `ensureSessionFresh`
  (margin 120с) → перед refresh живой probe `/rest/v1/` с AbortController
  (5s); офлайн gotrue не вызывается вообще, сессия сохраняется.
  Watchdog: refresh на `online`-событии и раз в минуту (только online),
  плюс `ensureSupabaseSessionFresh()` в app-init.
- **`detectSessionInUrl: false`**: QR-логин идёт через `verifyOtp`
  (API), URL-токены не используются; флаг исключает и ложный парсинг
  deep-link `?chat=username` как auth-параметров.

#### Прочее
- Удалён мёртвый дублирующий хук `hooks/echo/use-echo-app.ts` (никем
  не импортировался, содержал собственную копию кэш-логики чатов).

### Shield Media: приватные bucket'ы — без 400 на старых фото и с видимым зашифрованным аватаром

#### Исправлено
- **Спам 400 на старых фото** (`cover-*.jpg`, `pub-*.jpg`): после того как
  `avatars`/`tracks`/`publications`/`stories` стали приватными (`0007`), часть
  компонентов всё ещё рендерила сохранённые в БД ПУБЛИЧНЫЕ URL напрямую в `<img>`
  → `GET /storage/v1/object/public/...` отдаёт 400. Сами объекты в бакете целы.
- **`SecureImage`** (`secure-image.tsx`) пересобрал приоритет источника:
  `расшифрованный blob (path+nonce)` → `signed-URL для legacy` → `внешний src`.
  Раньше был `src || secure`, из-за чего зашифрованный формат вообще не
  достигал применения, а legacy-ссылка 400-илась без фоллбэка.
- **`use-secure-media.ts`**: добавлены `publicUrlToStoragePath()`,
  `loadSignedStorageUrl()` и `useSignedStorageUrl()` — извлекают storage-путь из
  публичной ссылки (`/storage/v1/object/public/<bucket>/<path>`) и открывают
  объект короткоживущим signed-URL. Legacy-файлы не шифровались, поэтому
  расшифровка им не нужна. Внешние ссылки (giphy и т.п.) проходят как есть.
- **Свой профиль «не показывал» новое фото после сохранения**:
  `settings-modal.tsx` собирал `EditableProfile` из `user_metadata` и не
  прокидывал `avatar_storage_path`/`avatar_nonce`/`avatar_mime` (и
  `activity_cover_path`/`activity_cover_nonce`), а `ProfileViewer` показывала
  только `profile.avatar_url`. После загрузки нового аватара `avatar_url = null`
  → вместо картинки показывались инициалы (выглядело как «фото не отправилось»).
  Все аватары/обложки (`profile-edit-panel.tsx`, `profile-view-panel.tsx`,
  аватар в сайдбаре `app/app/page.tsx`, обложки в списке треков) переведены на
  `SecureAvatar`/`SecureImage`.
- **Реальная причина ошибки сохранения была не видна**: `handleSave` гасил её
  в общий тост «Не удалось сохранить профиль» — теперь показывает текст ошибки.

#### Исправлено (сборка)
- **`pnpm build` падал на type-check** (`hooks/echo/types.ts`): у `Message`
  отсутствовали поля `call_status` / `call_duration`, хотя они используются в
  `hooks/echo/use-messages.ts` (оптимистичный `reply_to`) и
  `components/echo/app/message-bubble.tsx`. Из-за этой ошибки Tauri-сборка не
  проходила вовсе → приложение продолжало запускаться со старым `out/`, что и
  давало ощущение «всё отвалилось». Типы дополнены, `tsc --noEmit` и
  `next build` проходят.

#### Добавлено
- **`ensureMediaKeyReady()`** (`lib/media.ts`): перед шифрованием медиа
  проверяет `media_key_status` и, если ключа нет, пытается выполнить
  device-bound `crypto_restore_key` для активной сессии. Медиа-ключ =
  `HKDF(E2EE seed, "echo/media")`, поэтому без загруженного сида шифровать
  нечем. Если ключ получить не удалось — бросается понятная ошибка
  («Медиа-ключ не загружен…»), а не общий toast.

## [0.3.0] - 2026-09-18
### Shield Media, голосовые, файлы и raw-bytes IPC — полный E2EE-контур медиа

#### Добавлено
- **Системное открытие файлов на мобильных** (`src-tauri/src/file_open.rs`):
  команды `open_file_system(path, mime)` и `open_file_ios(path)`.
  • **Android** — Kotlin-мост `MainActivity.echoOpenFileExternally(path, mime)`:
    `FileProvider.getUriForFile()` (content://, authority = `${packageName}.fileprovider`)
    + `Intent.createChooser(ACTION_VIEW)` с `FLAG_GRANT_READ_URI_PERMISSION` —
    юзер выбирает приложение, как в Telegram. Rust вызывает метод через JNI
    (`with_webview` → UI-поток) и маппит коды 0/1/2/3 на контракт ошибок
    (`file-not-found`, `no-app-for-mime`). mime пустой → `application/octet-stream`.
    Почему не чистый JNI из Rust: wry грузит классы кастомным app-classloader —
    резолюция androidx-методов (`FileProvider.getUriForFile`) из Rust ловит
    `NoSuchMethodError`. Kotlin видит androidx напрямую (рядом с FCM-мостом).
    ⚠ `-keep class com.theravanz.echo_tauri.MainActivity { *; }` в
    `proguard-rules.pro` ОБЯЗАТЕЛЕН: R8 в release (`isMinifyEnabled = true`)
    вырезает метод → `NoSuchMethodError` на UI-потоке → FATAL-краш.
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
- **Мобильная диагностика логов (Rust + JS в release)**:
  • `tauri-plugin-log` инициализируется на Android/iOS **всегда** (не только
    debug): Android → Stdout таргет уходит в `android_logger` → `adb logcat`,
    iOS → os_log → Console.app. Без этого release-сборка немая — JNI-сбои
    не видно. Capability `log:default` добавлена в `capabilities/default.json`.
  • `components/echo/app/log-bridge.tsx` (`<LogBridge />` в `app/layout.tsx`):
    форвардер `console.log/info/warn/error` → `plugin:log|log` — любой
    console-вывод фронтенда виден в системном логе мобильной сборки
    (`[webview:console.log]` в logcat). StrictMode-safe (рестор оригиналов).
- `app/layout.tsx`: смонтирован `<Toaster />` (sonner) — раньше его не было,
  все `toast()` молча терялись: ошибки открытия файлов не показывались на экране.
- `lib/files.ts`: пустой mime перед системным открытием →
  `application/octet-stream` (иначе Android Intent падает на null-mime).
- **Локальные шрифты**: `next/font/google` (Geist/GeistMono с fonts.gstatic.com)
  → пакет `geist` (`geist/font/sans`, `geist/font/mono`), те же CSS-переменные
  `--font-geist-sans/--font-geist-mono`. Сборка больше не падает и не требует
  сети: Turbopack падал на офлайн-скачивании woff2 (11 ошибок module-not-found).
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
- **Краш приложения при тапе на файл (Android release)**: R8/minify вырезал
  Kotlin-метод `echoOpenFileExternally` → `NoSuchMethodError` из JNI на
  UI-потоке → FATAL. Лечится keep-правилом в `proguard-rules.pro`
  (см. раздел «Добавлено»); JNI-диагностика дополняет ошибку текстом
  Java-исключения — важен порядок: `exception_occurred()` → `exception_clear()`
  → только потом `toString()` (с pending-exception JNI-вызовы тихо фейлятся
  и текст теряется).
- **Немые ошибки открытия файлов**: `<Toaster />` не был смонтирован —
  тосты «Не удалось открыть файл» не показывались; Rust-логи не писались
  в logcat в release-сборке (плагин логов инициализировался только в debug).
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
- JNI-вызовы Android: метод Kotlin-моста (`echoOpenFileExternally`) ищется по
  точному имени — proguard keep для `MainActivity` нельзя снимать; при
  чтении текста Java-исключения сначала `exception_clear()`, потом вызовы
  методов Throwable (иначе пусто).
- `ImageBubble` НЕ имеет onClick — тап по картинке системное открытие не
  вызывает (только `FileBubble`, кроме `audio/*` — там мини-плеер).
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
