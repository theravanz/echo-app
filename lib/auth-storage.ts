//!
//! Persistence прогресса авторизации — аналог Telegram.
//! При обновлении/перезагрузке восстановит шаг, номер телефона, OTP и т.д.
//! Данные хранятся в SQLite (таблица auth_progress), переживают выгрузку приложения.
//!

import Database from '@tauri-apps/plugin-sql'
import { invoke } from '@tauri-apps/api/core'

// ═══════════════════════════════════════════════════════════════════
// Типы сохраняемого состояния
// ═══════════════════════════════════════════════════════════════════

export interface AuthProgress {
  step: number          // 1 | 2 | 3 | 4 | 5
  authMode: 'sms' | 'email'
  phone: string
  countryCode: string
  email: string
  otp: string[]         // 8 символов
  resendSeconds: number
  phoneVerificationFailed: boolean
  updatedAt: string
}

const TABLE = 'auth_progress'
let dbPromise: Promise<Database> | null = null

async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:echo.db')
  }
  return dbPromise
}

// ═══════════════════════════════════════════════════════════════════
// Сохранить ключ-значение
// ═══════════════════════════════════════════════════════════════════

async function setItem(key: string, value: string): Promise<void> {
  try {
    // Пробуем через Rust команду (если есть)
    await invoke('save_auth_progress', { key, value })
  } catch {
    // Fallback: прямой SQLite
    const db = await getDb()
    await db.execute(
      `INSERT OR REPLACE INTO ${TABLE} (key, value, updated_at)
       VALUES ($1, $2, strftime('%s','now'))`,
      [key, value],
    )
  }
}

async function getItem(key: string): Promise<string | null> {
  try {
    // Пробуем через Rust команду
    const result: string | null = await invoke('get_auth_progress', { key })
    if (result) return result
  } catch {
    // Fallback
  }
  
  try {
    const db = await getDb()
    const rows = await db.select<{ value: string }[]> (
      `SELECT value FROM ${TABLE} WHERE key = $1`,
      [key],
    )
    return rows.length > 0 ? rows[0].value : null
  } catch {
    return null
  }
}

async function removeItem(key: string): Promise<void> {
  try {
    await invoke('delete_auth_progress', { key })
  } catch {
    const db = await getDb()
    await db.execute(`DELETE FROM ${TABLE} WHERE key = $1`, [key])
  }
}

// ═══════════════════════════════════════════════════════════════════
// Сохранить / восстановить полный прогресс
// ═══════════════════════════════════════════════════════════════════

export async function saveAuthProgress(state: Partial<AuthProgress>): Promise<void> {
  const current = await loadAuthProgress()
  const merged = { ...current, ...state, updatedAt: new Date().toISOString() }
  await setItem('auth_progress', JSON.stringify(merged))
}

export async function loadAuthProgress(): Promise<AuthProgress | null> {
  const raw = await getItem('auth_progress')
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthProgress
  } catch {
    return null
  }
}

export async function clearAuthProgress(): Promise<void> {
  await removeItem('auth_progress')
}
