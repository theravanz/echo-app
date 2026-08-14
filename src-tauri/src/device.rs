//! Устройство-привязка: HWID + Argon2id → 32-байтовый ключ для данных at-rest.
//!
//! Секрет (E2EE-ключ) никогда не хранится в открытом виде и не покидает Rust.
//! При смене железа (HWID изменился) расшифровка данных невозможна → требуется
//! recovery через мнемонику (см. `crypto_restore_key`).

use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

/// Ключ E2EE-приватный ключ (X25519 scalar = seed[0..32]).
pub const KEY_SIZE: usize = 32;

/// Параметры Argon2id (OWASP-рекомендуемые для 2024+):
/// memory 64 MiB, iterations 3, parallelism 1, output 32 байта.
fn argon_params() -> Result<Params, String> {
    Params::new(64 * 1024, 3, 1, Some(KEY_SIZE)).map_err(|e| format!("[Device] Argon2 params: {e}"))
}

/// Прочитать стабильный HWID этой машины.
/// - Linux: `/etc/machine-id`
/// - macOS: IOPlatformUUID (через ioreg)
/// - Windows: CIM NetworkAdapter MAC + MachineGuid
/// Фолбэки для dev-окружений, чтобы не падать при недоступности команд.
pub fn machine_id() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        for path in ["/etc/machine-id", "/var/lib/dbus/machine-id", "/proc/sys/kernel/random/boot_id"] {
            if let Ok(raw) = std::fs::read_to_string(path) {
                let id = raw.trim().to_string();
                if !id.is_empty() {
                    return Ok(id);
                }
            }
        }
        // Фолбэк: hostname (не идеально, но стабильно на той же машине).
        if let Some(h) = hostname() {
            return Ok(h);
        }
        Err("[Device] cannot determine machine id on Linux".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output();
        if let Ok(o) = out {
            if let Ok(s) = String::from_utf8(o.stdout) {
                for line in s.lines() {
                    if let Some(idx) = line.find("IOPlatformUUID") {
                        let frag = &line[idx..];
                        if let Some(eq) = frag.find('=') {
                            let uuid = frag[eq + 1..]
                                .trim()
                                .trim_matches('"')
                                .trim()
                                .to_string();
                            if !uuid.is_empty() {
                                return Ok(uuid);
                            }
                        }
                    }
                }
            }
        }
        hostname().ok_or_else(|| "[Device] cannot determine machine id on macOS".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(o) = std::process::Command::new("wmic")
            .args(["csproduct", "get", "uuid"])
            .output()
        {
            if let Ok(s) = String::from_utf8(o.stdout) {
                for line in s.lines() {
                    let t = line.trim();
                    if !t.is_empty() && t.to_lowercase() != "uuid" {
                        return Ok(t.to_string());
                    }
                }
            }
        }
        hostname().ok_or_else(|| "[Device] cannot determine machine id on Windows".to_string())
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        hostname().ok_or_else(|| "[Device] unsupported platform".to_string())
    }
}

/// Хостнейм как фолбэк для dev-среды.
fn hostname() -> Option<String> {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Деривировать 32-байтовый device-ключ из HWID + соль (Argon2id).
/// Соль не секретна и хранится рядом с шифротекстом.
pub fn device_key(machine: &str, salt: &[u8]) -> Result<Zeroizing<[u8; KEY_SIZE]>, String> {
    let params = argon_params()?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; KEY_SIZE];
    argon2
        .hash_password_into(machine.as_bytes(), salt, &mut out)
        .map_err(|e| format!("[Device] Argon2id failed: {e}"))?;
    Ok(Zeroizing::new(out))
}