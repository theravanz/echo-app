/**
 * Нативный мост к Rust-бэкенду Echo Messenger.
 * Все вызовы идут через invoke() к кастомным Rust-командам.
 * Шифрование токенов происходит внутри Rust (vault.rs, AES-256-GCM).
 */

import { invoke } from "@tauri-apps/api/core";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════════════
// Supabase клиент (для облачной синхронизации устройств)
// ═══════════════════════════════════════════════════════════════════

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "[Supabase] MISSING_ENV: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in environment"
      );
    }

    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
      },
    });
  }
  return supabaseClient;
}

// ═══════════════════════════════════════════════════════════════════
// DTO (Data Transfer Objects)
// ═══════════════════════════════════════════════════════════════════

export interface Session {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  device_hwid: string;
  device_name: string;
  ip_address: string;
  last_active: number;
  expires_at: number;
  created_at: number;
}

export interface Device {
  id: string;
  user_id: string;
  hwid: string;
  device_name: string;
  platform: string;
  device_type: string;
  os_name: string;
  browser_name: string;
  ip_address: string;
  location: string;
  timezone: string;
  is_vpn: boolean;
  last_active: number;
  is_current: boolean;
  created_at: number;
}

export interface Account {
  id: string;
  public_key: string;
  encrypted_seed: string;
  display_name: string;
  avatar_url: string;
  created_at: number;
  updated_at: number;
}

export interface SaveSessionParams {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token?: string;
  device_hwid?: string;
  device_name?: string;
  ip_address?: string;
  expires_at: number;
}

export interface SaveDeviceParams {
  id: string;
  user_id: string;
  hwid: string;
  device_name?: string;
  platform?: string;
  device_type?: string;
  os_name?: string;
  browser_name?: string;
  ip_address?: string;
  location?: string;
  timezone?: string;
  is_vpn?: boolean;
  is_current?: boolean;
}

