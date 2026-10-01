import type { FaroSessionStorage } from '../core/platform/runtime'
import { isFaroDesktop } from './desktopBridge'

function webViewRecoveryStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function readRecoveryValue(key: string) {
  try {
    return webViewRecoveryStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeRecoveryValue(key: string, value: string) {
  try {
    webViewRecoveryStorage()?.setItem(key, value)
  } catch {
    // A locked/private WebView must not make an otherwise valid sign-in fail.
  }
}

function removeRecoveryValue(key: string) {
  try {
    webViewRecoveryStorage()?.removeItem(key)
  } catch {
    // Best effort only; Supabase still clears its in-memory session.
  }
}

/**
 * Supabase's async storage contract for Desktop.
 *
 * This session intentionally stays in FARO's persistent WebView storage.
 *
 * Reading a Keychain entry during Supabase boot blocks the whole application
 * behind macOS's permission sheet—especially after a local build is signed
 * again. The native Keychain remains reserved for the explicit FARO Vault and
 * Google Drive credentials; signing in to FARO must never require a Keychain
 * prompt just to render the app.
 */
export const desktopSessionStorage: FaroSessionStorage = {
  async getItem(key) {
    if (!isFaroDesktop()) return null
    return readRecoveryValue(key)
  },
  async setItem(key, value) {
    if (!isFaroDesktop()) return
    writeRecoveryValue(key, value)
  },
  async removeItem(key) {
    if (!isFaroDesktop()) return
    removeRecoveryValue(key)
  },
}
