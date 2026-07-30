# Changelog

## [Unreleased]

### Added
- Public profile page `/p?u=[username]`: sticky header with full Echo logo and a "Скачать" button, avatar, display name, bio and channel subscribers count.
- Primary action button on profile page: "Написать сообщение" (user) / "Перейти в канал" (channel) — checks Supabase session and opens the chat, or redirects to `/auth?returnTo=/p?u=[username]`.
- Secondary button "Открыть в браузере" on profile page — opens the public web profile at `https://echo-mes.vercel.app/@username`.

### Changed
- `app/p/`: converted dynamic route `[username]` to a static route with a `u` query parameter, because `output: 'export'` (static export for Tauri) does not support runtime dynamic segments.
- `app/p/page.tsx`: new server entry that renders the client component.
- `app/p/PublicProfilePage.tsx`: client component now reads `useSearchParams().get('u')` (wrapped in `<Suspense>` as required by Next 16); rebuilt profile card with sticky header, primary action and browser fallback.
- Deep-link handlers in `app/page.tsx` and `app/app/page.tsx`: all `/p/[username]` navigations replaced with `/p?u=[username]` (including `returnTo`).

### Fixed
- `GET /p/[username]` returned HTTP 500 ("missing exported function generateStaticParams()" / "dynamicParams: true cannot be used with output: export"). Resolved by moving to a static route + query param.
- Cold start deep-link bug where links were ignored for already authenticated users.
- Added missing deep-link scheme registration for Android in `tauri.conf.json`.
- Missing `?chat=username` parameter handling in the main app (now automatically opens the requested chat).
- UX: User is now redirected directly to the chat after authentication if coming from a profile link.
- Removed unused `Share2`/`Copy` icon imports and the "Скопировать ссылку" button from the profile page.

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
