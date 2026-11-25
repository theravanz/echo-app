#!/usr/bin/env node
/**
 * publish-ota.mjs — сборка, подпись и публикация OTA-бандла фронтенда.
 *
 * Что делает:
 *  1. `pnpm build` (Next.js static export → out/).
 *  2. Читает версию/sequence из ota-version.json (или аргументов).
 *  3. Упаковывает out/ в tar.gz с index.html в корне архива.
 *  4. Подписывает архив minisign-ключом через `tauri signer sign`.
 *  5. Генерирует manifest.json по контракту tauri-plugin-hotswap.
 *  6. Загружает архив + манифест в публичный бакет Supabase Storage.
 *
 * Использование:
 *   pnpm deploy:ota
 *   pnpm deploy:ota -- --skip-build
 *   pnpm deploy:ota -- --notes="Фикс тёмной темы" --mandatory
 *   pnpm deploy:ota -- --sequence=42 --version=0.2.7-ota.42
 *   pnpm deploy:ota -- --dry-run
 *
 * Переменные окружения (.env.local):
 *   SUPABASE_URL                 — https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    — service_role key (ТОЛЬКО на билд-машине!)
 *   SUPABASE_BUCKET_NAME         — публичный бакет (default: echo-ota)
 *   OTA_SIGNING_KEY_PATH         — путь к приватному minisign-ключу
 *                                  (default: ~/.tauri/echo-ota.key)
 *   OTA_SIGNING_KEY_PASSWORD     — пароль ключа (если есть)
 *
 * Приватный ключ НИКОГДА не коммитится. Публичный ключ лежит в
 * src-tauri/tauri.conf.json → plugins.hotswap.pubkey.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import * as tar from "tar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "out");
const BUILD_DIR = path.join(ROOT, ".ota-build");
const STATE_PATH = path.join(ROOT, "ota-version.json");
const TAURI_CONF_PATH = path.join(ROOT, "src-tauri", "tauri.conf.json");
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// .env.local имеет приоритет над .env. dotenv по умолчанию не перезаписывает
// уже установленные переменные, поэтому для .env.local используем override.
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });
dotenv.config({ path: path.join(ROOT, ".env.local"), override: true, quiet: true });

// ────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
const kv = Object.fromEntries(
  argv
    .filter((a) => a.startsWith("--") && a.includes("="))
    .map((a) => {
      const idx = a.indexOf("=");
      return [a.slice(2, idx), a.slice(idx + 1)];
    }),
);

const skipBuild = flags.has("--skip-build") || flags.has("--no-build");
const dryRun = flags.has("--dry-run");
const mandatory = flags.has("--mandatory");

function log(msg) {
  console.log(`\n[ota] ${msg}`);
}

function fail(msg) {
  console.error(`\n[ota] ✖ ${msg}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  console.log(`[ota] $ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: ROOT,
    env: process.env,
    ...options,
  });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with code ${result.status}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function normalizeBaseUrl(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Достаём строку `RW...` из .pub Tauri (base64 всего файла) или minisign .pub. */
