/**
 * OTA-обновления веб-бандла (Next.js static export).
 *
 * Манифест лежит в публичном бакете Supabase Storage. Формат — контракт
 * `tauri-plugin-hotswap` (см. docs/server-contract.md):
 *
 * {
 *   "version": "0.2.7-ota.3",
 *   "sequence": 3,                  // монотонный счётчик, единственное поле
 *                                   // по которому плагин сравнивает версии
 *   "min_binary_version": "0.3.0",  // минимум нативной версии (tauri.conf.json)
 *   "url": "https://.../frontend.tar.gz",
 *   "signature": "...",             // minisign, проверяется в Rust
 *   ...
 * }
 *
 * В задаче это поле называлось `min_native_version`; в API плагина оно
 * называется `min_binary_version`. Поддерживаем оба варианта на случай
 * миграции/ручных манифестов.
 */

export interface OtaManifest {
  version: string;
  sequence: number;
  min_binary_version?: string;
  /** Алиас из ТЗ; плагин использует min_binary_version. */
  min_native_version?: string;
  url: string;
  signature: string;
  notes?: string | null;
  pub_date?: string;
  mandatory?: boolean;
  bundle_size?: number;
  /** Необязательный SHA-256 архива (для диагностики/аудита). */
  sha256?: string;
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const OTA_BUCKET = process.env.NEXT_PUBLIC_OTA_BUCKET ?? "echo-ota";
const OTA_MANIFEST_PATH = (process.env.NEXT_PUBLIC_OTA_MANIFEST_PATH ?? "manifest.json").replace(
  /^\/+/,
  "",
);

/**
 * Полный URL манифеста. Можно переопределить целиком через
 * NEXT_PUBLIC_OTA_MANIFEST_URL (например, для staging-бакета).
 */
export const OTA_MANIFEST_URL =
  process.env.NEXT_PUBLIC_OTA_MANIFEST_URL?.trim() ||
  (SUPABASE_URL
    ? `${SUPABASE_URL}/storage/v1/object/public/${OTA_BUCKET}/${OTA_MANIFEST_PATH}`
    : "");

/** Проверять OTA в dev-режиме (по умолчанию — только production). */
export const OTA_ENABLED =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_OTA_DEV === "true";

/** Ссылка на страницу/установщик новой нативной версии (необязательно). */
export const OTA_NATIVE_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_OTA_NATIVE_DOWNLOAD_URL?.trim() || "";

/**
 * Простое сравнение semver-подобных версий (major.minor.patch).
 * Возвращает -1 / 0 / 1. Пререлиз (1.0.0-beta) считается меньше 1.0.0.
 * Этого достаточно для min_binary_version; полноценный semver-парсер здесь
 * не нужен и не тянет лишнюю зависимость в статический бандл.
 */
export function compareVersions(a: string, b: string): number {
  const core = (v: string) => v.trim().replace(/^v/i, "").split("-")[0].split("+")[0];
  const parts = (v: string) => core(v).split(".").map((n) => Number.parseInt(n, 10) || 0);

  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length, 3);

  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }

  const aPre = a.includes("-");
  const bPre = b.includes("-");
  if (aPre !== bPre) return aPre ? -1 : 1;

  return 0;
}

/**
 * Загружает манифест с обходом CDN-кэша.
 *
 * `?t=` обязателен: Supabase Storage отдаёт публичные объекты через CDN,
 * а manifest.json перезаписывается при каждом релизе. Дополнительно ставим
 * `cache: "no-store"` — браузер не должен отдавать ответ из HTTP-кэша.
 */
export async function fetchOtaManifest(signal?: AbortSignal): Promise<OtaManifest | null> {
  if (!OTA_MANIFEST_URL) return null;

  const separator = OTA_MANIFEST_URL.includes("?") ? "&" : "?";
  const url = `${OTA_MANIFEST_URL}${separator}t=${Date.now()}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal,
    headers: { Accept: "application/json" },
  });

  // 404/204 = манифест ещё не публиковался, это не ошибка.
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`OTA manifest HTTP ${response.status}`);
  }

  const manifest = (await response.json()) as OtaManifest;
  if (!manifest || typeof manifest.sequence !== "number" || !manifest.version) {
    throw new Error("OTA manifest has invalid shape");
  }

  return manifest;
}

/** Минимальная нативная версия, требуемая манифестом. */
export function getMinNativeVersion(manifest: OtaManifest): string | null {
  return manifest.min_binary_version ?? manifest.min_native_version ?? null;
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
