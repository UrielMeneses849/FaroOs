//! FARO Vault is deliberately isolated from the rest of the desktop app.
//!
//! Its encrypted payload never crosses a global event, telemetry, Archive or
//! Storage surface.  The only IPC responses carrying a secret are the exact
//! credential requested by an already-unlocked user; copy actions stay native.

use std::{
    collections::HashMap,
    ffi::{c_char, CStr},
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use chacha20poly1305::{
    aead::{rand_core::RngCore, Aead, AeadCore, KeyInit, OsRng},
    Key, XChaCha20Poly1305, XNonce,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

const VAULT_FILE: &str = "faro-vault-v1.enc";
const VAULT_KEY_MISSING: &str = "No encontré la llave de FARO Vault en el llavero de macOS.";
const VAULT_VERSION: u8 = 1;
const DEFAULT_TIMEOUT_MINUTES: u8 = 5;
const CLIPBOARD_CLEAR_AFTER: Duration = Duration::from_secs(90);
const MAX_CREDENTIALS: usize = 2_000;
// A freshly-created payload serializes to 69 bytes and the AEAD tag adds 16
// bytes. The preceding focus-lock default serialized to 68 bytes. These
// values are used only to recognize an empty starter vault without ever
// attempting to reset a vault that could contain credentials.
const EMPTY_VAULT_CIPHERTEXT_BYTES: usize = 85;
const LEGACY_EMPTY_VAULT_CIPHERTEXT_BYTES: usize = 84;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub exists: bool,
    pub locked: bool,
    pub timeout_minutes: u8,
    pub lock_on_blur: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSecurityOverview {
    pub credential_count: usize,
    pub reused_count: usize,
    pub weak_count: usize,
    pub old_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCredentialSummary {
    pub id: String,
    pub service_name: String,
    pub username: String,
    pub url: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub updated_at: u64,
    pub password_changed_at: u64,
    pub strength: String,
    pub reused_with: usize,
    pub password_age_days: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCredentialDetail {
    pub id: String,
    pub service_name: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub password_changed_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultListResponse {
    pub credentials: Vec<VaultCredentialSummary>,
    pub security: VaultSecurityOverview,
    pub timeout_minutes: u8,
    pub lock_on_blur: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCredentialInput {
    service_name: String,
    username: String,
    password: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCredentialPatch {
    service_name: Option<String>,
    username: Option<String>,
    password: Option<String>,
    url: Option<String>,
    notes: Option<String>,
    favorite: Option<bool>,
    tags: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultGeneratorOptions {
    #[serde(default)]
    length: Option<u8>,
    #[serde(default = "default_true")]
    uppercase: bool,
    #[serde(default = "default_true")]
    lowercase: bool,
    #[serde(default = "default_true")]
    numbers: bool,
    #[serde(default = "default_true")]
    symbols: bool,
    #[serde(default)]
    avoid_ambiguous: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultGeneratedPassword {
    pub password: String,
    pub length: u8,
    pub strength: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSettingsPatch {
    #[serde(default)]
    auto_lock_minutes: Option<u8>,
    #[serde(default)]
    lock_on_blur: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultClipboardResponse {
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultCredential {
    id: String,
    service_name: String,
    username: String,
    password: String,
    url: String,
    notes: String,
    favorite: bool,
    tags: Vec<String>,
    created_at: u64,
    updated_at: u64,
    password_changed_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultPayload {
    version: u8,
    auto_lock_minutes: u8,
    #[serde(default)]
    lock_on_blur: bool,
    credentials: Vec<VaultCredential>,
}

impl Default for VaultPayload {
    fn default() -> Self {
        Self {
            version: VAULT_VERSION,
            auto_lock_minutes: DEFAULT_TIMEOUT_MINUTES,
            // A Vault remains protected by the automatic inactivity timeout
            // and an explicit lock. Losing focus while switching between FARO
            // views must not force another Keychain authorization.
            lock_on_blur: false,
            credentials: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedVaultFile {
    version: u8,
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

#[derive(Debug)]
struct VaultSession {
    // This is deliberately process-memory only. The Keychain is consulted
    // once at unlock; every subsequent read/write uses this short-lived copy
    // until the Vault locks or its inactivity deadline expires.
    key: [u8; 32],
    expires_at: Instant,
    timeout_minutes: u8,
}

#[derive(Clone, Debug)]
struct ClipboardLease {
    id: u64,
    fingerprint: [u8; 32],
}

pub struct VaultSessionState {
    session: Mutex<Option<VaultSession>>,
    clipboard: Mutex<Option<ClipboardLease>>,
    clipboard_key: [u8; 32],
    clipboard_sequence: AtomicU64,
}

impl Default for VaultSessionState {
    fn default() -> Self {
        let mut clipboard_key = [0_u8; 32];
        OsRng.fill_bytes(&mut clipboard_key);
        Self {
            session: Mutex::new(None),
            clipboard: Mutex::new(None),
            clipboard_key,
            clipboard_sequence: AtomicU64::new(0),
        }
    }
}

fn default_true() -> bool {
    true
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn valid_timeout(minutes: u8) -> bool {
    matches!(minutes, 1 | 5 | 15 | 30)
}

fn timeout_or_default(minutes: u8) -> u8 {
    valid_timeout(minutes)
        .then_some(minutes)
        .unwrap_or(DEFAULT_TIMEOUT_MINUTES)
}

fn vault_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&path)
        .map_err(|_| "No pude preparar el almacenamiento local de FARO Vault.".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o700));
    }
    Ok(path)
}

fn vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(vault_dir(app)?.join(VAULT_FILE))
}

unsafe extern "C" {
    fn faro_vault_copy_biometric_key(
        out_key: *mut *mut u8,
        out_length: *mut usize,
        out_error: *mut *mut c_char,
    ) -> i32;
    fn faro_vault_authenticate_only(out_error: *mut *mut c_char) -> i32;
    fn faro_vault_free_buffer(value: *mut std::ffi::c_void);
}

const NATIVE_KEY_SUCCESS: i32 = 0;
const NATIVE_KEY_MISSING: i32 = 1;

fn native_keychain_error(error: *mut c_char, fallback: &str) -> String {
    if error.is_null() {
        return fallback.to_string();
    }
    let message = unsafe { CStr::from_ptr(error) }
        .to_string_lossy()
        .trim()
        .to_string();
    unsafe { faro_vault_free_buffer(error.cast()) };
    if message.is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

fn hex_encode(value: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(value.len() * 2);
    for byte in value {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn load_legacy_key() -> Result<[u8; 32], String> {
    let mut raw_key = std::ptr::null_mut();
    let mut raw_length = 0_usize;
    let mut raw_error = std::ptr::null_mut();
    let status = unsafe {
        faro_vault_copy_biometric_key(&mut raw_key, &mut raw_length, &mut raw_error)
    };
    if status == NATIVE_KEY_MISSING {
        return Err(VAULT_KEY_MISSING.to_string());
    }
    if status != NATIVE_KEY_SUCCESS {
        return Err(native_keychain_error(
            raw_error,
            "No pude abrir FARO Vault con Touch ID.",
        ));
    }
    if raw_key.is_null() || raw_length != 32 {
        if !raw_key.is_null() {
            unsafe { faro_vault_free_buffer(raw_key.cast()) };
        }
        return Err("La llave protegida de FARO Vault no tiene un formato válido.".to_string());
    }
    let mut key = [0_u8; 32];
    unsafe {
        key.copy_from_slice(std::slice::from_raw_parts(raw_key, raw_length));
        faro_vault_free_buffer(raw_key.cast());
    }
    Ok(key)
}

// User-selected lower-friction access: the OS account protects the local key
// file; Touch ID gates access through FARO. This is not Keychain-backed storage.
fn local_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(vault_dir(app)?.join("faro-vault-local-key-v1.bin"))
}

fn authenticate_local_access() -> Result<(), String> {
    let mut error = std::ptr::null_mut();
    if unsafe { faro_vault_authenticate_only(&mut error) } == NATIVE_KEY_SUCCESS {
        Ok(())
    } else {
        Err(native_keychain_error(error, "No pude confirmar tu huella. Vault sigue bloqueado."))
    }
}

fn read_local_key(path: &Path) -> Result<[u8; 32], String> {
    let mut bytes = fs::read(path).map_err(|_| "No pude leer la llave local de Vault.".to_string())?;
    let result = bytes.as_slice().try_into()
        .map_err(|_| "La llave local de Vault no es válida. No se modificaron tus credenciales.".to_string());
    bytes.zeroize();
    result
}

fn persist_local_key(path: &Path, key: &[u8; 32]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let mut existing = read_local_key(path)?;
            let same = existing == *key;
            existing.zeroize();
            return if same { Ok(()) } else { Err("Ya existe otra llave local. No se reemplazó.".to_string()) };
        }
        Err(_) => return Err("No pude preparar el acceso local a Vault.".to_string()),
    };
    if file.write_all(key).and_then(|_| file.sync_all()).is_err() {
        drop(file);
        let _ = fs::remove_file(path);
        return Err("No pude guardar la llave local de Vault.".to_string());
    }
    Ok(())
}

fn load_key(app: &AppHandle) -> Result<([u8; 32], bool), String> {
    let path = local_key_path(app)?;
    if path.try_exists().map_err(|_| "No pude comprobar el acceso local a Vault.".to_string())? {
        authenticate_local_access()?;
        return read_local_key(&path).map(|key| (key, false));
    }
    // The legacy ACL may need one final macOS authorization. Migrate only
    // after the returned key has successfully decrypted the existing vault.
    load_legacy_key().map(|key| (key, true))
}

fn encrypt_payload(key: &[u8; 32], payload: &VaultPayload) -> Result<EncryptedVaultFile, String> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let mut plaintext = serde_json::to_vec(payload)
        .map_err(|_| "No pude preparar los datos cifrados de FARO Vault.".to_string())?;
    let result = cipher
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|_| "No pude cifrar FARO Vault.".to_string());
    plaintext.zeroize();
    result.map(|ciphertext| EncryptedVaultFile {
        version: VAULT_VERSION,
        nonce: nonce.to_vec(),
        ciphertext,
    })
}

fn decrypt_payload(key: &[u8; 32], stored: &EncryptedVaultFile) -> Result<VaultPayload, String> {
    if stored.version != VAULT_VERSION || stored.nonce.len() != 24 || stored.ciphertext.len() < 16 {
        return Err(
            "El archivo cifrado de FARO Vault no es compatible o está incompleto.".to_string(),
        );
    }
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let mut plaintext = cipher
        .decrypt(
            XNonce::from_slice(&stored.nonce),
            stored.ciphertext.as_ref(),
        )
        .map_err(|_| {
            "No pude abrir FARO Vault: el archivo está corrupto o fue modificado.".to_string()
        })?;
    let payload: Result<VaultPayload, String> = serde_json::from_slice(&plaintext)
        .map_err(|_| "No pude leer el contenido cifrado de FARO Vault.".to_string());
    plaintext.zeroize();
    let payload = payload?;
    if payload.version != VAULT_VERSION || payload.credentials.len() > MAX_CREDENTIALS {
        return Err("El contenido cifrado de FARO Vault no es compatible.".to_string());
    }
    Ok(payload)
}

fn read_payload_with_key(app: &AppHandle, key: &[u8; 32]) -> Result<VaultPayload, String> {
    let bytes = fs::read(vault_path(app)?)
        .map_err(|_| "No pude encontrar el archivo cifrado de FARO Vault.".to_string())?;
    let stored: EncryptedVaultFile = serde_json::from_slice(&bytes)
        .map_err(|_| "El archivo de FARO Vault no es válido.".to_string())?;
    decrypt_payload(key, &stored)
}

fn read_payload(app: &AppHandle) -> Result<VaultPayload, String> {
    let mut key = vault_session_key(app)?;
    let payload = read_payload_with_key(app, &key);
    key.zeroize();
    payload
}

fn write_payload_with_key(
    app: &AppHandle,
    key: &[u8; 32],
    payload: &VaultPayload,
) -> Result<(), String> {
    let encrypted = encrypt_payload(key, payload)?;
    let data =
        serde_json::to_vec(&encrypted).map_err(|_| "No pude guardar FARO Vault.".to_string())?;
    let path = vault_path(app)?;
    let temporary = path.with_extension("enc.tmp");
    fs::write(&temporary, data).map_err(|_| "No pude guardar FARO Vault.".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&temporary, &path)
        .map_err(|_| "No pude finalizar el guardado de FARO Vault.".to_string())
}

fn write_payload(app: &AppHandle, payload: &VaultPayload) -> Result<(), String> {
    let mut key = vault_session_key(app)?;
    let result = write_payload_with_key(app, &key, payload);
    key.zeroize();
    result
}

fn wipe_payload(payload: &mut VaultPayload) {
    for credential in &mut payload.credentials {
        credential.id.zeroize();
        credential.service_name.zeroize();
        credential.username.zeroize();
        credential.password.zeroize();
        credential.url.zeroize();
        credential.notes.zeroize();
        for tag in &mut credential.tags {
            tag.zeroize();
        }
        credential.tags.clear();
    }
    payload.credentials.clear();
}

fn vault_exists(app: &AppHandle) -> Result<bool, String> {
    Ok(vault_path(app)?.is_file())
}

fn is_empty_starter_vault(app: &AppHandle) -> Result<bool, String> {
    let bytes = fs::read(vault_path(app)?)
        .map_err(|_| "No pude leer el archivo cifrado de FARO Vault.".to_string())?;
    let stored: EncryptedVaultFile = serde_json::from_slice(&bytes)
        .map_err(|_| "El archivo de FARO Vault no es válido.".to_string())?;
    Ok(stored.version == VAULT_VERSION
        && stored.nonce.len() == 24
        && matches!(
            stored.ciphertext.len(),
            EMPTY_VAULT_CIPHERTEXT_BYTES | LEGACY_EMPTY_VAULT_CIPHERTEXT_BYTES
        ))
}

fn repair_empty_starter_vault(app: &AppHandle) -> Result<VaultStatus, String> {
    if !is_empty_starter_vault(app)? {
        return Err("La llave anterior de FARO Vault no está en el Llavero de macOS. Como esta bóveda podría contener credenciales, FARO no la reemplazó.".to_string());
    }
    let current = vault_path(app)?;
    let backup = vault_dir(app)?.join(format!("faro-vault-v1-empty-backup-{}.enc", now_seconds()));
    fs::rename(&current, &backup).map_err(|_| "No pude preservar la bóveda inicial antes de repararla.".to_string())?;
    match create(app) {
        Ok(status) => Ok(status),
        Err(error) => {
            let _ = fs::rename(&backup, &current);
            Err(error)
        }
    }
}

fn clear_session(session: &mut Option<VaultSession>) {
    if let Some(current) = session.as_mut() {
        current.key.zeroize();
    }
    *session = None;
}

fn activate_session(app: &AppHandle, key: &[u8; 32], timeout_minutes: u8) -> Result<(), String> {
    let state = app.state::<VaultSessionState>();
    let mut session = state
        .session
        .lock()
        .map_err(|_| "No pude preparar la sesión de FARO Vault.".to_string())?;
    clear_session(&mut session);
    *session = Some(VaultSession {
        key: *key,
        expires_at: Instant::now() + Duration::from_secs(u64::from(timeout_minutes) * 60),
        timeout_minutes,
    });
    Ok(())
}

fn session_timeout(state: &VaultSessionState) -> Option<u8> {
    let mut session = state.session.lock().ok()?;
    match session.as_mut() {
        Some(current) if current.expires_at > Instant::now() => {
            let timeout = current.timeout_minutes;
            current.expires_at = Instant::now() + Duration::from_secs(u64::from(timeout) * 60);
            Some(timeout)
        }
        _ => {
            clear_session(&mut session);
            None
        }
    }
}

fn vault_session_timeout(app: &AppHandle) -> Result<u8, String> {
    session_timeout(&app.state::<VaultSessionState>()).ok_or_else(|| {
        "FARO Vault está bloqueado. Desbloquéalo con macOS para continuar.".to_string()
    })
}

fn vault_session_key(app: &AppHandle) -> Result<[u8; 32], String> {
    let state = app.state::<VaultSessionState>();
    let mut session = state
        .session
        .lock()
        .map_err(|_| "No pude preparar la sesión de FARO Vault.".to_string())?;
    match session.as_mut() {
        Some(current) if current.expires_at > Instant::now() => {
            let timeout = current.timeout_minutes;
            current.expires_at = Instant::now() + Duration::from_secs(u64::from(timeout) * 60);
            Ok(current.key)
        }
        _ => {
            clear_session(&mut session);
            Err("FARO Vault está bloqueado. Desbloquéalo con macOS para continuar.".to_string())
        }
    }
}

fn lock_session(app: &AppHandle) {
    if let Ok(mut session) = app.state::<VaultSessionState>().session.lock() {
        clear_session(&mut session);
    }
}

fn fingerprint(state: &VaultSessionState, value: &str) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(state.clipboard_key);
    digest.update(value.as_bytes());
    digest.finalize().into()
}

fn write_clipboard(value: &str) -> Result<(), String> {
    let mut child = Command::new("/usr/bin/pbcopy")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "No pude abrir el portapapeles de macOS.".to_string())?;
    child
        .stdin
        .take()
        .ok_or_else(|| "No pude abrir el portapapeles de macOS.".to_string())?
        .write_all(value.as_bytes())
        .map_err(|_| "No pude copiar al portapapeles de macOS.".to_string())?;
    if child
        .wait()
        .map_err(|_| "No pude copiar al portapapeles de macOS.".to_string())?
        .success()
    {
        Ok(())
    } else {
        Err("No pude copiar al portapapeles de macOS.".to_string())
    }
}

fn read_clipboard() -> Result<String, String> {
    let output = Command::new("/usr/bin/pbpaste")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|_| "No pude revisar el portapapeles de macOS.".to_string())?;
    if !output.status.success() {
        return Err("No pude revisar el portapapeles de macOS.".to_string());
    }
    String::from_utf8(output.stdout)
        .map_err(|_| "El portapapeles de macOS no contiene texto compatible.".to_string())
}

fn clear_clipboard_if_current(app: &AppHandle, lease: &ClipboardLease) {
    let state = app.state::<VaultSessionState>();
    let still_current = state
        .clipboard
        .lock()
        .ok()
        .and_then(|current| current.as_ref().map(|item| item.id == lease.id))
        .unwrap_or(false);
    if !still_current {
        return;
    }
    let mut clipboard = match read_clipboard() {
        Ok(value) => value,
        Err(_) => return,
    };
    let unchanged = fingerprint(state.inner(), &clipboard) == lease.fingerprint;
    clipboard.zeroize();
    if !unchanged {
        return;
    }
    if write_clipboard("").is_ok() {
        if let Ok(mut current) = state.clipboard.lock() {
            if current.as_ref().is_some_and(|item| item.id == lease.id) {
                *current = None;
            }
        }
    }
}

fn validate_text(
    value: &str,
    label: &str,
    maximum: usize,
    required: bool,
) -> Result<String, String> {
    let trimmed = value.trim();
    if (required && trimmed.is_empty())
        || trimmed.chars().count() > maximum
        || trimmed.chars().any(char::is_control)
    {
        return Err(format!("{label} no es válido."));
    }
    Ok(trimmed.to_string())
}

fn validate_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if value.chars().count() > 1_024
        || value.chars().any(char::is_control)
        || !value.starts_with("https://")
    {
        return Err("La URL debe usar https:// y tener un formato válido.".to_string());
    }
    Ok(value.to_string())
}

fn validate_tags(tags: Vec<String>) -> Result<Vec<String>, String> {
    if tags.len() > 12 {
        return Err("Puedes usar hasta 12 etiquetas.".to_string());
    }
    tags.into_iter()
        .map(|tag| validate_text(&tag, "La etiqueta", 32, true))
        .collect()
}

fn validate_input(input: VaultCredentialInput) -> Result<VaultCredentialInput, String> {
    let service_name = validate_text(&input.service_name, "El servicio", 120, true)?;
    let username = validate_text(&input.username, "El usuario", 320, true)?;
    if input.password.is_empty()
        || input.password.chars().count() > 2_048
        || input.password.chars().any(char::is_control)
    {
        return Err("La contraseña no es válida.".to_string());
    }
    let url = validate_url(&input.url)?;
    let notes = validate_text(&input.notes, "Las notas", 10_000, false)?;
    let tags = validate_tags(input.tags)?;
    Ok(VaultCredentialInput {
        service_name,
        username,
        password: input.password,
        url,
        notes,
        favorite: input.favorite,
        tags,
    })
}

fn validate_patch(patch: VaultCredentialPatch) -> Result<VaultCredentialPatch, String> {
    let password = match patch.password {
        Some(value)
            if value.is_empty()
                || value.chars().count() > 2_048
                || value.chars().any(char::is_control) =>
        {
            return Err("La contraseña no es válida.".to_string())
        }
        Some(value) => Some(value),
        None => None,
    };
    Ok(VaultCredentialPatch {
        service_name: patch
            .service_name
            .map(|value| validate_text(&value, "El servicio", 120, true))
            .transpose()?,
        username: patch
            .username
            .map(|value| validate_text(&value, "El usuario", 320, true))
            .transpose()?,
        password,
        url: patch.url.map(|value| validate_url(&value)).transpose()?,
        notes: patch
            .notes
            .map(|value| validate_text(&value, "Las notas", 10_000, false))
            .transpose()?,
        favorite: patch.favorite,
        tags: patch.tags.map(validate_tags).transpose()?,
    })
}

fn password_strength(password: &str, service: &str, username: &str) -> String {
    let lower = password.to_ascii_lowercase();
    let lower_service = service.to_ascii_lowercase();
    let lower_username = username.to_ascii_lowercase();
    let length = password.chars().count();
    let groups = [
        password
            .chars()
            .any(|character| character.is_ascii_uppercase()),
        password
            .chars()
            .any(|character| character.is_ascii_lowercase()),
        password.chars().any(|character| character.is_ascii_digit()),
        password
            .chars()
            .any(|character| !character.is_ascii_alphanumeric()),
    ]
    .into_iter()
    .filter(|value| *value)
    .count();
    let obvious = [
        "password",
        "contraseña",
        "qwerty",
        "123456",
        "letmein",
        "admin",
    ]
    .iter()
    .any(|pattern| lower.contains(pattern))
        || (!lower_service.is_empty() && lower.contains(&lower_service))
        || (!lower_username.is_empty() && lower.contains(&lower_username));
    let repeated = password
        .chars()
        .collect::<Vec<_>>()
        .windows(4)
        .any(|window| window.iter().all(|character| *character == window[0]));
    if length < 12 || groups < 2 || obvious || repeated {
        return "Débil".to_string();
    }
    let score = usize::from(length >= 16) + usize::from(length >= 24) + groups;
    if score >= 5 {
        "Muy fuerte".to_string()
    } else if score >= 4 {
        "Fuerte".to_string()
    } else {
        "Aceptable".to_string()
    }
}

fn password_age_days(changed_at: u64) -> u64 {
    now_seconds().saturating_sub(changed_at) / 86_400
}

fn reuse_counts(payload: &VaultPayload) -> HashMap<&str, usize> {
    let mut counts = HashMap::<&str, usize>::new();
    for credential in &payload.credentials {
        *counts.entry(&credential.password).or_default() += 1;
    }
    counts
}

fn security_overview(
    payload: &VaultPayload,
    reuse: &HashMap<&str, usize>,
) -> VaultSecurityOverview {
    let weak_count = payload
        .credentials
        .iter()
        .filter(|credential| {
            password_strength(
                &credential.password,
                &credential.service_name,
                &credential.username,
            ) == "Débil"
        })
        .count();
    let old_count = payload
        .credentials
        .iter()
        .filter(|credential| password_age_days(credential.password_changed_at) > 365)
        .count();
    let reused_count = reuse
        .values()
        .filter(|count| **count > 1)
        .map(|count| *count)
        .sum();
    VaultSecurityOverview {
        credential_count: payload.credentials.len(),
        reused_count,
        weak_count,
        old_count,
    }
}

fn summary(credential: &VaultCredential, reuse: &HashMap<&str, usize>) -> VaultCredentialSummary {
    VaultCredentialSummary {
        id: credential.id.clone(),
        service_name: credential.service_name.clone(),
        username: credential.username.clone(),
        url: credential.url.clone(),
        favorite: credential.favorite,
        tags: credential.tags.clone(),
        updated_at: credential.updated_at,
        password_changed_at: credential.password_changed_at,
        strength: password_strength(
            &credential.password,
            &credential.service_name,
            &credential.username,
        ),
        reused_with: reuse
            .get(credential.password.as_str())
            .copied()
            .unwrap_or_default(),
        password_age_days: password_age_days(credential.password_changed_at),
    }
}

fn detail(credential: &VaultCredential) -> VaultCredentialDetail {
    VaultCredentialDetail {
        id: credential.id.clone(),
        service_name: credential.service_name.clone(),
        username: credential.username.clone(),
        password: credential.password.clone(),
        url: credential.url.clone(),
        notes: credential.notes.clone(),
        favorite: credential.favorite,
        tags: credential.tags.clone(),
        created_at: credential.created_at,
        updated_at: credential.updated_at,
        password_changed_at: credential.password_changed_at,
    }
}

fn random_id() -> String {
    let mut bytes = [0_u8; 16];
    OsRng.fill_bytes(&mut bytes);
    let output = hex_encode(&bytes);
    bytes.zeroize();
    output
}

fn random_index(upper_bound: usize) -> Result<usize, String> {
    if upper_bound == 0 || upper_bound > 255 {
        return Err("No pude preparar el generador de contraseñas.".to_string());
    }
    let limit = 256 - (256 % upper_bound);
    loop {
        let mut byte = [0_u8; 1];
        OsRng
            .try_fill_bytes(&mut byte)
            .map_err(|_| "No pude obtener aleatoriedad segura de macOS.".to_string())?;
        if usize::from(byte[0]) < limit {
            return Ok(usize::from(byte[0]) % upper_bound);
        }
    }
}

fn pick(characters: &[u8]) -> Result<u8, String> {
    Ok(characters[random_index(characters.len())?])
}

fn generate_password(options: VaultGeneratorOptions) -> Result<String, String> {
    let length = options.length.unwrap_or(24);
    if !(12..=64).contains(&length) {
        return Err("La longitud debe estar entre 12 y 64 caracteres.".to_string());
    }
    let mut groups = Vec::<Vec<u8>>::new();
    let upper = if options.avoid_ambiguous {
        b"ABCDEFGHJKLMNPQRSTUVWXYZ".to_vec()
    } else {
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZ".to_vec()
    };
    let lower = if options.avoid_ambiguous {
        b"abcdefghijkmnopqrstuvwxyz".to_vec()
    } else {
        b"abcdefghijklmnopqrstuvwxyz".to_vec()
    };
    let numbers = if options.avoid_ambiguous {
        b"23456789".to_vec()
    } else {
        b"0123456789".to_vec()
    };
    let symbols = b"!@#$%^&*()-_=+[]{}:,.?".to_vec();
    if options.uppercase {
        groups.push(upper);
    }
    if options.lowercase {
        groups.push(lower);
    }
    if options.numbers {
        groups.push(numbers);
    }
    if options.symbols {
        groups.push(symbols);
    }
    if groups.is_empty() || groups.len() > usize::from(length) {
        return Err("Activa al menos un tipo de carácter.".to_string());
    }
    let alphabet = groups.iter().flatten().copied().collect::<Vec<_>>();
    let mut output = Vec::with_capacity(usize::from(length));
    for group in &groups {
        output.push(pick(group)?);
    }
    while output.len() < usize::from(length) {
        output.push(pick(&alphabet)?);
    }
    for index in (1..output.len()).rev() {
        let swap = random_index(index + 1)?;
        output.swap(index, swap);
    }
    String::from_utf8(output).map_err(|_| "No pude generar una contraseña segura.".to_string())
}

pub fn status(app: &AppHandle) -> Result<VaultStatus, String> {
    let exists = vault_exists(app)?;
    let locked = session_timeout(&app.state::<VaultSessionState>()).is_none();
    Ok(VaultStatus {
        exists,
        locked,
        timeout_minutes: DEFAULT_TIMEOUT_MINUTES,
        lock_on_blur: false,
    })
}

pub fn create(app: &AppHandle) -> Result<VaultStatus, String> {
    if vault_exists(app)? {
        return Err("FARO Vault ya existe. Desbloquéalo para continuar.".to_string());
    }
    authenticate_local_access()?;
    let key_path = local_key_path(app)?;
    let mut key = if key_path.try_exists().map_err(|_| "No pude comprobar la llave local.".to_string())? {
        // Retry a failed first creation with its already-persisted key.
        read_local_key(&key_path)?
    } else {
        let mut key = [0_u8; 32];
        OsRng.fill_bytes(&mut key);
        if let Err(error) = persist_local_key(&key_path, &key) {
            key.zeroize();
            return Err(error);
        }
        key
    };
    let payload = VaultPayload::default();
    let result = encrypt_payload(&key, &payload).and_then(|encrypted| {
        let data =
            serde_json::to_vec(&encrypted).map_err(|_| "No pude crear FARO Vault.".to_string())?;
        let path = vault_path(app)?;
        fs::write(&path, data).map_err(|_| "No pude crear FARO Vault.".to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }
        Ok(())
    });
    if let Err(error) = result {
        key.zeroize();
        // Keep the durable local key if payload creation failed; never delete
        // an existing key that could belong to a previous vault.
        return Err(error);
    }
    let activated = activate_session(app, &key, DEFAULT_TIMEOUT_MINUTES);
    key.zeroize();
    activated?;
    status(app)
}

pub fn unlock(app: &AppHandle) -> Result<VaultStatus, String> {
    if !vault_exists(app)? {
        return Err("Crea FARO Vault antes de desbloquearlo.".to_string());
    }
    if session_timeout(&app.state::<VaultSessionState>()).is_some() {
        return status(app);
    }
    // Builds before the native Keychain feature stored this key only in the
    // process-local mock backend. The existing file is the known empty
    // starter vault, so after macOS authenticates the owner we can preserve it
    // and generate a durable local key. Any non-empty vault remains
    // untouched and asks for recovery rather than risking its contents.
    let (mut key, migrate_local_key) = match load_key(app) {
        Ok(loaded) => loaded,
        Err(error) if error == VAULT_KEY_MISSING => return repair_empty_starter_vault(app),
        Err(error) => return Err(error),
    };
    let mut payload = match read_payload_with_key(app, &key) {
        Ok(payload) => payload,
        Err(error) => {
            key.zeroize();
            return Err(error);
        }
    };
    if migrate_local_key {
        if let Err(error) = local_key_path(app).and_then(|path| persist_local_key(&path, &key)) {
            wipe_payload(&mut payload);
            key.zeroize();
            return Err(error);
        }
    }
    let timeout = timeout_or_default(payload.auto_lock_minutes);
    // Previous builds locked whenever the FARO window lost focus. That made a
    // normal context switch look like a new Vault login and repeatedly sent
    // users back through Keychain. Keep the explicit and timeout locks, but
    // turn this legacy default off as soon as the Vault is safely opened.
    let migrate_focus_lock = payload.lock_on_blur;
    if migrate_focus_lock {
        payload.lock_on_blur = false;
    }
    let lock_on_blur = payload.lock_on_blur;
    if migrate_focus_lock {
        if let Err(error) = write_payload_with_key(app, &key, &payload) {
            wipe_payload(&mut payload);
            key.zeroize();
            return Err(error);
        }
    }
    wipe_payload(&mut payload);
    let activated = activate_session(app, &key, timeout);
    key.zeroize();
    activated?;
    Ok(VaultStatus {
        exists: true,
        locked: false,
        timeout_minutes: timeout,
        lock_on_blur,
    })
}

pub fn lock(app: &AppHandle) -> Result<VaultStatus, String> {
    let active_lease = app
        .state::<VaultSessionState>()
        .clipboard
        .lock()
        .ok()
        .and_then(|current| current.clone());
    if let Some(lease) = active_lease {
        clear_clipboard_if_current(app, &lease);
    }
    lock_session(app);
    status(app)
}

pub fn list(app: &AppHandle, query: Option<String>) -> Result<VaultListResponse, String> {
    let timeout = vault_session_timeout(app)?;
    let mut payload = read_payload(app)?;
    let query = query.unwrap_or_default().trim().to_ascii_lowercase();
    if query.chars().count() > 320 {
        wipe_payload(&mut payload);
        return Err("La búsqueda no es válida.".to_string());
    }
    let reuse = reuse_counts(&payload);
    let security = security_overview(&payload, &reuse);
    let lock_on_blur = payload.lock_on_blur;
    let mut credentials = payload
        .credentials
        .iter()
        .filter(|credential| {
            query.is_empty()
                || credential
                    .service_name
                    .to_ascii_lowercase()
                    .contains(&query)
                || credential.username.to_ascii_lowercase().contains(&query)
                || credential.url.to_ascii_lowercase().contains(&query)
        })
        .map(|credential| summary(credential, &reuse))
        .collect::<Vec<_>>();
    credentials.sort_by(|left, right| {
        right.favorite.cmp(&left.favorite).then_with(|| {
            left.service_name
                .to_ascii_lowercase()
                .cmp(&right.service_name.to_ascii_lowercase())
        })
    });
    wipe_payload(&mut payload);
    Ok(VaultListResponse {
        credentials,
        security,
        timeout_minutes: timeout,
        lock_on_blur,
    })
}

pub fn get(app: &AppHandle, id: String) -> Result<VaultCredentialDetail, String> {
    vault_session_timeout(app)?;
    let mut payload = read_payload(app)?;
    let result = payload
        .credentials
        .iter()
        .find(|credential| credential.id == id)
        .map(detail)
        .ok_or_else(|| "No encontré esa credencial dentro de FARO Vault.".to_string());
    wipe_payload(&mut payload);
    result
}

pub fn create_credential(
    app: &AppHandle,
    input: VaultCredentialInput,
) -> Result<VaultCredentialSummary, String> {
    vault_session_timeout(app)?;
    let input = validate_input(input)?;
    let mut payload = read_payload(app)?;
    if payload.credentials.len() >= MAX_CREDENTIALS {
        wipe_payload(&mut payload);
        return Err("FARO Vault alcanzó su límite seguro de credenciales.".to_string());
    }
    let now = now_seconds();
    let credential = VaultCredential {
        id: random_id(),
        service_name: input.service_name,
        username: input.username,
        password: input.password,
        url: input.url,
        notes: input.notes,
        favorite: input.favorite,
        tags: input.tags,
        created_at: now,
        updated_at: now,
        password_changed_at: now,
    };
    payload.credentials.push(credential);
    let reuse = reuse_counts(&payload);
    let response = summary(
        payload.credentials.last().expect("credential inserted"),
        &reuse,
    );
    let write = write_payload(app, &payload);
    wipe_payload(&mut payload);
    write.map(|_| response)
}

pub fn update_credential(
    app: &AppHandle,
    id: String,
    patch: VaultCredentialPatch,
) -> Result<VaultCredentialSummary, String> {
    vault_session_timeout(app)?;
    let patch = validate_patch(patch)?;
    let mut payload = read_payload(app)?;
    let result = (|| {
        let credential = payload
            .credentials
            .iter_mut()
            .find(|credential| credential.id == id)
            .ok_or_else(|| "No encontré esa credencial dentro de FARO Vault.".to_string())?;
        if let Some(value) = patch.service_name {
            credential.service_name = value;
        }
        if let Some(value) = patch.username {
            credential.username = value;
        }
        if let Some(value) = patch.url {
            credential.url = value;
        }
        if let Some(value) = patch.notes {
            credential.notes = value;
        }
        if let Some(value) = patch.favorite {
            credential.favorite = value;
        }
        if let Some(value) = patch.tags {
            credential.tags = value;
        }
        if let Some(value) = patch.password {
            credential.password = value;
            credential.password_changed_at = now_seconds();
        }
        credential.updated_at = now_seconds();
        let reuse = reuse_counts(&payload);
        let response = payload
            .credentials
            .iter()
            .find(|item| item.id == id)
            .map(|item| summary(item, &reuse))
            .ok_or_else(|| "No encontré esa credencial dentro de FARO Vault.".to_string())?;
        write_payload(app, &payload)?;
        Ok(response)
    })();
    wipe_payload(&mut payload);
    result
}

pub fn delete_credential(app: &AppHandle, id: String, confirmation: String) -> Result<(), String> {
    vault_session_timeout(app)?;
    if confirmation.trim() != "ELIMINAR" {
        return Err("Confirma la eliminación para continuar.".to_string());
    }
    let mut payload = read_payload(app)?;
    let before = payload.credentials.len();
    payload.credentials.retain(|credential| credential.id != id);
    if payload.credentials.len() == before {
        wipe_payload(&mut payload);
        return Err("No encontré esa credencial dentro de FARO Vault.".to_string());
    }
    let write = write_payload(app, &payload);
    wipe_payload(&mut payload);
    write
}

pub fn generated_password(
    app: &AppHandle,
    options: VaultGeneratorOptions,
) -> Result<VaultGeneratedPassword, String> {
    vault_session_timeout(app)?;
    let password = generate_password(options)?;
    let strength = password_strength(&password, "", "");
    let length = password.chars().count() as u8;
    Ok(VaultGeneratedPassword {
        password,
        length,
        strength,
    })
}

pub fn update_settings(app: &AppHandle, patch: VaultSettingsPatch) -> Result<VaultStatus, String> {
    vault_session_timeout(app)?;
    if patch.auto_lock_minutes.is_none() && patch.lock_on_blur.is_none() {
        return Err("Indica al menos un ajuste de seguridad para FARO Vault.".to_string());
    }
    if patch
        .auto_lock_minutes
        .is_some_and(|minutes| !valid_timeout(minutes))
    {
        return Err("El bloqueo automático debe ser de 1, 5, 15 o 30 minutos.".to_string());
    }
    let mut payload = read_payload(app)?;
    if let Some(minutes) = patch.auto_lock_minutes {
        payload.auto_lock_minutes = minutes;
    }
    if let Some(lock_on_blur) = patch.lock_on_blur {
        payload.lock_on_blur = lock_on_blur;
    }
    let auto_lock_minutes = payload.auto_lock_minutes;
    let lock_on_blur = payload.lock_on_blur;
    let write = write_payload(app, &payload);
    wipe_payload(&mut payload);
    write?;
    let state = app.state::<VaultSessionState>();
    let mut session = state
        .session
        .lock()
        .map_err(|_| "No pude actualizar la sesión de FARO Vault.".to_string())?;
    let Some(session) = session.as_mut() else {
        return Err("FARO Vault está bloqueado. Desbloquéalo con macOS para continuar.".to_string());
    };
    session.timeout_minutes = auto_lock_minutes;
    session.expires_at = Instant::now() + Duration::from_secs(u64::from(auto_lock_minutes) * 60);
    Ok(VaultStatus {
        exists: true,
        locked: false,
        timeout_minutes: auto_lock_minutes,
        lock_on_blur,
    })
}

fn copy_field(
    app: &AppHandle,
    id: String,
    password: bool,
) -> Result<VaultClipboardResponse, String> {
    vault_session_timeout(app)?;
    let mut payload = read_payload(app)?;
    let mut value = payload
        .credentials
        .iter()
        .find(|credential| credential.id == id)
        .map(|credential| {
            if password {
                credential.password.clone()
            } else {
                credential.username.clone()
            }
        })
        .ok_or_else(|| "No encontré esa credencial dentro de FARO Vault.".to_string())?;
    let state = app.state::<VaultSessionState>();
    let lease = ClipboardLease {
        id: state.clipboard_sequence.fetch_add(1, Ordering::SeqCst) + 1,
        fingerprint: fingerprint(state.inner(), &value),
    };
    let result = write_clipboard(&value);
    value.zeroize();
    wipe_payload(&mut payload);
    result?;
    if let Ok(mut current) = state.clipboard.lock() {
        *current = Some(lease.clone());
    }
    let app_for_clear = app.clone();
    thread::spawn(move || {
        thread::sleep(CLIPBOARD_CLEAR_AFTER);
        clear_clipboard_if_current(&app_for_clear, &lease);
    });
    Ok(VaultClipboardResponse {
        message: if password {
            "Contraseña copiada. FARO limpiará el portapapeles en 90 segundos si no cambiaste su contenido.".to_string()
        } else {
            "Usuario copiado. FARO limpiará el portapapeles en 90 segundos si no cambiaste su contenido.".to_string()
        },
    })
}

pub fn copy_username(app: &AppHandle, id: String) -> Result<VaultClipboardResponse, String> {
    copy_field(app, id, false)
}
pub fn copy_password(app: &AppHandle, id: String) -> Result<VaultClipboardResponse, String> {
    copy_field(app, id, true)
}

pub fn open_url(app: &AppHandle, id: String) -> Result<(), String> {
    vault_session_timeout(app)?;
    let mut payload = read_payload(app)?;
    let url = payload
        .credentials
        .iter()
        .find(|credential| credential.id == id)
        .map(|credential| credential.url.clone())
        .ok_or_else(|| "No encontré esa credencial dentro de FARO Vault.".to_string())?;
    wipe_payload(&mut payload);
    if url.is_empty() {
        return Err("Esta credencial no tiene una URL configurada.".to_string());
    }
    validate_url(&url)?;
    Command::new("/usr/bin/open")
        .arg(url)
        .spawn()
        .map_err(|_| "No pude abrir el sitio en tu navegador.".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn vault_status_command(app: AppHandle) -> Result<VaultStatus, String> {
    status(&app)
}

static VAULT_AUTHENTICATION: Mutex<()> = Mutex::new(());

#[tauri::command]
pub async fn vault_create_command(app: AppHandle) -> Result<VaultStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = VAULT_AUTHENTICATION.try_lock().map_err(|_| "Ya hay una solicitud de huella abierta.".to_string())?;
        create(&app)
    })
        .await
        .map_err(|error| format!("No pude iniciar FARO Vault: {error}"))?
}

#[tauri::command]
pub async fn vault_unlock_command(app: AppHandle) -> Result<VaultStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = VAULT_AUTHENTICATION.try_lock().map_err(|_| "Ya hay una solicitud de huella abierta.".to_string())?;
        unlock(&app)
    })
        .await
        .map_err(|error| format!("No pude abrir FARO Vault: {error}"))?
}

#[tauri::command]
pub fn vault_lock_command(app: AppHandle) -> Result<VaultStatus, String> {
    lock(&app)
}

#[tauri::command]
pub fn vault_list_command(
    app: AppHandle,
    query: Option<String>,
) -> Result<VaultListResponse, String> {
    list(&app, query)
}

#[tauri::command]
pub fn vault_get_command(app: AppHandle, id: String) -> Result<VaultCredentialDetail, String> {
    get(&app, id)
}

#[tauri::command]
pub fn vault_create_credential_command(
    app: AppHandle,
    input: VaultCredentialInput,
) -> Result<VaultCredentialSummary, String> {
    create_credential(&app, input)
}

#[tauri::command]
pub fn vault_update_credential_command(
    app: AppHandle,
    id: String,
    patch: VaultCredentialPatch,
) -> Result<VaultCredentialSummary, String> {
    update_credential(&app, id, patch)
}

#[tauri::command]
pub fn vault_delete_credential_command(
    app: AppHandle,
    id: String,
    confirmation: String,
) -> Result<(), String> {
    delete_credential(&app, id, confirmation)
}

#[tauri::command]
pub fn vault_generate_password_command(
    app: AppHandle,
    options: VaultGeneratorOptions,
) -> Result<VaultGeneratedPassword, String> {
    generated_password(&app, options)
}

#[tauri::command]
pub fn vault_update_settings_command(
    app: AppHandle,
    patch: VaultSettingsPatch,
) -> Result<VaultStatus, String> {
    update_settings(&app, patch)
}

#[tauri::command]
pub fn vault_copy_username_command(
    app: AppHandle,
    id: String,
) -> Result<VaultClipboardResponse, String> {
    copy_username(&app, id)
}

#[tauri::command]
pub fn vault_copy_password_command(
    app: AppHandle,
    id: String,
) -> Result<VaultClipboardResponse, String> {
    copy_password(&app, id)
}

#[tauri::command]
pub fn vault_open_url_command(app: AppHandle, id: String) -> Result<(), String> {
    open_url(&app, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_round_trip_uses_authenticated_encryption() {
        let key = [7_u8; 32];
        let payload = VaultPayload {
            credentials: vec![VaultCredential {
                id: "a".to_string(),
                service_name: "Service".to_string(),
                username: "user".to_string(),
                password: "never-plaintext".to_string(),
                url: String::new(),
                notes: String::new(),
                favorite: false,
                tags: vec![],
                created_at: 1,
                updated_at: 1,
                password_changed_at: 1,
            }],
            ..VaultPayload::default()
        };
        let stored = encrypt_payload(&key, &payload).expect("encrypt");
        let serialized = serde_json::to_string(&stored).expect("serialize");
        assert!(!serialized.contains("never-plaintext"));
        let opened = decrypt_payload(&key, &stored).expect("decrypt");
        assert_eq!(opened.credentials[0].password, "never-plaintext");
    }

    #[test]
    fn corrupted_ciphertext_is_rejected() {
        let key = [8_u8; 32];
        let payload = VaultPayload::default();
        let mut stored = encrypt_payload(&key, &payload).expect("encrypt");
        stored.ciphertext[0] ^= 1;
        assert!(decrypt_payload(&key, &stored).is_err());
    }

    #[test]
    fn nonces_are_unique_for_two_records() {
        let key = [9_u8; 32];
        let first = encrypt_payload(&key, &VaultPayload::default()).expect("first");
        let second = encrypt_payload(&key, &VaultPayload::default()).expect("second");
        assert_ne!(first.nonce, second.nonce);
    }

    #[test]
    fn only_the_empty_starter_payload_has_the_recovery_size() {
        let key = [10_u8; 32];
        let empty = encrypt_payload(&key, &VaultPayload::default()).expect("empty");
        assert_eq!(empty.ciphertext.len(), EMPTY_VAULT_CIPHERTEXT_BYTES);
        let populated = encrypt_payload(
            &key,
            &VaultPayload {
                credentials: vec![VaultCredential {
                    id: "a".repeat(32),
                    service_name: "S".to_string(),
                    username: "U".to_string(),
                    password: "P".to_string(),
                    url: String::new(),
                    notes: String::new(),
                    favorite: false,
                    tags: vec![],
                    created_at: 1,
                    updated_at: 1,
                    password_changed_at: 1,
                }],
                ..VaultPayload::default()
            },
        )
        .expect("populated");
        assert!(populated.ciphertext.len() > EMPTY_VAULT_CIPHERTEXT_BYTES);
    }

    #[test]
    fn generator_enforces_every_enabled_character_group() {
        let password = generate_password(VaultGeneratorOptions {
            length: Some(24),
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true,
            avoid_ambiguous: true,
        })
        .expect("password");
        assert!(password
            .chars()
            .any(|character| character.is_ascii_uppercase()));
        assert!(password
            .chars()
            .any(|character| character.is_ascii_lowercase()));
        assert!(password.chars().any(|character| character.is_ascii_digit()));
        assert!(password
            .chars()
            .any(|character| !character.is_ascii_alphanumeric()));
        assert_eq!(password.len(), 24);
    }

    #[test]
    fn strength_flags_obvious_and_reused_baselines() {
        assert_eq!(password_strength("password123", "GitHub", "me"), "Débil");
        assert_eq!(
            password_strength("y7!Q-3aN@w_59Pk#X2mC", "GitHub", "me"),
            "Muy fuerte"
        );
    }
}


#[cfg(test)]
mod local_access_tests {
    use super::*;
    fn fixture_path() -> PathBuf {
        std::env::temp_dir().join(format!("faro-vault-key-test-{}", random_id()))
    }
    #[test]
    fn local_key_survives_reload_without_changing_encrypted_credentials() {
        let path = fixture_path();
        let mut key = [0_u8; 32];
        OsRng.fill_bytes(&mut key);
        let payload = VaultPayload {
            credentials: vec![VaultCredential {
                id: "fixture".into(), service_name: "Fixture".into(), username: "fixture@example.test".into(),
                password: "synthetic-test-only".into(), url: String::new(), notes: String::new(), favorite: false,
                tags: vec![], created_at: 1, updated_at: 1, password_changed_at: 1,
            }],
            ..VaultPayload::default()
        };
        let encrypted = encrypt_payload(&key, &payload).unwrap();
        let original = serde_json::to_vec(&encrypted).unwrap();
        persist_local_key(&path, &key).unwrap();
        let mut reloaded = read_local_key(&path).unwrap();
        let mut reopened = decrypt_payload(&reloaded, &encrypted).unwrap();
        assert_eq!(reopened.credentials.len(), 1);
        assert!(reopened.credentials[0].password == "synthetic-test-only");
        wipe_payload(&mut reopened);
        assert_eq!(serde_json::to_vec(&encrypted).unwrap(), original);
        assert!(persist_local_key(&path, &key).is_ok());
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        key.zeroize(); reloaded.zeroize(); fs::remove_file(path).unwrap();
    }
    #[test]
    fn refuses_to_replace_an_existing_key_or_accept_a_truncated_key() {
        let path = fixture_path();
        persist_local_key(&path, &[1; 32]).unwrap();
        assert!(persist_local_key(&path, &[2; 32]).is_err());
        assert!(read_local_key(&path).unwrap() == [1; 32]);
        fs::write(&path, [1; 4]).unwrap();
        assert!(read_local_key(&path).is_err());
        assert!(persist_local_key(&path, &[2; 32]).is_err());
        fs::remove_file(path).unwrap();
    }
}