function readPublicKey(keyPath) {
  const pubPath = `${keyPath}.pub`;
  if (!existsSync(pubPath)) return null;
  const raw = readFileSync(pubPath, "utf8").trim();
  if (!raw) return null;

  const fromText = (text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("RW")) ?? null;

  if (raw.startsWith("RW")) return fromText(raw);

  try {
    return fromText(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 1. Конфиг и версии
// ────────────────────────────────────────────────────────────────────
const pkg = readJson(path.join(ROOT, "package.json"));
const tauriConf = readJson(TAURI_CONF_PATH);
const nativeVersion = tauriConf.version || pkg.version;

let state = {
  version: `${pkg.version}-ota.0`,
  sequence: 0,
  min_binary_version: nativeVersion,
};
if (existsSync(STATE_PATH)) {
  try {
    state = { ...state, ...readJson(STATE_PATH) };
  } catch {
    fail(`Не удалось прочитать ${path.relative(ROOT, STATE_PATH)} — проверь JSON.`);
  }
}

const explicitSequence = kv.sequence !== undefined ? Number(kv.sequence) : null;
const nextSequence = explicitSequence ?? Number(state.sequence || 0) + 1;

if (!Number.isSafeInteger(nextSequence) || nextSequence <= 0) {
  fail(`Некорректный sequence: ${kv.sequence ?? nextSequence}`);
}
if (explicitSequence !== null && explicitSequence <= Number(state.sequence || 0)) {
  fail(
    `sequence ${explicitSequence} не больше уже опубликованного ${state.sequence}. ` +
      `Плагин сравнивает только sequence — регресс сломает обновления.`,
  );
}

const otaVersion = kv.version || `${pkg.version}-ota.${nextSequence}`;
const minNativeVersion = kv["min-native"] || state.min_binary_version || nativeVersion;
const notes = kv.notes || `Echo web bundle ${otaVersion}`;

const bucket = (kv.bucket || process.env.SUPABASE_BUCKET_NAME || "echo-ota").trim();
const manifestPath = "manifest.json";
const archiveName = `echo-web-${otaVersion}-seq${nextSequence}.tar.gz`.replace(
  /[^a-zA-Z0-9._-]/g,
  "_",
);
const bundlePath = `bundles/${archiveName}`;

log(`Версия: ${otaVersion}`);
log(`Sequence: ${nextSequence}`);
log(`min_binary_version: ${minNativeVersion} (native: ${nativeVersion})`);
log(`Бакет: ${bucket}`);
if (dryRun) log("Режим: DRY RUN (без загрузки в Supabase)");

// ────────────────────────────────────────────────────────────────────
// 2. Сборка Next.js
// ────────────────────────────────────────────────────────────────────
if (skipBuild) {
  log("Пропускаем сборку (--skip-build)");
  if (!existsSync(path.join(OUT_DIR, "index.html"))) {
    fail("out/index.html не найден. Запусти сборку без --skip-build.");
  }
} else {
  log("Собираем Next.js (static export)…");
  run(PNPM, ["build"]);
  if (!existsSync(path.join(OUT_DIR, "index.html"))) {
    fail("После сборки out/index.html не найден. Проверь next.config output: 'export'.");
  }
}

// ────────────────────────────────────────────────────────────────────
// 3. Архив
// ────────────────────────────────────────────────────────────────────
mkdirSync(BUILD_DIR, { recursive: true });
const archivePath = path.join(BUILD_DIR, archiveName);

log(`Упаковываем out/ → ${path.relative(ROOT, archivePath)}`);
// -C out . → index.html лежит в корне архива (плагин ждёт именно так).
await tar.create(
  {
    gzip: { level: 9 },
    cwd: OUT_DIR,
    file: archivePath,
    portable: true,
  },
  ["."],
);

// Проверяем, что корень архива действительно содержит index.html.
const entries = [];
await tar.t({
  file: archivePath,
  onentry: (entry) => entries.push(entry.path.replace(/^\.\//, "")),
});
if (!entries.includes("index.html")) {
  fail("В архиве нет index.html в корне. Плагин не сможет отдать приложение.");
}
log(`Архив готов: ${entries.length} файлов, ${(statSync(archivePath).size / 1024 / 1024).toFixed(2)} МБ`);

const archiveBytes = readFileSync(archivePath);
const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
const bundleSize = archiveBytes.length;

// ────────────────────────────────────────────────────────────────────
// 4. Подпись minisign
// ────────────────────────────────────────────────────────────────────
const keyPath = expandHome(
  process.env.OTA_SIGNING_KEY_PATH ||
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ||
    path.join(os.homedir(), ".tauri", "echo-ota.key"),
);
const keyString = process.env.OTA_SIGNING_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY || "";
const keyPassword =
  process.env.OTA_SIGNING_KEY_PASSWORD ??
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??
  "";

if (!keyString && !existsSync(keyPath)) {
  fail(
    `Приватный ключ не найден: ${keyPath}\n` +
      `Сгенерируй его: pnpm tauri signer generate -w ~/.tauri/echo-ota.key\n` +
      `или задай OTA_SIGNING_KEY_PATH / TAURI_SIGNING_PRIVATE_KEY.`,
  );
}

// Защита от подписи «чужим» ключом: публичная часть должна совпадать с
// pubkey, зашитым в tauri.conf.json.
if (!keyString) {
  const derivedPub = readPublicKey(keyPath);
  const configuredPub = tauriConf?.plugins?.hotswap?.pubkey;
  if (derivedPub && configuredPub && derivedPub !== configuredPub) {
    fail(
      "Публичный ключ из .pub не совпадает с plugins.hotswap.pubkey в tauri.conf.json.\n" +
        `  key:    ${derivedPub}\n` +
        `  config: ${configuredPub}\n` +
        "Подпиши тем же ключом, чей pubkey зашит в приложение, либо обнови конфиг и пересобери нативку.",
    );
  }
}

log("Подписываем архив (minisign через Tauri CLI)…");
const signArgs = ["exec", "tauri", "signer", "sign", archivePath];
if (keyString) signArgs.push("-k", keyString);
else signArgs.push("-f", keyPath);
signArgs.push("-p", keyPassword);
run(PNPM, signArgs);

const sigPath = `${archivePath}.sig`;
if (!existsSync(sigPath)) {
  fail(`Tauri CLI не создал подпись ${sigPath}`);
}
const signature = readFileSync(sigPath, "utf8").trim();
if (!signature) fail("Файл подписи пустой.");

// ────────────────────────────────────────────────────────────────────
// 5. Манифест
// ────────────────────────────────────────────────────────────────────
const supabaseUrl = normalizeBaseUrl(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
);
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const publicBundleUrl = supabaseUrl
  ? `${supabaseUrl}/storage/v1/object/public/${bucket}/${bundlePath}`
  : `https://example.invalid/${bucket}/${bundlePath}`;

const manifest = {
  version: otaVersion,
  sequence: nextSequence,
  // В контракте tauri-plugin-hotswap поле называется min_binary_version.
  // Это и есть min_native_version из ТЗ.
  min_binary_version: minNativeVersion,
  url: publicBundleUrl,
  signature,
  notes,
  pub_date: new Date().toISOString(),
  mandatory,
  bundle_size: bundleSize,
  // Плагин игнорирует лишние поля; sha256 полезен для аудита/диагностики.
  sha256,
};

const manifestFile = path.join(BUILD_DIR, manifestPath);
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
log(`Манифест: ${path.relative(ROOT, manifestFile)}`);

if (dryRun) {
  log("DRY RUN: архив и манифест готовы, загрузка пропущена.");
  log(`Архив: ${archivePath}`);
  log(`Манифест: ${manifestFile}`);
  process.exit(0);
}

if (!supabaseUrl) {
  fail("SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL) не задан в .env.local.");
}
if (!serviceKey) {
  fail("SUPABASE_SERVICE_ROLE_KEY не задан в .env.local. Это секрет билд-машины, не фронтенда.");
}

// ────────────────────────────────────────────────────────────────────
// 6. Загрузка в Supabase Storage
// ────────────────────────────────────────────────────────────────────
const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Публичный бакет создаём при первом деплое. Если он уже есть — игнорируем.
const { error: bucketError } = await supabase.storage.createBucket(bucket, {
  public: true,
});
if (bucketError) {
  const msg = String(bucketError.message || "");
  const status = bucketError.statusCode ?? bucketError.status;
  const exists = status === 409 || /already exists|duplicate|exists/i.test(msg);
  if (!exists) {
    console.warn(`[ota] ⚠ Не удалось создать бакет (${msg}). Продолжаем — возможно, он уже есть.`);
  }
}

log(`Загружаем архив → ${bucket}/${bundlePath}`);
const { error: bundleUploadError } = await supabase.storage
  .from(bucket)
  .upload(bundlePath, archiveBytes, {
    contentType: "application/gzip",
    cacheControl: "31536000", // версия/sequence в имени → immutable
    upsert: true,
  });
if (bundleUploadError) {
  fail(`Ошибка загрузки архива: ${bundleUploadError.message}`);
}

log(`Загружаем манифест → ${bucket}/${manifestPath}`);
const manifestBody = JSON.stringify(manifest, null, 2);
const { error: manifestUploadError } = await supabase.storage
  .from(bucket)
  .upload(manifestPath, manifestBody, {
    contentType: "application/json",
    // manifest.json перезаписывается: CDN обязан ревалидировать.
    cacheControl: "0",
    upsert: true,
  });
if (manifestUploadError) {
  fail(`Ошибка загрузки манифеста: ${manifestUploadError.message}`);
}

// История манифестов (не обязательна для клиента, но удобна для откатов/аудита).
const historyPath = `manifests/seq-${nextSequence}.json`;
await supabase.storage.from(bucket).upload(historyPath, manifestBody, {
  contentType: "application/json",
  cacheControl: "31536000",
  upsert: true,
});

// ────────────────────────────────────────────────────────────────────
// 7. Состояние (sequence) — только после успешной публикации
// ────────────────────────────────────────────────────────────────────
const newState = {
  version: otaVersion,
  sequence: nextSequence,
  min_binary_version: minNativeVersion,
  last_published_at: new Date().toISOString(),
};
writeFileSync(STATE_PATH, `${JSON.stringify(newState, null, 2)}\n`);

const { data: publicManifest } = supabase.storage.from(bucket).getPublicUrl(manifestPath);
const { data: publicBundle } = supabase.storage.from(bucket).getPublicUrl(bundlePath);

log("✅ OTA опубликовано");
console.log(`
  Версия:     ${otaVersion}
  Sequence:   ${nextSequence}
  Native min: ${minNativeVersion}
  Манифест:   ${publicManifest?.publicUrl ?? "(n/a)"}
  Бандл:      ${publicBundle?.publicUrl ?? "(n/a)"}
  SHA-256:    ${sha256}
  Размер:     ${(bundleSize / 1024 / 1024).toFixed(2)} МБ
`);
