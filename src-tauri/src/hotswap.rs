//! OTA-обновления фронтенда (Next.js static export) через `tauri-plugin-hotswap`.
//!
//! Плагин подменяет встроенный asset-provider Tauri на файловый кэш в
//! `{app_data}/hotswap`. Бандл скачивается в фоне, проверяется minisign-подписью
//! и активируется только по команде фронтенда (`activateUpdate()` + reload).
//!
//! Почему свой resolver, а не `StaticFileResolver` из плагина:
//! Supabase Storage — это CDN. Манифест `manifest.json` перезаписывается при
//! каждом релизе, поэтому его нельзя кэшировать. `StaticFileResolver` дергает
//! фиксированный URL без cache-buster'а. Здесь мы добавляем `?t=<unix_ms>` и
//! заголовки `Cache-Control: no-cache`, чтобы клиент всегда видел свежий
//! манифест сразу после публикации.
//!
//! Конфиг берётся из `plugins.hotswap` в `tauri.conf.json` (endpoint/pubkey).
//! Это позволяет менять URL бакета без пересборки кода, а публичный ключ
//! остаётся зашит в бинарник (как и требует модель безопасности плагина).

use std::future::Future;
use std::pin::Pin;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::Wry;
use tauri_plugin_hotswap::error::{Error, Result as HotswapResult};
use tauri_plugin_hotswap::{
    BinaryCachePolicyKind, CheckContext, ConfirmationPolicyKind, HotswapBuilder, HotswapManifest,
    HotswapPlugin, HotswapResolver, RollbackPolicyKind,
};

/// Дефолтный манифест. Переопределяется через `plugins.hotswap.endpoint`.
const DEFAULT_MANIFEST_URL: &str =
    "https://aoxzpqwiwuzypydexfrn.supabase.co/storage/v1/object/public/echo-ota/manifest.json";

/// Публичный minisign-ключ. Переопределяется через `plugins.hotswap.pubkey`.
/// Приватная часть НЕ хранится в репозитории (см. scripts/publish-ota.mjs).
const DEFAULT_PUBKEY: &str = "RWRyTnDAefjdjOqU+a60DcYHNTUy+HgsEfvvVNUICwVZYCFgKkgiMAHZ";

/// Resolver статического манифеста в Supabase Storage с обходом CDN-кэша.
struct SupabaseManifestResolver {
    url: String,
    client: reqwest::Client,
}

impl SupabaseManifestResolver {
    fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }
}

impl HotswapResolver for SupabaseManifestResolver {
    fn check(
        &self,
        ctx: &CheckContext,
    ) -> Pin<Box<dyn Future<Output = HotswapResult<Option<HotswapManifest>>> + Send>> {
        let base_url = self.url.clone();
        let client = self.client.clone();
        let current_sequence = ctx.current_sequence;
        let channel = ctx.channel.clone().unwrap_or_else(|| "production".to_string());

        Box::pin(async move {
            // Поддерживаем те же плейсхолдеры, что и HttpResolver плагина.
            let mut url = base_url
                .replace("{{current_sequence}}", &current_sequence.to_string())
                .replace("{{channel}}", &channel);

            // Cache-buster: Supabase Storage/CDN не должен отдавать старый
            // manifest.json после публикации.
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let separator = if url.contains('?') { '&' } else { '?' };
            url = format!("{url}{separator}t={now_ms}");

            log::info!("[hotswap] Checking OTA manifest: {}", url);

            let response = client
                .get(&url)
                .header(reqwest::header::CACHE_CONTROL, "no-cache")
                .header(reqwest::header::PRAGMA, "no-cache")
                .send()
                .await
                .map_err(|e| Error::Network(e.to_string()))?;

            match response.status().as_u16() {
                // 204 — нет обновлений; 404 — манифест ещё не публиковался.
                204 | 404 => {
                    log::info!("[hotswap] No OTA manifest published yet ({})", response.status());
                    return Ok(None);
                }
                status if !(200..300).contains(&status) => {
                    return Err(Error::Http {
                        status,
                        message: "OTA manifest request failed".into(),
                    });
                }
                _ => {}
            }

            let manifest: HotswapManifest = response
                .json()
                .await
                .map_err(|e| Error::InvalidManifest(e.to_string()))?;

            // Дополнительная проверка sequence. Основную делает сам плагин в
            // updater::check_update, но так мы не тащим заведомо старый манифест.
            if manifest.sequence <= current_sequence {
                log::info!(
                    "[hotswap] Manifest seq {} <= current seq {}, no update",
                    manifest.sequence,
                    current_sequence
                );
                return Ok(None);
            }

            Ok(Some(manifest))
        })
    }
}

/// Инициализация плагина. Возвращает plugin и модифицированный Context
/// (плагин подменяет assets provider).
pub fn build(context: tauri::Context<Wry>) -> (HotswapPlugin<Wry>, tauri::Context<Wry>) {
    let plugin_config = context.config().plugins.0.get("hotswap").cloned();

    let get_str = |key: &str| -> Option<String> {
        plugin_config
            .as_ref()
            .and_then(|v| v.get(key))
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned)
    };

    let endpoint = get_str("endpoint").unwrap_or_else(|| DEFAULT_MANIFEST_URL.to_string());
    let pubkey = get_str("pubkey").unwrap_or_else(|| DEFAULT_PUBKEY.to_string());
    let channel = get_str("channel");

    let max_bundle_size = plugin_config
        .as_ref()
        .and_then(|v| v.get("max_bundle_size"))
        .and_then(|v| v.as_u64())
        .unwrap_or(256 * 1024 * 1024); // 256 MB: с запасом для Next.js-бандла

    let max_retries = plugin_config
        .as_ref()
        .and_then(|v| v.get("max_retries"))
        .and_then(|v| v.as_u64())
        .unwrap_or(3) as u32;

    if pubkey.trim().is_empty() {
        log::error!(
            "[hotswap] pubkey is empty — OTA downloads will fail signature verification"
        );
    }

    let mut builder = HotswapBuilder::new(pubkey)
        .resolver(SupabaseManifestResolver::new(endpoint))
        .max_bundle_size(max_bundle_size)
        .max_retries(max_retries)
        .require_https(true)
        // После обновления нативного бинарника сохраняем OTA-бандл, если он
        // всё ещё совместим по min_binary_version.
        .binary_cache_policy(BinaryCachePolicyKind::KeepCompatible)
        // Даём новому бандлу два запуска на подтверждение (notifyReady()).
        // Если приложение падает до подтверждения — откат на предыдущую версию.
        .confirmation_policy(ConfirmationPolicyKind::GracePeriod {
            max_unconfirmed_launches: 2,
        })
        .rollback_policy(RollbackPolicyKind::LatestConfirmed)
        .max_retained_versions(3);

    if let Some(channel) = channel {
        builder = builder.channel(channel);
    }

    builder
        .build(context)
        .expect("failed to initialize tauri-plugin-hotswap")
}