export interface SaveAccountParams {
  id: string;
  public_key: string;
  encrypted_seed: string;
  display_name?: string;
  avatar_url?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Backend Gate — проверка готовности Rust-ядра
// ═══════════════════════════════════════════════════════════════════

let backendReadyPromise: Promise<void> | null = null;
const MAX_BACKEND_RETRIES = 20;
const BACKEND_RETRY_DELAY_MS = 300;

export function waitForBackend(): Promise<void> {
  if (backendReadyPromise) {
    return backendReadyPromise;
  }

  backendReadyPromise = (async () => {
    console.log(
      `[DB] Waiting for backend... (max ${MAX_BACKEND_RETRIES} attempts, ${BACKEND_RETRY_DELAY_MS}ms delay)`
    );
    for (let attempt = 1; attempt <= MAX_BACKEND_RETRIES; attempt++) {
      try {
        const ready = await invoke<boolean>("vault_status");
        if (ready) {
          console.info(`[DB] Backend ready on attempt ${attempt}`);
          return;
        }
        console.warn(`[DB] Backend not ready on attempt ${attempt}/${MAX_BACKEND_RETRIES}`);
      } catch (err) {
        console.warn(`[DB] Backend attempt ${attempt}/${MAX_BACKEND_RETRIES} error:`, err);
      }
      await new Promise((r) => setTimeout(r, BACKEND_RETRY_DELAY_MS));
    }

    // Сбрасываем на случай, если бэкенд станет готов позже (особенно на Android)
    backendReadyPromise = null;
    throw new Error(
      `[DB] Backend not ready after ${MAX_BACKEND_RETRIES} attempts`
    );
  })();

  return backendReadyPromise;
}

export function resetBackendGate(): void {
  backendReadyPromise = null;
}

// ═══════════════════════════════════════════════════════════════════
// SESSIONS (нативные команды)
// ═══════════════════════════════════════════════════════════════════

export async function saveSession(params: SaveSessionParams): Promise<void> {
  await waitForBackend();
  return invoke("save_session", {
    id: params.id,
    userId: params.user_id,
    accessToken: params.access_token,
    refreshToken: params.refresh_token ?? null,
    deviceHwid: params.device_hwid ?? null,
    deviceName: params.device_name ?? null,
    ipAddress: params.ip_address ?? null,
    expiresAt: params.expires_at,
  });
}

export async function getSession(userId: string): Promise<Session | null> {
  await waitForBackend();
  return invoke<Session | null>("get_session", { userId });
}

export async function deleteSession(id: string): Promise<void> {
  await waitForBackend();
  return invoke("delete_session", { id });
}

export async function getAllSessions(userId: string): Promise<Session[]> {
  await waitForBackend();
  return invoke<Session[]>("get_all_sessions", { userId });
}

export async function getPersistedSession(): Promise<Session | null> {
  await waitForBackend();
  return invoke<Session | null>("get_latest_session");
}

// ═══════════════════════════════════════════════════════════════════
// DEVICES (нативные команды)
// ═══════════════════════════════════════════════════════════════════

export async function saveDevice(params: SaveDeviceParams): Promise<void> {
  await waitForBackend();
  return invoke("save_device", {
    id: params.id,
    userId: params.user_id,
    hwid: params.hwid,
    deviceName: params.device_name ?? null,
    platform: params.platform ?? null,
    deviceType: params.device_type ?? null,
    osName: params.os_name ?? null,
    browserName: params.browser_name ?? null,
    ipAddress: params.ip_address ?? null,
    location: params.location ?? null,
    timezone: params.timezone ?? null,
    isVpn: params.is_vpn ?? null,
    isCurrent: params.is_current ?? null,
  });
}

export async function getDevices(userId: string): Promise<Device[]> {
  await waitForBackend();
  return invoke<Device[]>("get_devices", { userId });
}

export async function deleteDevice(id: string): Promise<void> {
  await waitForBackend();
  return invoke("delete_device", { id });
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNTS (нативные команды)
// ═══════════════════════════════════════════════════════════════════

export async function saveAccount(params: SaveAccountParams): Promise<void> {
  await waitForBackend();
  return invoke("save_account", {
    id: params.id,
    publicKey: params.public_key,
    encryptedSeed: params.encrypted_seed,
    displayName: params.display_name ?? null,
    avatarUrl: params.avatar_url ?? null,
  });
}

export async function getAccount(id: string): Promise<Account | null> {
  await waitForBackend();
  return invoke<Account | null>("get_account", { id });
}

// ═══════════════════════════════════════════════════════════════════
// VAULT (прямой доступ к шифрованию)
// ═══════════════════════════════════════════════════════════════════

export async function vaultEncrypt(plaintext: string): Promise<string> {
  await waitForBackend();
  return invoke<string>("vault_encrypt", { plaintext });
}

export async function vaultDecrypt(encryptedJson: string): Promise<string> {
  await waitForBackend();
  return invoke<string>("vault_decrypt", { encrypted_json: encryptedJson });
}

export async function vaultStatus(): Promise<boolean> {
  return invoke<boolean>("vault_status");
}

// ═══════════════════════════════════════════════════════════════════
// Backward Compatibility — старый API фронтенда
// ═══════════════════════════════════════════════════════════════════

export async function persistSession(
  session: SaveSessionParams | {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    expires_at?: number;
    user?: { id: string };
  }
): Promise<void> {
  await waitForBackend();
  
  // Если это Supabase Session — мапим в наш формат
  if ('user' in session && session.user) {
    const supabaseSession = session as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      expires_at?: number;
      user: { id: string }; // Теперь user точно есть
    };
    
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = supabaseSession.expires_at || 
                     (supabaseSession.expires_in ? now + supabaseSession.expires_in : now + 3600);
    
    return invoke("save_session", {
      id: `session_${supabaseSession.user.id}_${now}`,
      user_id: supabaseSession.user.id,
      access_token: supabaseSession.access_token,
      refresh_token: supabaseSession.refresh_token ?? null,
      device_hwid: null,
      device_name: null,
      ip_address: null,
      expires_at: expiresAt,
    });
  }
  
  // Если это наш формат — передаём как есть
  const ourSession = session as SaveSessionParams;
  return invoke("save_session", {
    id: ourSession.id,
    user_id: ourSession.user_id,
    access_token: ourSession.access_token,
    refresh_token: ourSession.refresh_token ?? null,
    device_hwid: ourSession.device_hwid ?? null,
    device_name: ourSession.device_name ?? null,
    ip_address: ourSession.ip_address ?? null,
    expires_at: ourSession.expires_at,
  });
}

export async function terminateSession(sessionId: string): Promise<void> {
  return deleteSession(sessionId);
}

/**
 * Безопасное хранение E2EE приватного ключа.
 * В Tauri-окружении — ИСКЛЮЧИТЕЛЬНО через vault (AES-256-GCM).
 * localStorage используется только как настоящий dev-фолбэк (не в Tauri),
 * а не как молчаливая заглушка при сбое vault.
 */
export async function savePrivateKey(keyBase64: string): Promise<void> {
  let tauriInvoke: typeof invoke | null = null;
  try {
    ({ invoke: tauriInvoke } = await import('@tauri-apps/api/core'));
  } catch {
    // Действительно не в Tauri (браузер/dev) — легитимный фолбэк.
    localStorage.setItem('echo_private_key_v2', keyBase64);
    return;
  }

  // Мы в Tauri — vault ОБЯЗАН сработать. Ошибку больше не глотаем.
  await tauriInvoke('vault_save_private_key', { keyBase64 });
}

/**
 * Миграция ключа из localStorage (legacy-фолбэк) в нативный vault.
 * Вызывать перед любым действием, которому нужен гарантированно
 * защищённый ключ (например, перед QR-авторизацией нового устройства).
 * Возвращает true, если после вызова ключ гарантированно в vault
 * (или мы легитимно не в Tauri и ключ есть в localStorage).
 */
export async function migratePrivateKeyToVault(): Promise<boolean> {
  let tauriInvoke: typeof invoke | null = null;
  try {
    ({ invoke: tauriInvoke } = await import('@tauri-apps/api/core'));
  } catch {
    return !!localStorage.getItem('echo_private_key_v2');
  }

  try {
    const existing = await tauriInvoke<string | null>('vault_load_private_key');
    if (existing) return true;
  } catch (err) {
    console.error('[DB] vault_load_private_key failed during migration check:', err);
    return false;
  }

  const legacyV2 = localStorage.getItem('echo_private_key_v2');
  const legacyV1 = localStorage.getItem('echo_private_key');
  const toMigrate = legacyV2 || legacyV1;
  if (!toMigrate) return false;

  try {
    await tauriInvoke('vault_save_private_key', { keyBase64: toMigrate });
  } catch (err) {
    console.error('[DB] Migration write to vault failed:', err);
    return false;
  }

  const verify = await tauriInvoke<string | null>('vault_load_private_key').catch(() => null);
  if (verify !== toMigrate) {
    console.error('[DB] Migration verify mismatch — keeping localStorage copy as safety net');
    return false;
  }

  localStorage.removeItem('echo_private_key_v2');
  localStorage.removeItem('echo_private_key');
  console.info('[DB] Private key migrated from localStorage to vault');
  return true;
}

export async function loadPrivateKey(): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result: string | null = await invoke('vault_load_private_key');
    if (result) return result;
  } catch {
    // not in Tauri
  }
  // Fallback #1: новый ключ v2
  const v2 = localStorage.getItem('echo_private_key_v2');
  if (v2) return v2;
  // Fallback #2: старый ключ (миграция)
  const legacy = localStorage.getItem('echo_private_key');
  if (legacy) {
    // Автоматическая миграция на v2
    localStorage.setItem('echo_private_key_v2', legacy);
    return legacy;
  }
  return null;
}

export async function deletePrivateKey(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('vault_delete_private_key');
  } catch {
    // not in Tauri
  }
  localStorage.removeItem('echo_private_key_v2');
  localStorage.removeItem('echo_private_key');
}

export async function generateHWID(): Promise<string> {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    new Date().getTimezoneOffset(),
  ].join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getLocalAccount(id: string): Promise<Account | null> {
  return getAccount(id);
}

export async function saveLocalAccount(
  account: SaveAccountParams
): Promise<void> {
  return saveAccount(account);
}

export async function ensureAuth(): Promise<Session | null> {
  try {
    const session = await getPersistedSession();
    if (!session) return null;

    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at < now) {
      console.warn("[Auth] Session expired");
      return null;
    }

    return session;
  } catch (err) {
    console.error("[Auth] ensureAuth failed:", err);
    return null;
  }
}