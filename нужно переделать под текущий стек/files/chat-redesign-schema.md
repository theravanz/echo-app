# Supabase-поля для нового дизайна чата

## `chats` — новые колонки
```sql
alter table chats add column if not exists wallpaper_preset text default 'doodle'
  check (wallpaper_preset in ('solid', 'doodle', 'photo'));
alter table chats add column if not exists wallpaper_photo_url text;
```

## `messages` — новые колонки
```sql
alter table messages add column if not exists delivery_path text default 'direct'
  check (delivery_path in ('direct', 'mesh', 'relay'));
alter table messages add column if not exists status text default 'sent'
  check (status in ('sent', 'delivered', 'read'));
alter table messages add column if not exists media_duration numeric; -- seconds, voice/video_note
```
`type` уже должен поддерживать `'image' | 'voice' | 'video_note'` в дополнение к существующим `'text' | 'sticker' | 'gif'`.

## Storage
```sql
insert into storage.buckets (id, name, public) values ('chat-wallpapers', 'chat-wallpapers', true) on conflict do nothing;
```
(`voices` / `video-notes` бакеты можно переиспользовать под `tracks`-подобную схему, если ещё не заведены отдельно.)

## Файлы
- `chat-wallpaper.tsx` — сам фон (пресеты solid/doodle/photo + акцентное пятно + зерно)
- `color.ts` (в `lib/`) — общая функция извлечения доминантного цвета, теперь используется и профилем (обложка трека), и чатом (аватар собеседника)
- `use-contact-accent.ts` (в `hooks/echo/`) — хук, кэширует цвет по URL аватара, чтобы не пересчитывать при каждом рендере
- `message-bubble.tsx` — замена старого компонента: добавлены время + статус прочтения, mesh/relay-бейдж, типы voice/video_note/image, вызывает `onContextMenu` вместо старого hover-тулбара
- `message-context-menu.tsx` — рендерится один раз в контейнере сообщений (не на каждый баббл), позиционируется по `DOMRect` от бабла
- `chat-background-picker.tsx` — шторка выбора фона конкретного чата

## Интеграция (коротко)
В контейнере сообщений (там, где сейчас `{messages.map(...)}`):
1. Оберни контейнер в `position: relative`.
2. Добавь `<ChatWallpaper preset={...} accentColor={accent} photoUrl={...} />` первым потомком.
3. Заведи `const accent = useContactAccentColor(selectedChat.avatar_url, selectedChat.avatar_color)`.
4. Заведи `const [ctxTarget, setCtxTarget] = useState<ContextMenuTarget | null>(null)` и `containerRef` на сам контейнер сообщений.
5. У каждого `<MessageBubble>` передавай `onContextMenu={(e, msg, isMine, rect) => setCtxTarget({ message: msg, isMine, anchorRect: rect })}`.
6. После списка сообщений отрендери `<MessageContextMenu target={ctxTarget} containerRect={containerRef.current?.getBoundingClientRect() ?? null} onClose={() => setCtxTarget(null)} onReply={...} onCopy={...} onPin={...} onDelete={...} onReact={...} />`.

`onCopy` — просто `navigator.clipboard.writeText(msg.content)`, `onDelete` — `supabase.from('messages').delete().eq('id', msg.id)`, `onPin`/`onReact` — под твою существующую логику пинов/реакций, если она уже есть, или новые таблицы `pinned_messages` / `message_reactions` по аналогии с остальными.
