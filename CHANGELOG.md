# Changelog

## [Unreleased]

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
