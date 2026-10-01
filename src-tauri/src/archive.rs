//! FARO Archive V1 keeps its lifecycle ledger locally.  It deliberately does
//! not mirror this information to Supabase: file paths, hashes and storage
//! decisions stay on this Mac unless a user explicitly sends a file to the
//! configured archive provider.

use std::{
    collections::{hash_map::DefaultHasher, BTreeMap, BTreeSet, HashMap},
    env, fs,
    hash::{Hash, Hasher},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::storage;

const ARCHIVE_STATE_FILE: &str = "faro-archive-v1.json";
const GOOGLE_DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const DEFAULT_GRACE_DAYS: u64 = 3;
const MAX_EVENTS: usize = 500;
const MAX_TRASH_ITEMS: usize = 2_000;
const MAX_PURGE_ITEMS: usize = 50;
const GOOGLE_TOKEN_SERVICE: &str = "com.faroos.desktop.archive.google-drive";
const GOOGLE_TOKEN_ACCOUNT: &str = "oauth-tokens-v1";
const GOOGLE_CLIENT_SECRET_ACCOUNT: &str = "oauth-client-secret-v1";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(300);
const DRIVE_API: &str = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3";
const UPLOAD_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const MAX_ARCHIVE_BATCH_ITEMS: usize = 100;
// Folder uploads are intentionally bounded. A hard cap prevents an accidental
// selection of a mounted volume or a dependency cache from making FARO appear
// stuck for hours while still allowing substantial workspaces to be archived.
const MAX_ARCHIVE_FOLDER_FILES: usize = 50_000;
const MAX_ARCHIVE_FOLDER_DIRECTORIES: usize = 12_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleDriveConfig {
    client_id: String,
    #[serde(default)]
    client_secret_configured: bool,
    #[serde(default)]
    redirect_uri: String,
    #[serde(default)]
    account_email: Option<String>,
    #[serde(default)]
    root_folder_id: Option<String>,
    root_folder_name: String,
    #[serde(default)]
    folder_ids: BTreeMap<String, String>,
    #[serde(default)]
    quota_limit_bytes: Option<u64>,
    #[serde(default)]
    quota_used_bytes: Option<u64>,
    #[serde(default)]
    last_verified_at: Option<u64>,
    #[serde(default)]
    last_connection_error: Option<String>,
}

impl Default for GoogleDriveConfig {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            client_secret_configured: false,
            redirect_uri: String::new(),
            account_email: None,
            root_folder_id: None,
            root_folder_name: "FARO Archive".to_string(),
            folder_ids: BTreeMap::new(),
            quota_limit_bytes: None,
            quota_used_bytes: None,
            last_verified_at: None,
            last_connection_error: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveSettings {
    trash_grace_days: u64,
    monthly_review_enabled: bool,
    auto_purge: bool,
    google_drive: GoogleDriveConfig,
}

impl Default for ArchiveSettings {
    fn default() -> Self {
        Self {
            trash_grace_days: DEFAULT_GRACE_DAYS,
            monthly_review_enabled: true,
            // This is intentionally non-configurable in V1. FARO only ever
            // proposes a purge and always waits for explicit confirmation.
            auto_purge: false,
            google_drive: GoogleDriveConfig::default(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveItem {
    id: String,
    name: String,
    source_path: String,
    bytes: u64,
    provider: String,
    provider_file_id: Option<String>,
    sha256: Option<String>,
    status: String,
    #[serde(default)]
    remote_name: Option<String>,
    #[serde(default)]
    remote_checksum: Option<String>,
    #[serde(default)]
    remote_folder_id: Option<String>,
    #[serde(default)]
    remote_path: Option<String>,
    #[serde(default)]
    operation: String,
    #[serde(default)]
    verified_at: Option<u64>,
    #[serde(default)]
    restored_at: Option<u64>,
    #[serde(default)]
    is_directory: bool,
    created_at: u64,
    updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FaroTrashItem {
    id: String,
    name: String,
    source_path: String,
    trash_path: String,
    bytes: u64,
    reason: String,
    action: String,
    archive_item_id: Option<String>,
    moved_at: u64,
    grace_ends_at: u64,
    status: String,
    purged_at: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveEvent {
    id: String,
    created_at: u64,
    kind: String,
    message: String,
    item_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveState {
    version: u8,
    settings: ArchiveSettings,
    archive_items: Vec<ArchiveItem>,
    trash_items: Vec<FaroTrashItem>,
    events: Vec<ArchiveEvent>,
    #[serde(default)]
    last_monthly_review_month: Option<String>,
    #[serde(default)]
    monthly_review_acknowledged_month: Option<String>,
}

impl Default for ArchiveState {
    fn default() -> Self {
        Self {
            version: 1,
            settings: ArchiveSettings::default(),
            archive_items: Vec::new(),
            trash_items: Vec::new(),
            events: Vec::new(),
            last_monthly_review_month: None,
            monthly_review_acknowledged_month: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOverview {
    pub provider: ArchiveProviderOverview,
    pub archive: ArchiveMetricOverview,
    pub trash: FaroTrashOverview,
    pub policy: ArchivePolicyOverview,
    pub recent_events: Vec<ArchiveEventOverview>,
    pub recent_items: Vec<ArchiveItemOverview>,
    /// Verifiable remote copies registered by this Mac. The drive.file scope
    /// deliberately only covers files created or managed by FARO.
    pub remote_items: Vec<ArchiveItemOverview>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveProviderOverview {
    pub provider: String,
    pub configured: bool,
    // An OAuth client ID identifies the installed application; it is not an
    // OAuth token or a secret. Returning it lets the local configuration form
    // be edited without forcing the owner to locate and paste it again.
    pub client_id: String,
    pub client_secret_configured: bool,
    pub connected: bool,
    pub account_email: Option<String>,
    pub root_folder_name: String,
    pub root_folder_id: Option<String>,
    pub scope: String,
    pub status_message: String,
    pub oauth_in_progress: bool,
    pub quota_limit_bytes: Option<u64>,
    pub quota_used_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveMetricOverview {
    pub item_count: usize,
    pub backup_count: usize,
    pub archived_count: usize,
    pub bytes_backed_up: u64,
    pub bytes_archived: u64,
    pub local_bytes_freed_by_faro: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaroTrashOverview {
    pub tracked_count: usize,
    pub tracked_bytes: u64,
    pub eligible_count: usize,
    pub eligible_bytes: u64,
    pub grace_days: u64,
    pub monthly_review_due: bool,
    pub items: Vec<FaroTrashItemOverview>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaroTrashItemOverview {
    pub id: String,
    pub name: String,
    pub source_path: String,
    pub bytes: u64,
    pub reason: String,
    pub action: String,
    pub moved_at: u64,
    pub grace_ends_at: u64,
    pub status: String,
    pub eligible_for_purge: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePolicyOverview {
    pub protected_paths_only: bool,
    pub sensitive_files_blocked: bool,
    pub auto_purge_enabled: bool,
    pub monthly_review_enabled: bool,
    pub rules: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEventOverview {
    pub id: String,
    pub created_at: u64,
    pub kind: String,
    pub message: String,
    pub item_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveItemOverview {
    pub id: String,
    pub name: String,
    pub source_path: String,
    pub remote_path: Option<String>,
    pub bytes: u64,
    pub operation: String,
    pub status: String,
    pub verified_at: Option<u64>,
    pub restored_at: Option<u64>,
    pub restorable: bool,
    pub is_directory: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSettingsPatch {
    pub trash_grace_days: Option<u64>,
    pub monthly_review_enabled: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveConfigurationInput {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default)]
    pub redirect_uri: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOauthStartResult {
    pub started: bool,
    pub redirect_uri: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveProcessInput {
    pub candidate_id: String,
    pub operation: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveBatchProcessInput {
    pub candidate_ids: Vec<String>,
    pub operation: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveProcessResult {
    pub item_id: String,
    pub operation: String,
    pub status: String,
    pub bytes: u64,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveBatchProcessResult {
    pub operation: String,
    pub succeeded: Vec<ArchiveProcessResult>,
    pub failed: Vec<String>,
    pub bytes_processed: u64,
}

#[derive(Default)]
pub struct ArchiveOauthState {
    active: Mutex<bool>,
}

/// Keychain is the durable source of truth, but asking it for a password on
/// every React refresh turns one archive action into several macOS prompts.
/// FARO keeps the values it has already obtained only for this process. They
/// are never serialized outside Keychain and disappear when FARO quits.
#[derive(Default)]
struct GoogleCredentialCache {
    tokens: Option<Option<StoredGoogleTokens>>,
    client_secret: Option<Option<String>>,
}

static GOOGLE_CREDENTIAL_CACHE: OnceLock<Mutex<GoogleCredentialCache>> = OnceLock::new();

fn google_credential_cache() -> &'static Mutex<GoogleCredentialCache> {
    GOOGLE_CREDENTIAL_CACHE.get_or_init(|| Mutex::new(GoogleCredentialCache::default()))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredGoogleTokens {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePurgeResult {
    pub purged_count: usize,
    pub reclaimed_bytes: u64,
    pub failed: Vec<String>,
}

// The provider boundary is intentionally local and narrow. Google Drive is
// the V1 adapter; S3, HomeCore or a NAS can implement the same contract later
// without leaking archive decisions into the rest of FARO.
#[allow(dead_code)]
trait ArchiveProvider {
    fn name(&self) -> &'static str;
    fn scope(&self) -> &'static str;
    fn is_configured(&self) -> bool;
    fn ensure_ready(&self) -> Result<(), String>;
    fn upload(&self, _path: &Path, _parent_id: &str) -> Result<VerifiedRemoteFile, String>;
    fn verify(&self, _remote: &VerifiedRemoteFile, _expected_bytes: u64) -> Result<(), String>;
}

#[allow(dead_code)]
struct VerifiedRemoteFile {
    id: String,
    name: String,
    bytes: u64,
    sha256: Option<String>,
}

struct GoogleDriveArchiveProvider<'a> {
    config: &'a GoogleDriveConfig,
}

impl ArchiveProvider for GoogleDriveArchiveProvider<'_> {
    fn name(&self) -> &'static str {
        "google-drive"
    }
    fn scope(&self) -> &'static str {
        GOOGLE_DRIVE_SCOPE
    }
    fn is_configured(&self) -> bool {
        !self.config.client_id.is_empty()
    }
    fn ensure_ready(&self) -> Result<(), String> {
        if !self.is_configured() {
            return Err("Configura tu Client ID de Google antes de conectar Drive.".to_string());
        }
        if self.config.account_email.is_none() || self.config.root_folder_id.is_none() {
            return Err("Google Drive aún no está conectado. FARO solicitará únicamente el permiso drive.file durante la conexión.".to_string());
        }
        Ok(())
    }
    fn upload(&self, _path: &Path, _parent_id: &str) -> Result<VerifiedRemoteFile, String> {
        self.ensure_ready()?;
        Err("La carga de Drive se habilita al terminar el enlace OAuth de esta cuenta.".to_string())
    }
    fn verify(&self, _remote: &VerifiedRemoteFile, _expected_bytes: u64) -> Result<(), String> {
        self.ensure_ready()?;
        Err(
            "La verificación remota se habilita al terminar el enlace OAuth de esta cuenta."
                .to_string(),
        )
    }
}

fn user_home() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| "No fue posible resolver tu carpeta de usuario.".to_string())
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    Ok(dir.join(ARCHIVE_STATE_FILE))
}

fn read_state(app: &AppHandle) -> Result<ArchiveState, String> {
    let path = state_path(app)?;
    match fs::read(&path) {
        Ok(bytes) => {
            let state: ArchiveState = serde_json::from_slice(&bytes)
                .map_err(|_| "El historial local de FARO Archive no se pudo leer. No se modificó nada; restaura el archivo antes de continuar.".to_string())?;
            if state.version != 1 {
                return Err(
                    "La versión del historial de FARO Archive no es compatible.".to_string()
                );
            }
            Ok(state)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ArchiveState::default()),
        Err(error) => Err(format!(
            "No pude abrir el historial local de FARO Archive: {error}"
        )),
    }
}

fn write_state(app: &AppHandle, state: &ArchiveState) -> Result<(), String> {
    let path = state_path(app)?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("No pude guardar el historial de FARO Archive: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("No pude finalizar el historial de FARO Archive: {error}"))
}

fn stable_id(prefix: &str, fields: &[&str]) -> String {
    let mut hasher = DefaultHasher::new();
    now_seconds().hash(&mut hasher);
    for field in fields {
        field.hash(&mut hasher);
    }
    format!("{prefix}-{:016x}", hasher.finish())
}

fn add_event(state: &mut ArchiveState, kind: &str, message: String, item_id: Option<String>) {
    let event = ArchiveEvent {
        id: stable_id("event", &[kind, &message]),
        created_at: now_seconds(),
        kind: kind.to_string(),
        message,
        item_id,
    };
    state.events.push(event);
    if state.events.len() > MAX_EVENTS {
        let overflow = state.events.len() - MAX_EVENTS;
        state.events.drain(0..overflow);
    }
}

fn current_month() -> String {
    std::process::Command::new("/bin/date")
        .arg("+%Y-%m")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| value.len() == 7)
        .unwrap_or_else(|| "desconocido".to_string())
}

fn update_monthly_review(state: &mut ArchiveState) -> bool {
    if !state.settings.monthly_review_enabled {
        return false;
    }
    let month = current_month();
    if state.last_monthly_review_month.as_deref() == Some(month.as_str()) {
        return false;
    }
    state.last_monthly_review_month = Some(month.clone());
    add_event(
        state,
        "monthly_review",
        format!("Cierre mensual de Papelera FARO disponible ({month})."),
        None,
    );
    true
}

fn monthly_review_is_due(state: &ArchiveState) -> bool {
    state.settings.monthly_review_enabled
        && state.last_monthly_review_month.as_deref() == Some(current_month().as_str())
        && state.monthly_review_acknowledged_month != state.last_monthly_review_month
}

fn is_sensitive_name(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    lowered == ".env"
        || lowered.starts_with(".env.")
        || lowered.starts_with("id_rsa")
        || lowered.contains("service_role")
        || lowered.contains("google_client_secret")
        || lowered.contains("oauth") && lowered.contains("secret")
        || [".pem", ".key", ".p12", ".pfx", ".mobileprovision", ".kdbx"]
            .iter()
            .any(|extension| lowered.ends_with(extension))
}

/// Sensitive credentials are a hard block in FARO Archive. There is no UI
/// override because an accidental remote copy is worse than a skipped file.
pub fn is_sensitive_path(path: &Path) -> bool {
    let value = path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    let protected_fragments = [
        "/.ssh/",
        "/.aws/",
        "/.gnupg/",
        "/library/keychains/",
        "/library/mobile documents/",
        "/library/cloudstorage/",
        "/application support/google/",
        "/faro-vault-v1.enc",
        "/application support/com.faroos.desktop/",
    ];
    protected_fragments
        .iter()
        .any(|fragment| value.contains(fragment))
        // Callers can validate a folder itself, not only a file nested below
        // it. Keep the root folders protected in that case as well.
        || value.ends_with("/application support/google")
        || value.ends_with("/application support/com.faroos.desktop")
        || path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(is_sensitive_name)
}

fn validate_google_config(input: &GoogleDriveConfigurationInput) -> Result<(), String> {
    let client_id = input.client_id.trim();
    if client_id.len() < 12 || client_id.len() > 300 || client_id.chars().any(char::is_control) {
        return Err("El Client ID de Google no tiene un formato válido.".to_string());
    }
    let redirect_uri = input.redirect_uri.trim();
    if !redirect_uri.is_empty()
        && (!redirect_uri.starts_with("http://127.0.0.1:")
            || redirect_uri.len() > 500
            || redirect_uri.chars().any(char::is_control))
    {
        return Err(
            "El redirect URI, si se conserva, debe ser un callback loopback 127.0.0.1.".to_string(),
        );
    }
    Ok(())
}

fn keychain_entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(GOOGLE_TOKEN_SERVICE, account).map_err(|error| error.to_string())
}

fn read_google_tokens() -> Result<Option<StoredGoogleTokens>, String> {
    if let Ok(cache) = google_credential_cache().lock() {
        if let Some(tokens) = cache.tokens.as_ref() {
            return Ok(tokens.clone());
        }
    }
    let tokens = match keychain_entry(GOOGLE_TOKEN_ACCOUNT)?.get_password() {
        Ok(value) => serde_json::from_str(&value).map(Some).map_err(|_| {
            "No pude leer las credenciales de Google guardadas en el llavero de macOS.".to_string()
        }),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "No pude abrir el llavero de macOS para Google Drive: {error}"
        )),
    }?;
    if let Ok(mut cache) = google_credential_cache().lock() {
        cache.tokens = Some(tokens.clone());
    }
    Ok(tokens)
}

fn write_google_tokens(tokens: &StoredGoogleTokens) -> Result<(), String> {
    let value = serde_json::to_string(tokens).map_err(|error| error.to_string())?;
    keychain_entry(GOOGLE_TOKEN_ACCOUNT)?
        .set_password(&value)
        .map_err(|_| "No pude guardar la sesión de Google en el llavero de macOS.".to_string())?;
    if let Ok(mut cache) = google_credential_cache().lock() {
        cache.tokens = Some(Some(tokens.clone()));
    }
    Ok(())
}

// Desktop clients cannot keep a client secret secret from a determined local
// user, but Google still issues one for many Desktop OAuth clients and may
// require it at the token endpoint. FARO accepts it only at configuration
// time, keeps it in macOS Keychain, and never serializes or returns it.
fn read_google_client_secret() -> Result<Option<String>, String> {
    if let Ok(cache) = google_credential_cache().lock() {
        if let Some(secret) = cache.client_secret.as_ref() {
            return Ok(secret.clone());
        }
    }
    let secret = match keychain_entry(GOOGLE_CLIENT_SECRET_ACCOUNT)?.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "No pude abrir el llavero de macOS para la configuración de Google Drive: {error}"
        )),
    }?;
    if let Ok(mut cache) = google_credential_cache().lock() {
        cache.client_secret = Some(secret.clone());
    }
    Ok(secret)
}

fn write_google_client_secret(secret: &str) -> Result<(), String> {
    keychain_entry(GOOGLE_CLIENT_SECRET_ACCOUNT)?
        .set_password(secret.trim())
        .map_err(|_| {
            "No pude guardar la configuración de Google en el llavero de macOS.".to_string()
        })?;
    if let Ok(mut cache) = google_credential_cache().lock() {
        cache.client_secret = Some(Some(secret.trim().to_string()));
    }
    Ok(())
}

fn clear_google_client_secret() -> Result<(), String> {
    match keychain_entry(GOOGLE_CLIENT_SECRET_ACCOUNT)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(
            "No pude retirar la configuración anterior de Google del llavero de macOS.".to_string(),
        ),
    }?;
    if let Ok(mut cache) = google_credential_cache().lock() {
        cache.client_secret = Some(None);
    }
    Ok(())
}

fn clear_google_tokens() -> Result<(), String> {
    match keychain_entry(GOOGLE_TOKEN_ACCOUNT)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => {
            Err("No pude retirar la sesión anterior de Google del llavero de macOS.".to_string())
        }
    }?;
    if let Ok(mut cache) = google_credential_cache().lock() {
        cache.tokens = Some(None);
    }
    Ok(())
}

fn base64_url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::new();
    let mut index = 0;
    while index + 3 <= bytes.len() {
        let value = (u32::from(bytes[index]) << 16)
            | (u32::from(bytes[index + 1]) << 8)
            | u32::from(bytes[index + 2]);
        output.push(ALPHABET[((value >> 18) & 63) as usize] as char);
        output.push(ALPHABET[((value >> 12) & 63) as usize] as char);
        output.push(ALPHABET[((value >> 6) & 63) as usize] as char);
        output.push(ALPHABET[(value & 63) as usize] as char);
        index += 3;
    }
    match bytes.len() - index {
        1 => {
            let value = u32::from(bytes[index]) << 16;
            output.push(ALPHABET[((value >> 18) & 63) as usize] as char);
            output.push(ALPHABET[((value >> 12) & 63) as usize] as char);
        }
        2 => {
            let value = (u32::from(bytes[index]) << 16) | (u32::from(bytes[index + 1]) << 8);
            output.push(ALPHABET[((value >> 18) & 63) as usize] as char);
            output.push(ALPHABET[((value >> 12) & 63) as usize] as char);
            output.push(ALPHABET[((value >> 6) & 63) as usize] as char);
        }
        _ => {}
    }
    output
}

fn hex_to_bytes(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("La comprobación criptográfica no tuvo un formato válido.".to_string());
    }
    (0..value.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| "No pude leer la comprobación criptográfica.".to_string())
        })
        .collect()
}

fn random_url_token(bytes: usize) -> Result<String, String> {
    let output = Command::new("/usr/bin/openssl")
        .args(["rand", &bytes.to_string()])
        .output()
        .map_err(|error| format!("No pude generar un valor seguro para OAuth: {error}"))?;
    if !output.status.success() || output.stdout.len() != bytes {
        return Err("No pude generar un valor seguro para OAuth.".to_string());
    }
    Ok(base64_url(&output.stdout))
}

fn sha256_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut child = Command::new("/usr/bin/shasum")
        .args(["-a", "256"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| format!("No pude calcular SHA-256: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "No pude preparar SHA-256.".to_string())?
        .write_all(bytes)
        .map_err(|error| format!("No pude calcular SHA-256: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("No pude calcular SHA-256.".to_string());
    }
    let value = String::from_utf8_lossy(&output.stdout);
    let hex = value.split_whitespace().next().unwrap_or_default();
    hex_to_bytes(hex)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let output = Command::new("/usr/bin/shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()
        .map_err(|error| format!("No pude calcular el hash local: {error}"))?;
    if !output.status.success() {
        return Err("No pude calcular el hash local del archivo.".to_string());
    }
    let hex = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_string();
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("El hash local del archivo no es válido.".to_string());
    }
    Ok(hex)
}

fn md5_file(path: &Path) -> Result<String, String> {
    let output = Command::new("/sbin/md5")
        .args(["-q"])
        .arg(path)
        .output()
        .map_err(|error| format!("No pude calcular la comprobación local para Archive: {error}"))?;
    if !output.status.success() {
        return Err("No pude calcular la comprobación local para Archive.".to_string());
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("La comprobación local de Archive no es válida.".to_string());
    }
    Ok(value)
}

fn url_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{byte:02X}"));
        }
    }
    encoded
}

fn url_decode(value: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    let source = value.as_bytes();
    let mut index = 0;
    while index < source.len() {
        match source[index] {
            b'+' => bytes.push(b' '),
            b'%' if index + 2 < source.len() => {
                let hex = std::str::from_utf8(&source[index + 1..index + 3])
                    .map_err(|_| "El callback OAuth no es válido.".to_string())?;
                bytes.push(
                    u8::from_str_radix(hex, 16)
                        .map_err(|_| "El callback OAuth no es válido.".to_string())?,
                );
                index += 2;
            }
            byte => bytes.push(byte),
        }
        index += 1;
    }
    String::from_utf8(bytes).map_err(|_| "El callback OAuth no es válido.".to_string())
}

fn query_values(query: &str) -> Result<BTreeMap<String, String>, String> {
    let mut values = BTreeMap::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        values.insert(url_decode(key)?, url_decode(value)?);
    }
    Ok(values)
}

fn google_request_error(stdout: &[u8], stderr: &[u8]) -> String {
    let parsed = serde_json::from_slice::<Value>(stdout).ok();
    let error = parsed
        .as_ref()
        .and_then(|value| value.get("error"))
        .and_then(|value| {
            value.as_str().map(ToString::to_string).or_else(|| {
                value
                    .get("status")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            })
        });
    let description = parsed
        .as_ref()
        .and_then(|value| value.get("error_description"))
        .and_then(Value::as_str)
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("error"))
                .and_then(|value| value.get("message"))
                .and_then(Value::as_str)
        });
    match (error.as_deref(), description) {
        (Some("invalid_client"), _) => "Google rechazó el cliente OAuth (invalid_client). Revisa que el Client ID y Client Secret correspondan al mismo OAuth Client de tipo Desktop app.".to_string(),
        (Some("invalid_request"), Some(message)) if message.to_ascii_lowercase().contains("client_secret") => "Falta el Client Secret de este OAuth Client. En FARO abre «Editar configuración», pega el Secret emitido por Google para este mismo cliente Desktop y vuelve a conectar.".to_string(),
        (Some("invalid_grant"), _) => "Google rechazó esta autorización (invalid_grant). El código ya venció o la sesión cambió; vuelve a conectar Drive.".to_string(),
        (Some("unauthorized_client"), _) => "Google no autorizó este OAuth Client para Drive. Revisa que sea de tipo Desktop app y que Drive API esté habilitada.".to_string(),
        (Some("access_denied"), _) => "Google no concedió el acceso solicitado a FARO Archive.".to_string(),
        (Some("PERMISSION_DENIED"), _) => "Google no permitió esa operación de Drive con el acceso concedido.".to_string(),
        (Some(code), Some(message)) => format!("Google rechazó la solicitud ({code}): {message}"),
        (Some(code), None) => format!("Google rechazó la solicitud ({code})."),
        _ => {
            let stderr = String::from_utf8_lossy(stderr);
            if stderr.contains("timed out") {
                "Google tardó demasiado en responder. Revisa la conexión y vuelve a intentar.".to_string()
            } else {
                "Google Drive no aceptó la solicitud. Revisa la conexión o vuelve a enlazar la cuenta.".to_string()
            }
        }
    }
}

fn run_curl(arguments: &[String], input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut command = Command::new("/usr/bin/curl");
    command
        .args(arguments)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("No pude comunicarme con Google Drive: {error}"))?;
    if let Some(input) = input {
        child
            .stdin
            .take()
            .ok_or_else(|| "No pude preparar la carga a Drive.".to_string())?
            .write_all(input)
            .map_err(|error| format!("No pude enviar datos a Google Drive: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(google_request_error(&output.stdout, &output.stderr));
    }
    Ok(output.stdout)
}

fn token_exchange(
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<StoredGoogleTokens, String> {
    let arguments = vec![
        "--silent".to_string(),
        "--show-error".to_string(),
        "--fail-with-body".to_string(),
        "--max-time".to_string(),
        "30".to_string(),
        "-X".to_string(),
        "POST".to_string(),
        "-H".to_string(),
        "Content-Type: application/x-www-form-urlencoded".to_string(),
        "--data-urlencode".to_string(),
        format!("code={code}"),
        "--data-urlencode".to_string(),
        format!("client_id={client_id}"),
        "--data-urlencode".to_string(),
        format!("code_verifier={verifier}"),
        "--data-urlencode".to_string(),
        format!("redirect_uri={redirect_uri}"),
        "--data-urlencode".to_string(),
        "grant_type=authorization_code".to_string(),
    ];
    let mut arguments = arguments;
    if let Some(client_secret) = client_secret.filter(|value| !value.trim().is_empty()) {
        arguments.extend([
            "--data-urlencode".to_string(),
            format!("client_secret={client_secret}"),
        ]);
    }
    arguments.push("https://oauth2.googleapis.com/token".to_string());
    let value: Value = serde_json::from_slice(&run_curl(&arguments, None)?)
        .map_err(|_| "Google devolvió una respuesta OAuth no válida.".to_string())?;
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Google no devolvió un access token.".to_string())?
        .to_string();
    let refresh_token = value.get("refresh_token").and_then(Value::as_str).filter(|value| !value.is_empty())
        .ok_or_else(|| "Google no devolvió un refresh token. Revoca el acceso anterior de FARO y vuelve a conectar la cuenta dedicada.".to_string())?.to_string();
    let expires_in = value
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(3_600)
        .clamp(60, 86_400);
    Ok(StoredGoogleTokens {
        access_token,
        refresh_token,
        expires_at: now_seconds().saturating_add(expires_in.saturating_sub(30)),
    })
}

fn refresh_google_tokens(
    config: &GoogleDriveConfig,
    tokens: &StoredGoogleTokens,
) -> Result<StoredGoogleTokens, String> {
    if tokens.expires_at > now_seconds().saturating_add(60) {
        return Ok(tokens.clone());
    }
    let mut arguments = vec![
        "--silent".to_string(),
        "--show-error".to_string(),
        "--fail-with-body".to_string(),
        "--max-time".to_string(),
        "30".to_string(),
        "-X".to_string(),
        "POST".to_string(),
        "-H".to_string(),
        "Content-Type: application/x-www-form-urlencoded".to_string(),
        "--data-urlencode".to_string(),
        format!("client_id={}", config.client_id),
        "--data-urlencode".to_string(),
        format!("refresh_token={}", tokens.refresh_token),
        "--data-urlencode".to_string(),
        "grant_type=refresh_token".to_string(),
    ];
    if let Some(client_secret) =
        read_google_client_secret()?.filter(|value| !value.trim().is_empty())
    {
        arguments.extend([
            "--data-urlencode".to_string(),
            format!("client_secret={client_secret}"),
        ]);
    }
    arguments.push("https://oauth2.googleapis.com/token".to_string());
    let value: Value = serde_json::from_slice(&run_curl(&arguments, None)?)
        .map_err(|_| "No pude actualizar la sesión de Google Drive.".to_string())?;
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Google no devolvió una sesión válida. Vuelve a conectar Drive.".to_string()
        })?
        .to_string();
    let expires_in = value
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(3_600)
        .clamp(60, 86_400);
    let refreshed = StoredGoogleTokens {
        access_token,
        refresh_token: tokens.refresh_token.clone(),
        expires_at: now_seconds().saturating_add(expires_in.saturating_sub(30)),
    };
    write_google_tokens(&refreshed)?;
    Ok(refreshed)
}

fn active_google_tokens(config: &GoogleDriveConfig) -> Result<StoredGoogleTokens, String> {
    let tokens = read_google_tokens()?.ok_or_else(|| "Google Drive no está conectado. Conecta la cuenta FARO Archive antes de respaldar archivos.".to_string())?;
    refresh_google_tokens(config, &tokens)
}

fn drive_json_request(
    access_token: &str,
    method: &str,
    url: String,
    body: Option<&Value>,
) -> Result<Value, String> {
    let mut arguments = vec![
        "--silent".to_string(),
        "--show-error".to_string(),
        "--fail-with-body".to_string(),
        "--max-time".to_string(),
        "45".to_string(),
        "-X".to_string(),
        method.to_string(),
        "-H".to_string(),
        format!("Authorization: Bearer {access_token}"),
        "-H".to_string(),
        "Accept: application/json".to_string(),
    ];
    if let Some(body) = body {
        arguments.extend([
            "-H".to_string(),
            "Content-Type: application/json; charset=UTF-8".to_string(),
            "--data".to_string(),
            serde_json::to_string(body).map_err(|error| error.to_string())?,
        ]);
    }
    arguments.push(url);
    let output = run_curl(&arguments, None)?;
    serde_json::from_slice(&output)
        .map_err(|_| "Google Drive devolvió una respuesta no válida.".to_string())
}

fn escaped_drive_query_name(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn find_folder(access_token: &str, name: &str, parent_id: &str) -> Result<Option<String>, String> {
    let query = format!(
        "name = '{}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '{}' in parents",
        escaped_drive_query_name(name), escaped_drive_query_name(parent_id),
    );
    let url = format!(
        "{DRIVE_API}/files?q={}&spaces=drive&fields=files(id,name)&pageSize=20",
        url_encode(&query)
    );
    let value = drive_json_request(access_token, "GET", url, None)?;
    Ok(value
        .get("files")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("id"))
        .and_then(Value::as_str)
        .map(ToString::to_string))
}

fn create_folder(access_token: &str, name: &str, parent_id: &str) -> Result<String, String> {
    let body = json!({
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    });
    let value = drive_json_request(
        access_token,
        "POST",
        format!("{DRIVE_API}/files?fields=id,name"),
        Some(&body),
    )?;
    value
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "Google Drive no devolvió el ID de la carpeta creada.".to_string())
}

fn find_or_create_folder(
    access_token: &str,
    name: &str,
    parent_id: &str,
) -> Result<String, String> {
    find_folder(access_token, name, parent_id)?
        .map(Ok)
        .unwrap_or_else(|| create_folder(access_token, name, parent_id))
}

fn update_google_account_metadata(access_token: &str, config: &mut GoogleDriveConfig) {
    let url = format!("{DRIVE_API}/about?fields=user(emailAddress),storageQuota(limit,usage)");
    let Ok(value) = drive_json_request(access_token, "GET", url, None) else {
        return;
    };
    config.account_email = value
        .get("user")
        .and_then(|user| user.get("emailAddress"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    config.quota_limit_bytes = value
        .get("storageQuota")
        .and_then(|quota| quota.get("limit"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse().ok());
    config.quota_used_bytes = value
        .get("storageQuota")
        .and_then(|quota| quota.get("usage"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse().ok());
}

fn ensure_archive_structure(
    access_token: &str,
    config: &mut GoogleDriveConfig,
) -> Result<(), String> {
    let root_name = "FARO Archive";
    let root_id = find_or_create_folder(access_token, root_name, "root")?;
    let mut folders = BTreeMap::new();
    for name in ["Personal", "Work", "Projects", "Learning", "Unclassified"] {
        let id = find_or_create_folder(access_token, name, &root_id)?;
        folders.insert(name.to_string(), id);
    }
    config.root_folder_name = root_name.to_string();
    config.root_folder_id = Some(root_id);
    config.folder_ids = folders;
    update_google_account_metadata(access_token, config);
    config.last_verified_at = Some(now_seconds());
    Ok(())
}

fn safe_archive_folder_name(value: &str) -> Option<String> {
    let cleaned = value
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| match character {
            '/' | '\\' => '–',
            character => character,
        })
        .collect::<String>();
    let cleaned = cleaned.trim_matches('.').trim();
    if cleaned.is_empty() || cleaned == ".." {
        return None;
    }
    Some(cleaned.chars().take(80).collect())
}

/// The initial FARO Archive folders are intentionally few.  A subtree is only
/// created after a person archives a file from that route, so two files from
/// the same local folder share the same remote folder without pre-populating
/// Drive with an enormous mirror of the Mac.
fn source_archive_route(source: &Path) -> (String, Vec<String>) {
    let parent = source.parent().unwrap_or(source);
    let relative = user_home()
        .ok()
        .and_then(|home| parent.strip_prefix(home).ok())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| parent.to_path_buf());
    let segments = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str().and_then(safe_archive_folder_name),
            _ => None,
        })
        .collect::<Vec<_>>();
    let first = segments
        .first()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let (category, anchor) = match first.as_str() {
        "desktop" => ("Personal", "Escritorio"),
        "downloads" => ("Personal", "Descargas"),
        "documents" => ("Personal", "Documentos"),
        "pictures" => ("Personal", "Fotos"),
        "movies" => ("Personal", "Videos"),
        "projects" | "developer" | "code" => ("Projects", "Proyectos"),
        "learning" | "courses" | "cursos" => ("Learning", "Aprendizaje"),
        "work" | "trabajo" => ("Work", "Trabajo"),
        _ => ("Unclassified", "Rutas locales"),
    };
    // The anchor makes familiar macOS locations readable in Drive. Keep only
    // the first four descendants to avoid turning a deeply nested workspace
    // into hundreds of remote folders.
    let mut path = vec![anchor.to_string()];
    path.extend(segments.into_iter().skip(1).take(4));
    (category.to_string(), path)
}

fn remote_path_label(root: &str, category: &str, descendants: &[String]) -> String {
    std::iter::once(root.to_string())
        .chain(std::iter::once(category.to_string()))
        .chain(descendants.iter().cloned())
        .collect::<Vec<_>>()
        .join(" / ")
}

fn folder_for_source(
    access_token: &str,
    config: &mut GoogleDriveConfig,
    source: &Path,
) -> Result<RemoteFolderTarget, String> {
    let (category, descendants) = source_archive_route(source);
    let mut current_id = config
        .folder_ids
        .get(&category)
        .cloned()
        .or_else(|| config.folder_ids.get("Unclassified").cloned())
        .ok_or_else(|| {
            "FARO Archive todavía no tiene sus carpetas iniciales. Vuelve a conectar Google Drive."
                .to_string()
        })?;
    let mut path_key = category.clone();
    for descendant in &descendants {
        path_key.push('/');
        path_key.push_str(descendant);
        let key = format!("route:{path_key}");
        current_id = match config.folder_ids.get(&key) {
            Some(id) => id.clone(),
            None => {
                let created = find_or_create_folder(access_token, descendant, &current_id)?;
                config.folder_ids.insert(key, created.clone());
                created
            }
        };
    }
    Ok(RemoteFolderTarget {
        id: current_id,
        path: remote_path_label(&config.root_folder_name, &category, &descendants),
    })
}

#[derive(Clone, Debug)]
struct RemoteUpload {
    id: String,
    name: String,
    bytes: u64,
    md5_checksum: Option<String>,
}

#[derive(Clone, Debug)]
struct RemoteFolderTarget {
    id: String,
    path: String,
}

fn begin_resumable_upload(
    access_token: &str,
    name: &str,
    bytes: u64,
    parent_id: &str,
) -> Result<String, String> {
    let metadata = json!({ "name": name, "parents": [parent_id] });
    let arguments = vec![
        "--silent".to_string(),
        "--show-error".to_string(),
        "--fail-with-body".to_string(),
        "--max-time".to_string(),
        "45".to_string(),
        "-X".to_string(),
        "POST".to_string(),
        "-D".to_string(),
        "-".to_string(),
        "-o".to_string(),
        "/dev/null".to_string(),
        "-H".to_string(),
        format!("Authorization: Bearer {access_token}"),
        "-H".to_string(),
        "Content-Type: application/json; charset=UTF-8".to_string(),
        "-H".to_string(),
        format!("X-Upload-Content-Length: {bytes}"),
        "-H".to_string(),
        "X-Upload-Content-Type: application/octet-stream".to_string(),
        "--data".to_string(),
        serde_json::to_string(&metadata).map_err(|error| error.to_string())?,
        format!("{DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size,md5Checksum"),
    ];
    let response = run_curl(&arguments, None)?;
    let headers = String::from_utf8_lossy(&response);
    headers
        .lines()
        .find_map(|line| {
            line.split_once(':')
                .filter(|(name, _)| name.eq_ignore_ascii_case("location"))
                .map(|(_, value)| value.trim().to_string())
        })
        .filter(|value| value.starts_with("https://www.googleapis.com/"))
        .ok_or_else(|| "Google Drive no devolvió una sesión de carga segura.".to_string())
}

fn upload_chunk(
    session_url: &str,
    access_token: &str,
    chunk: &[u8],
    start: u64,
    total: u64,
) -> Result<(u16, Vec<u8>), String> {
    let end = start.saturating_add(chunk.len() as u64).saturating_sub(1);
    let arguments = vec![
        "--silent".to_string(),
        "--show-error".to_string(),
        "--max-time".to_string(),
        "120".to_string(),
        "-X".to_string(),
        "PUT".to_string(),
        "-H".to_string(),
        format!("Authorization: Bearer {access_token}"),
        "-H".to_string(),
        format!("Content-Length: {}", chunk.len()),
        "-H".to_string(),
        format!("Content-Range: bytes {start}-{end}/{total}"),
        "--data-binary".to_string(),
        "@-".to_string(),
        "--write-out".to_string(),
        "\n%{http_code}".to_string(),
        session_url.to_string(),
    ];
    let output = run_curl(&arguments, Some(chunk))?;
    let marker = output
        .iter()
        .rposition(|byte| *byte == b'\n')
        .ok_or_else(|| "Google Drive no devolvió el estado de carga.".to_string())?;
    let code = std::str::from_utf8(&output[marker + 1..])
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .ok_or_else(|| "Google Drive no devolvió un estado de carga válido.".to_string())?;
    if !matches!(code, 200 | 201 | 308) {
        return Err("Google Drive no aceptó un fragmento de la carga. El archivo local se conserva intacto.".to_string());
    }
    Ok((code, output[..marker].to_vec()))
}

fn upload_resumable(
    access_token: &str,
    source: &Path,
    bytes: u64,
    parent_id: &str,
    mut on_progress: impl FnMut(u64),
) -> Result<RemoteUpload, String> {
    if bytes == 0 {
        return Err("FARO no sube archivos vacíos a Archive.".to_string());
    }
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "El archivo no tiene un nombre válido para Archive.".to_string())?;
    let session_url = begin_resumable_upload(access_token, name, bytes, parent_id)?;
    let mut file = fs::File::open(source)
        .map_err(|error| format!("No pude abrir el archivo local: {error}"))?;
    let mut offset = 0_u64;
    let mut final_metadata = None;
    loop {
        let mut chunk = vec![0_u8; UPLOAD_CHUNK_BYTES.min((bytes.saturating_sub(offset)) as usize)];
        let read = file
            .read(&mut chunk)
            .map_err(|error| format!("No pude leer el archivo local: {error}"))?;
        if read == 0 {
            break;
        }
        chunk.truncate(read);
        let mut last_error = None;
        let mut response = None;
        for _ in 0..3 {
            match upload_chunk(&session_url, access_token, &chunk, offset, bytes) {
                Ok(value) => {
                    response = Some(value);
                    break;
                }
                Err(error) => {
                    last_error = Some(error);
                    thread::sleep(Duration::from_millis(600));
                }
            }
        }
        let (status, body) = response.ok_or_else(|| {
            last_error.unwrap_or_else(|| "No pude reanudar la carga a Drive.".to_string())
        })?;
        offset = offset.saturating_add(read as u64);
        on_progress(offset);
        if matches!(status, 200 | 201) {
            final_metadata = Some(body);
            break;
        }
    }
    if offset != bytes {
        return Err("La carga quedó incompleta. El archivo local no se movió.".to_string());
    }
    let value: Value = serde_json::from_slice(
        &final_metadata.ok_or_else(|| "Google Drive no confirmó la carga.".to_string())?,
    )
    .map_err(|_| "Google Drive no devolvió metadatos de la carga.".to_string())?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Google Drive no devolvió el ID del archivo.".to_string())?
        .to_string();
    let remote_name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(name)
        .to_string();
    let remote_bytes = value
        .get("size")
        .and_then(Value::as_str)
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    Ok(RemoteUpload {
        id,
        name: remote_name,
        bytes: remote_bytes,
        md5_checksum: value
            .get("md5Checksum")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn verify_remote_upload(
    access_token: &str,
    remote: &RemoteUpload,
    expected_name: &str,
    expected_bytes: u64,
    expected_md5: &str,
) -> Result<RemoteUpload, String> {
    let url = format!(
        "{DRIVE_API}/files/{}?fields=id,name,size,md5Checksum,trashed",
        url_encode(&remote.id)
    );
    let value = drive_json_request(access_token, "GET", url, None)?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Google Drive no pudo verificar el ID remoto.".to_string())?
        .to_string();
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let bytes = value
        .get("size")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let trashed = value
        .get("trashed")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if remote.bytes != 0 && remote.bytes != expected_bytes {
        return Err("Google Drive devolvió un tamaño de carga distinto al esperado. El archivo local se conserva.".to_string());
    }
    let remote_md5 = value
        .get("md5Checksum")
        .and_then(Value::as_str)
        .filter(|value| value.len() == 32)
        .ok_or_else(|| {
            "Google Drive no devolvió el checksum de la copia remota. El archivo local se conserva."
                .to_string()
        })?
        .to_string();
    if id != remote.id
        || name != expected_name
        || bytes != expected_bytes
        || trashed
        || !remote_md5.eq_ignore_ascii_case(expected_md5)
    {
        return Err("La copia remota no pasó la verificación de ID, nombre, tamaño y checksum. El archivo local se conserva.".to_string());
    }
    Ok(RemoteUpload {
        id,
        name,
        bytes,
        md5_checksum: Some(remote_md5),
    })
}

fn write_loopback_response(stream: &mut TcpStream, status: &str, title: &str, message: &str) {
    let body = format!("<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>{title}</title><style>body{{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#07101d;color:#eaf2ff;max-width:560px;margin:12vh auto;padding:24px;line-height:1.55}}h1{{color:#74a9ff}}</style><h1>{title}</h1><p>{message}</p><p>Puedes volver a FARO Desktop.</p></html>");
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn wait_for_oauth_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + OAUTH_TIMEOUT;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(8)));
                let mut buffer = vec![0_u8; 8_192];
                let read = stream
                    .read(&mut buffer)
                    .map_err(|_| "No pude leer el callback de Google.".to_string())?;
                let request = String::from_utf8_lossy(&buffer[..read]);
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or_default();
                let (_, query) = target.split_once('?').unwrap_or((target, ""));
                let values = query_values(query)?;
                let returned_state = values.get("state").map(String::as_str).unwrap_or_default();
                if returned_state != expected_state {
                    write_loopback_response(&mut stream, "400 Bad Request", "FARO no pudo validar la conexión", "El callback no coincide con la sesión iniciada. Cierra esta ventana y vuelve a intentarlo desde FARO.");
                    continue;
                }
                if let Some(error) = values.get("error") {
                    write_loopback_response(&mut stream, "200 OK", "Conexión cancelada", "Google no autorizó el acceso. Puedes volver a FARO y reintentarlo cuando quieras.");
                    return Err(format!("Google canceló la autorización ({error})."));
                }
                let code = values
                    .get("code")
                    .filter(|value| !value.is_empty() && value.len() <= 4_096)
                    .ok_or_else(|| {
                        "Google no devolvió un código de autorización válido.".to_string()
                    })?
                    .to_string();
                write_loopback_response(&mut stream, "200 OK", "Autorización recibida", "FARO recibió la autorización y ahora verificará la cuenta y las carpetas de Archive. Vuelve a FARO Desktop para ver el resultado.");
                return Ok(code);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(120))
            }
            Err(error) => {
                return Err(format!(
                    "No pude abrir el callback local de Google: {error}"
                ))
            }
        }
    }
    Err("La autorización de Google venció. Vuelve a conectar Drive desde FARO.".to_string())
}

fn complete_google_oauth(
    app: &AppHandle,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
    expected_client_id: &str,
) -> Result<(), String> {
    let client_secret = read_google_client_secret()?;
    let tokens = token_exchange(
        expected_client_id,
        client_secret.as_deref(),
        code,
        verifier,
        redirect_uri,
    )?;
    let mut state = read_state(app)?;
    if state.settings.google_drive.client_id != expected_client_id {
        return Err(
            "La configuración de Google cambió durante la autorización. No guardé ninguna sesión."
                .to_string(),
        );
    }
    ensure_archive_structure(&tokens.access_token, &mut state.settings.google_drive)?;
    write_google_tokens(&tokens)?;
    state.settings.google_drive.client_secret_configured = client_secret.is_some();
    state.settings.google_drive.last_connection_error = None;
    add_event(
        &mut state,
        "google_connected",
        "Google Drive quedó conectado con drive.file y FARO Archive fue verificado.".to_string(),
        None,
    );
    write_state(app, &state)
}

fn set_oauth_active(app: &AppHandle, active: bool) {
    if let Ok(mut value) = app.state::<ArchiveOauthState>().active.lock() {
        *value = active;
    }
}

#[tauri::command]
pub fn archive_start_google_drive_oauth_command(
    app: AppHandle,
) -> Result<ArchiveOauthStartResult, String> {
    let state = read_state(&app)?;
    let client_id = state.settings.google_drive.client_id.trim().to_string();
    if client_id.is_empty() {
        return Err(
            "Primero guarda el Client ID de tu OAuth Client de tipo Desktop app.".to_string(),
        );
    }
    if read_google_client_secret()?.is_none() {
        return Err(
            "Falta el Client Secret de este OAuth Client en el Llavero de macOS. En FARO selecciona «Agregar Secret», pégalo y guarda antes de conectar Drive.".to_string(),
        );
    }
    {
        let oauth_state = app.state::<ArchiveOauthState>();
        let mut active = oauth_state
            .active
            .lock()
            .map_err(|_| "No pude iniciar la conexión de Google.".to_string())?;
        if *active {
            return Err(
                "Ya hay una conexión de Google esperando autorización en el navegador.".to_string(),
            );
        }
        *active = true;
    }
    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => listener,
        Err(error) => {
            set_oauth_active(&app, false);
            return Err(format!(
                "No pude reservar un puerto loopback local: {error}"
            ));
        }
    };
    let port = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(error) => {
            set_oauth_active(&app, false);
            return Err(format!("No pude obtener el puerto loopback: {error}"));
        }
    };
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/google-drive");
    let verifier = match random_url_token(48) {
        Ok(value) => value,
        Err(error) => {
            set_oauth_active(&app, false);
            return Err(error);
        }
    };
    let challenge = match sha256_bytes(verifier.as_bytes()) {
        Ok(value) => base64_url(&value),
        Err(error) => {
            set_oauth_active(&app, false);
            return Err(error);
        }
    };
    let callback_state = match random_url_token(32) {
        Ok(value) => value,
        Err(error) => {
            set_oauth_active(&app, false);
            return Err(error);
        }
    };
    let authorize_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        url_encode(&client_id), url_encode(&redirect_uri), url_encode(GOOGLE_DRIVE_SCOPE), url_encode(&challenge), url_encode(&callback_state),
    );
    let browser = Command::new("/usr/bin/open").arg(&authorize_url).status();
    if !browser.is_ok_and(|status| status.success()) {
        set_oauth_active(&app, false);
        return Err(
            "No pude abrir el navegador del sistema para conectar Google Drive.".to_string(),
        );
    }
    let app_for_thread = app.clone();
    let redirect_uri_for_thread = redirect_uri.clone();
    thread::spawn(move || {
        let result = wait_for_oauth_callback(listener, &callback_state).and_then(|code| {
            complete_google_oauth(
                &app_for_thread,
                &code,
                &verifier,
                &redirect_uri_for_thread,
                &client_id,
            )
        });
        if let Err(error) = &result {
            if let Ok(mut archive_state) = read_state(&app_for_thread) {
                archive_state.settings.google_drive.last_connection_error = Some(error.clone());
                add_event(
                    &mut archive_state,
                    "google_connection_failed",
                    format!("No se completó la conexión de Google Drive: {error}"),
                    None,
                );
                let _ = write_state(&app_for_thread, &archive_state);
            }
        }
        set_oauth_active(&app_for_thread, false);
        let _ = app_for_thread.emit("faro://archive-oauth", json!({
            "status": if result.is_ok() { "connected" } else { "failed" },
            "message": result.as_ref().map(|_| "Google Drive conectado.").unwrap_or_else(|error| error.as_str()),
        }));
    });
    Ok(ArchiveOauthStartResult { started: true, redirect_uri, message: "Abrí el navegador del sistema. Completa Google OAuth y vuelve a FARO; no cierres la app mientras tanto.".to_string() })
}

fn mark_archive_item_failed(app: &AppHandle, item_id: &str, message: &str) {
    if let Ok(mut state) = read_state(app) {
        if let Some(item) = state
            .archive_items
            .iter_mut()
            .find(|item| item.id == item_id)
        {
            item.status = "failed".to_string();
            item.updated_at = now_seconds();
        }
        add_event(
            &mut state,
            "archive_failed",
            message.to_string(),
            Some(item_id.to_string()),
        );
        let _ = write_state(app, &state);
    }
}

/// Archive work can take a while (especially for a folder with thousands of
/// files), so the native command emits small, path-free status events while it
/// runs. The UI uses them only as transient progress; the authoritative record
/// remains the local Archive ledger written after verification.
fn emit_archive_progress(
    app: &AppHandle,
    phase: &str,
    item_name: &str,
    current_path: Option<&str>,
    completed_files: usize,
    total_files: usize,
    bytes_completed: u64,
    total_bytes: u64,
) {
    let _ = app.emit(
        "faro://archive-progress",
        json!({
            "phase": phase,
            "itemName": item_name,
            "currentPath": current_path,
            "completedFiles": completed_files,
            "totalFiles": total_files,
            "bytesCompleted": bytes_completed,
            "totalBytes": total_bytes,
        }),
    );
}

fn process_archive_path(
    app: &AppHandle,
    source_path: &Path,
    source_bytes: u64,
    candidate_id: Option<&str>,
    operation: &str,
) -> Result<ArchiveProcessResult, String> {
    if !matches!(operation, "backup" | "archive") {
        return Err("La acción de Archive debe ser Backup o Archive.".to_string());
    }
    if is_sensitive_path(source_path) {
        return Err(
            "FARO Archive bloqueó este archivo sensible. No se subió ni movió nada.".to_string(),
        );
    }
    let metadata = fs::metadata(source_path)
        .map_err(|_| "El archivo ya no está disponible localmente.".to_string())?;
    if !metadata.is_file() || metadata.len() != source_bytes {
        return Err(
            "El archivo cambió antes de iniciar. Actualiza el análisis y vuelve a decidir."
                .to_string(),
        );
    }
    let name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "El archivo no tiene un nombre válido.".to_string())?
        .to_string();
    emit_archive_progress(app, "scanning", &name, None, 0, 1, 0, source_bytes);
    let local_hash = sha256_file(source_path)?;
    let local_md5 = md5_file(source_path)?;
    let item_id = stable_id("archive", &[&source_path.display().to_string(), operation]);
    let mut ledger = read_state(app)?;
    let config = ledger.settings.google_drive.clone();
    if config.root_folder_id.is_none() || config.folder_ids.is_empty() {
        return Err("Google Drive no terminó de preparar FARO Archive. Conecta de nuevo la cuenta antes de subir archivos.".to_string());
    }
    let timestamp = now_seconds();
    ledger.archive_items.push(ArchiveItem {
        id: item_id.clone(),
        name: name.clone(),
        source_path: source_path.display().to_string(),
        bytes: source_bytes,
        provider: "google-drive".to_string(),
        provider_file_id: None,
        sha256: Some(local_hash.clone()),
        status: "queued".to_string(),
        remote_name: None,
        remote_checksum: None,
        remote_folder_id: None,
        remote_path: None,
        operation: operation.to_string(),
        verified_at: None,
        restored_at: None,
        is_directory: false,
        created_at: timestamp,
        updated_at: timestamp,
    });
    add_event(
        &mut ledger,
        "archive_queued",
        format!("{name} entró a la cola de {operation} de FARO Archive."),
        Some(item_id.clone()),
    );
    write_state(app, &ledger)?;

    let outcome = (|| -> Result<RemoteUpload, String> {
        let (tokens, target) = {
            let mut state = read_state(app)?;
            let tokens = active_google_tokens(&state.settings.google_drive)?;
            let target = folder_for_source(
                &tokens.access_token,
                &mut state.settings.google_drive,
                source_path,
            )?;
            // Persist IDs as each source route is first used. If FARO is
            // restarted later, the same local route resolves to the same
            // Drive folder instead of creating a duplicate.
            write_state(app, &state)?;
            (tokens, target)
        };
        let mut state = read_state(app)?;
        if let Some(item) = state
            .archive_items
            .iter_mut()
            .find(|item| item.id == item_id)
        {
            item.status = "uploading".to_string();
            item.updated_at = now_seconds();
        }
        write_state(app, &state)?;
        let uploaded = upload_resumable(
            &tokens.access_token,
            source_path,
            source_bytes,
            &target.id,
            |sent| emit_archive_progress(app, "uploading", &name, Some(&name), 0, 1, sent, source_bytes),
        )?;
        let mut state = read_state(app)?;
        if let Some(item) = state
            .archive_items
            .iter_mut()
            .find(|item| item.id == item_id)
        {
            item.status = "verifying".to_string();
            item.provider_file_id = Some(uploaded.id.clone());
            item.remote_name = Some(uploaded.name.clone());
            item.remote_checksum = uploaded.md5_checksum.clone();
            item.remote_folder_id = Some(target.id.clone());
            item.remote_path = Some(target.path.clone());
            item.updated_at = now_seconds();
        }
        write_state(app, &state)?;
        emit_archive_progress(app, "verifying", &name, Some(&name), 1, 1, source_bytes, source_bytes);
        verify_remote_upload(
            &tokens.access_token,
            &uploaded,
            &name,
            source_bytes,
            &local_md5,
        )
    })();

    let verified = match outcome {
        Ok(value) => value,
        Err(error) => {
            mark_archive_item_failed(app, &item_id, &format!("{name}: {error}"));
            return Err(error);
        }
    };
    // The source is hashed again immediately before Archive can move it. A
    // mismatch means the remote copy is no longer known to match the local
    // file, so FARO leaves the local file intact.
    if sha256_file(source_path)? != local_hash {
        let message = "El archivo local cambió durante la carga. La copia remota se conservó para revisión, pero FARO no movió el original.";
        mark_archive_item_failed(app, &item_id, message);
        return Err(message.to_string());
    }
    if operation == "archive" {
        let candidate_id = candidate_id.ok_or_else(|| {
            "Archive sólo puede mover un archivo que provenga del análisis local actual."
                .to_string()
        })?;
        if let Err(error) =
            storage::archive_move_verified_source_to_trash(app, candidate_id, &item_id, source_bytes)
        {
            mark_archive_item_failed(
                app,
                &item_id,
                &format!("La copia se verificó, pero Archive no se completó: {error}"),
            );
            return Err(format!(
                "La copia se verificó, pero Archive no se completó: {error}"
            ));
        }
    }
    let mut state = read_state(app)?;
    if let Some(item) = state
        .archive_items
        .iter_mut()
        .find(|item| item.id == item_id)
    {
        item.status = if operation == "archive" {
            "archived".to_string()
        } else {
            "backed_up".to_string()
        };
        item.provider_file_id = Some(verified.id.clone());
        item.remote_name = Some(verified.name.clone());
        item.remote_checksum = verified.md5_checksum.clone();
        item.verified_at = Some(now_seconds());
        item.updated_at = now_seconds();
    }
    add_event(
        &mut state,
        if operation == "archive" {
            "archived"
        } else {
            "backed_up"
        },
        format!(
            "{name} se verificó en Google Drive{}.",
            if operation == "archive" {
                " y el original pasó a la Papelera FARO"
            } else {
                "; el original se conserva localmente"
            }
        ),
        Some(item_id.clone()),
    );
    write_state(app, &state)?;
    emit_archive_progress(app, "complete", &name, Some(&name), 1, 1, source_bytes, source_bytes);
    let status = if operation == "archive" {
        "archived".to_string()
    } else {
        "backed_up".to_string()
    };
    let message = if operation == "archive" {
        "Copia verificada; el original está en la Papelera FARO.".to_string()
    } else {
        "Copia verificada; el original se conserva localmente.".to_string()
    };
    Ok(ArchiveProcessResult {
        item_id,
        operation: operation.to_string(),
        status,
        bytes: source_bytes,
        message,
    })
}

#[derive(Clone, Debug)]
struct ArchiveFolderFile {
    path: PathBuf,
    relative_path: PathBuf,
    bytes: u64,
    sha256: Option<String>,
}

#[derive(Clone, Debug)]
struct ArchiveFolderManifest {
    files: Vec<ArchiveFolderFile>,
    directories: Vec<PathBuf>,
    bytes: u64,
}

/// Make one complete, symlink-free manifest before a folder is uploaded. This
/// is intentionally stricter than a Finder view: a folder is moved to Trash
/// only when every regular file it contained was uploaded and verified.
fn archive_folder_manifest(source: &Path) -> Result<ArchiveFolderManifest, String> {
    let mut files = Vec::new();
    let mut directories = vec![PathBuf::new()];
    let mut bytes = 0_u64;
    let mut stack = vec![source.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "No pude leer {} dentro de esta carpeta: {error}",
                directory.file_name().and_then(|name| name.to_str()).unwrap_or("un elemento")
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("No pude enumerar un elemento de la carpeta: {error}"))?;
            let path = entry.path();
            let relative_path = path
                .strip_prefix(source)
                .map_err(|_| "La carpeta cambió mientras FARO preparaba la carga.".to_string())?
                .to_path_buf();
            let file_type = entry.file_type().map_err(|error| format!("No pude revisar {}: {error}", relative_path.display()))?;
            if file_type.is_symlink() {
                return Err(format!(
                    "La carpeta contiene el alias {}. FARO no sigue aliases al archivar; deja el original local o archiva una carpeta sin aliases.",
                    relative_path.display()
                ));
            }
            if is_sensitive_path(&path) {
                return Err(format!(
                    "La carpeta contiene un archivo o ruta sensible ({}) y FARO no la subirá. No se movió nada.",
                    relative_path.display()
                ));
            }
            if file_type.is_dir() {
                if directories.len() >= MAX_ARCHIVE_FOLDER_DIRECTORIES {
                    return Err(format!(
                        "La carpeta supera el límite seguro de {MAX_ARCHIVE_FOLDER_DIRECTORIES} subcarpetas. Divide el archivo en partes más pequeñas."
                    ));
                }
                directories.push(relative_path);
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                return Err(format!(
                    "La carpeta contiene un elemento especial ({}) que FARO no puede verificar con seguridad.",
                    relative_path.display()
                ));
            }
            if files.len() >= MAX_ARCHIVE_FOLDER_FILES {
                return Err(format!(
                    "La carpeta supera el límite seguro de {MAX_ARCHIVE_FOLDER_FILES} archivos. Divide el archivo en partes más pequeñas."
                ));
            }
            let metadata = entry.metadata().map_err(|error| format!("No pude leer {}: {error}", relative_path.display()))?;
            bytes = bytes.saturating_add(metadata.len());
            files.push(ArchiveFolderFile {
                path,
                relative_path,
                bytes: metadata.len(),
                sha256: None,
            });
        }
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    directories.sort();
    Ok(ArchiveFolderManifest { files, directories, bytes })
}

fn same_folder_layout(left: &ArchiveFolderManifest, right: &ArchiveFolderManifest) -> bool {
    left.bytes == right.bytes
        && left.files.len() == right.files.len()
        && left.directories == right.directories
        && left.files.iter().zip(&right.files).all(|(a, b)| {
            a.relative_path == b.relative_path && a.bytes == b.bytes
        })
}

fn verify_remote_folder(access_token: &str, folder_id: &str, expected_name: &str) -> Result<(), String> {
    let url = format!(
        "{DRIVE_API}/files/{}?fields=id,name,mimeType,trashed",
        url_encode(folder_id)
    );
    let value = drive_json_request(access_token, "GET", url, None)?;
    let id = value.get("id").and_then(Value::as_str).unwrap_or_default();
    let name = value.get("name").and_then(Value::as_str).unwrap_or_default();
    let mime_type = value.get("mimeType").and_then(Value::as_str).unwrap_or_default();
    let trashed = value.get("trashed").and_then(Value::as_bool).unwrap_or(true);
    if id != folder_id || name != expected_name || mime_type != "application/vnd.google-apps.folder" || trashed {
        return Err("Google Drive no pudo verificar la carpeta remota. La carpeta local se conserva.".to_string());
    }
    Ok(())
}

fn remote_folder_for_relative(
    access_token: &str,
    root_id: &str,
    relative: &Path,
    cache: &mut HashMap<PathBuf, String>,
) -> Result<String, String> {
    let mut current_id = root_id.to_string();
    let mut current_path = PathBuf::new();
    for component in relative.components() {
        let Component::Normal(name) = component else { continue };
        let name = name
            .to_str()
            .and_then(safe_archive_folder_name)
            .ok_or_else(|| "Una subcarpeta no tiene un nombre válido para Drive.".to_string())?;
        current_path.push(&name);
        current_id = match cache.get(&current_path) {
            Some(id) => id.clone(),
            None => {
                let id = find_or_create_folder(access_token, &name, &current_id)?;
                cache.insert(current_path.clone(), id.clone());
                id
            }
        };
    }
    Ok(current_id)
}

fn process_archive_folder(
    app: &AppHandle,
    source_path: &Path,
    candidate_id: Option<&str>,
    operation: &str,
) -> Result<ArchiveProcessResult, String> {
    if !matches!(operation, "backup" | "archive") {
        return Err("La acción de Archive debe ser Backup o Archive.".to_string());
    }
    if is_sensitive_path(source_path) {
        return Err("FARO Archive bloqueó esta ruta sensible. No se subió ni movió nada.".to_string());
    }
    let metadata = fs::metadata(source_path)
        .map_err(|_| "La carpeta ya no está disponible localmente.".to_string())?;
    if !metadata.is_dir() {
        return Err("La carpeta cambió antes de iniciar. Actualiza el análisis y vuelve a decidir.".to_string());
    }
    let name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .and_then(safe_archive_folder_name)
        .ok_or_else(|| "La carpeta no tiene un nombre válido para Archive.".to_string())?;
    emit_archive_progress(app, "scanning", &name, None, 0, 0, 0, 0);
    let mut manifest = archive_folder_manifest(source_path)?;
    let total_files = manifest.files.len();
    let total_bytes = manifest.bytes;
    let source_identity = source_path.display().to_string();
    let item_id = stable_id("archive-folder", &[&source_identity, operation]);

    let mut ledger = read_state(app)?;
    let config = ledger.settings.google_drive.clone();
    if config.root_folder_id.is_none() || config.folder_ids.is_empty() {
        return Err("Google Drive no terminó de preparar FARO Archive. Conecta de nuevo la cuenta antes de subir carpetas.".to_string());
    }
    let timestamp = now_seconds();
    ledger.archive_items.push(ArchiveItem {
        id: item_id.clone(),
        name: name.clone(),
        source_path: source_identity,
        bytes: total_bytes,
        provider: "google-drive".to_string(),
        provider_file_id: None,
        sha256: None,
        status: "queued".to_string(),
        remote_name: None,
        remote_checksum: None,
        remote_folder_id: None,
        remote_path: None,
        operation: operation.to_string(),
        verified_at: None,
        restored_at: None,
        is_directory: true,
        created_at: timestamp,
        updated_at: timestamp,
    });
    add_event(
        &mut ledger,
        "archive_folder_queued",
        format!("La carpeta {name} entró a la cola de {operation} de FARO Archive."),
        Some(item_id.clone()),
    );
    write_state(app, &ledger)?;

    let outcome = (|| -> Result<RemoteFolderTarget, String> {
        let (tokens, target) = {
            let mut state = read_state(app)?;
            let tokens = active_google_tokens(&state.settings.google_drive)?;
            let parent = folder_for_source(&tokens.access_token, &mut state.settings.google_drive, source_path)?;
            let root_id = find_or_create_folder(&tokens.access_token, &name, &parent.id)?;
            let target = RemoteFolderTarget {
                id: root_id,
                path: format!("{} / {}", parent.path, name),
            };
            write_state(app, &state)?;
            (tokens, target)
        };
        verify_remote_folder(&tokens.access_token, &target.id, &name)?;
        let mut state = read_state(app)?;
        if let Some(item) = state.archive_items.iter_mut().find(|item| item.id == item_id) {
            item.status = "uploading".to_string();
            item.provider_file_id = Some(target.id.clone());
            item.remote_name = Some(name.clone());
            item.remote_folder_id = Some(target.id.clone());
            item.remote_path = Some(target.path.clone());
            item.updated_at = now_seconds();
        }
        write_state(app, &state)?;

        let mut folders = HashMap::new();
        folders.insert(PathBuf::new(), target.id.clone());
        for directory in manifest.directories.iter().filter(|directory| !directory.as_os_str().is_empty()) {
            remote_folder_for_relative(&tokens.access_token, &target.id, directory, &mut folders)?;
        }

        let mut completed_bytes = 0_u64;
        for (index, file) in manifest.files.iter_mut().enumerate() {
            let current = file.relative_path.display().to_string();
            emit_archive_progress(app, "uploading", &name, Some(&current), index, total_files, completed_bytes, total_bytes);
            let local_hash = sha256_file(&file.path)?;
            let local_md5 = md5_file(&file.path)?;
            let relative_parent = file.relative_path.parent().unwrap_or_else(|| Path::new(""));
            let parent_id = remote_folder_for_relative(&tokens.access_token, &target.id, relative_parent, &mut folders)?;
            let base_bytes = completed_bytes;
            let uploaded = upload_resumable(
                &tokens.access_token,
                &file.path,
                file.bytes,
                &parent_id,
                |sent| emit_archive_progress(app, "uploading", &name, Some(&current), index, total_files, base_bytes.saturating_add(sent), total_bytes),
            )?;
            emit_archive_progress(app, "verifying", &name, Some(&current), index + 1, total_files, base_bytes.saturating_add(file.bytes), total_bytes);
            verify_remote_upload(
                &tokens.access_token,
                &uploaded,
                file.path.file_name().and_then(|value| value.to_str()).unwrap_or_default(),
                file.bytes,
                &local_md5,
            )?;
            file.sha256 = Some(local_hash);
            completed_bytes = completed_bytes.saturating_add(file.bytes);
        }

        // A re-scan catches additions/removals while the upload was in flight;
        // hashes catch same-size edits. In either case we keep the whole local
        // folder in place and mark the remote copy for manual review.
        let current_manifest = archive_folder_manifest(source_path)?;
        if !same_folder_layout(&manifest, &current_manifest) {
            return Err("La carpeta cambió durante la carga. La copia remota quedó para revisión, pero FARO no moverá la carpeta local.".to_string());
        }
        for file in &manifest.files {
            if sha256_file(&file.path)? != file.sha256.as_deref().unwrap_or_default() {
                return Err("Un archivo de la carpeta cambió durante la carga. La copia remota quedó para revisión, pero FARO no moverá la carpeta local.".to_string());
            }
        }
        Ok(target)
    })();

    let target = match outcome {
        Ok(target) => target,
        Err(error) => {
            mark_archive_item_failed(app, &item_id, &format!("{name}: {error}"));
            emit_archive_progress(app, "failed", &name, None, 0, total_files, 0, total_bytes);
            return Err(error);
        }
    };
    if operation == "archive" {
        let candidate_id = candidate_id.ok_or_else(|| "Archive sólo puede mover una carpeta que provenga del análisis local actual.".to_string())?;
        emit_archive_progress(app, "movingToTrash", &name, None, total_files, total_files, total_bytes, total_bytes);
        if let Err(error) = storage::archive_move_verified_source_to_trash(app, candidate_id, &item_id, total_bytes) {
            mark_archive_item_failed(app, &item_id, &format!("La carpeta se verificó, pero Archive no se completó: {error}"));
            emit_archive_progress(app, "failed", &name, None, total_files, total_files, total_bytes, total_bytes);
            return Err(format!("La carpeta se verificó, pero Archive no se completó: {error}"));
        }
    }
    let mut state = read_state(app)?;
    if let Some(item) = state.archive_items.iter_mut().find(|item| item.id == item_id) {
        item.status = if operation == "archive" { "archived".to_string() } else { "backed_up".to_string() };
        item.provider_file_id = Some(target.id.clone());
        item.remote_name = Some(name.clone());
        item.remote_folder_id = Some(target.id.clone());
        item.remote_path = Some(target.path.clone());
        item.verified_at = Some(now_seconds());
        item.updated_at = now_seconds();
    }
    add_event(
        &mut state,
        if operation == "archive" { "folder_archived" } else { "folder_backed_up" },
        format!(
            "La carpeta {name} ({total_files} archivo(s)) se verificó en Google Drive{}.",
            if operation == "archive" { " y el original pasó a la Papelera FARO" } else { "; el original se conserva localmente" }
        ),
        Some(item_id.clone()),
    );
    write_state(app, &state)?;
    emit_archive_progress(app, "complete", &name, None, total_files, total_files, total_bytes, total_bytes);
    Ok(ArchiveProcessResult {
        item_id,
        operation: operation.to_string(),
        status: if operation == "archive" { "archived".to_string() } else { "backed_up".to_string() },
        bytes: total_bytes,
        message: if operation == "archive" {
            format!("Carpeta verificada ({total_files} archivo(s)); el original está en la Papelera FARO.")
        } else {
            format!("Carpeta verificada ({total_files} archivo(s)); el original se conserva localmente.")
        },
    })
}

#[tauri::command]
pub fn archive_process_storage_candidate_command(
    app: AppHandle,
    input: ArchiveProcessInput,
) -> Result<ArchiveProcessResult, String> {
    let source = storage::archive_source_for(&app, &input.candidate_id)?;
    if source.is_directory {
        process_archive_folder(&app, &source.path, Some(&input.candidate_id), &input.operation)
    } else {
        process_archive_path(
            &app,
            &source.path,
            source.bytes,
            Some(&input.candidate_id),
            &input.operation,
        )
    }
}

/// Processes a user-selected batch serially. Each source still gets its own
/// hash verification and, for Archive, only moves to macOS Trash after that
/// exact remote copy succeeds. Credentials are warmed once before the batch,
/// so a single explicit archive decision never reopens Keychain per file.
#[tauri::command]
pub fn archive_process_storage_candidates_command(
    app: AppHandle,
    input: ArchiveBatchProcessInput,
) -> Result<ArchiveBatchProcessResult, String> {
    if !matches!(input.operation.as_str(), "backup" | "archive") {
        return Err("La acción de Archive debe ser Backup o Archive.".to_string());
    }
    if input.candidate_ids.is_empty() || input.candidate_ids.len() > MAX_ARCHIVE_BATCH_ITEMS {
        return Err(format!(
            "Selecciona entre 1 y {MAX_ARCHIVE_BATCH_ITEMS} archivos o carpetas por tanda de Archive."
        ));
    }
    let candidate_ids = input
        .candidate_ids
        .into_iter()
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .collect::<BTreeSet<_>>();
    if candidate_ids.is_empty() {
        return Err("La selección de Archive no contiene archivos válidos.".to_string());
    }

    // Do the one credential read/refresh before touching any local file. The
    // process-local cache keeps subsequent files in this same batch—and later
    // actions while FARO remains open—from triggering additional prompts.
    let state = read_state(&app)?;
    let _ = active_google_tokens(&state.settings.google_drive)?;

    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    let mut bytes_processed = 0_u64;
    for candidate_id in candidate_ids {
        let source = match storage::archive_source_for(&app, &candidate_id) {
            Ok(source) => source,
            Err(error) => {
                failed.push(error);
                continue;
            }
        };
        let result = if source.is_directory {
            process_archive_folder(&app, &source.path, Some(&candidate_id), &input.operation)
        } else {
            process_archive_path(
                &app,
                &source.path,
                source.bytes,
                Some(&candidate_id),
                &input.operation,
            )
        };
        match result {
            Ok(result) => {
                bytes_processed = bytes_processed.saturating_add(result.bytes);
                succeeded.push(result);
            }
            Err(error) => {
                let name = source
                    .path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Archivo");
                failed.push(format!("{name}: {error}"));
            }
        }
    }
    Ok(ArchiveBatchProcessResult {
        operation: input.operation,
        succeeded,
        failed,
        bytes_processed,
    })
}

#[tauri::command]
pub fn archive_run_safe_upload_test_command(
    app: AppHandle,
) -> Result<ArchiveProcessResult, String> {
    let test_path = state_path(&app)?.with_file_name("faro-archive-safe-upload-test.txt");
    let content = format!(
        "FARO Archive upload verification test\ncreatedAt={}\n",
        now_seconds()
    );
    fs::write(&test_path, content.as_bytes())
        .map_err(|error| format!("No pude preparar el archivo de prueba: {error}"))?;
    process_archive_path(&app, &test_path, content.len() as u64, None, "backup")
}

fn restore_destination(app: &AppHandle, source_path: &str, name: &str) -> Result<PathBuf, String> {
    let original = PathBuf::from(source_path);
    let parent = original.parent().ok_or_else(|| {
        "El archivo archivado no tiene una ruta de restauración válida.".to_string()
    })?;
    let canonical_parent = parent.canonicalize().map_err(|_| "La carpeta original ya no está disponible. Crea la carpeta y vuelve a intentar restaurar.".to_string())?;
    let home = user_home()?;
    let archive_data = state_path(app)?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "No pude resolver el espacio local de FARO Archive.".to_string())?;
    if (!canonical_parent.starts_with(&home) && canonical_parent != archive_data)
        || is_sensitive_path(&canonical_parent)
    {
        return Err(
            "FARO sólo restaura a una carpeta personal segura o al archivo de prueba local."
                .to_string(),
        );
    }
    let destination = canonical_parent.join(name);
    if destination.exists() {
        return Err("Ya existe un archivo con ese nombre en la ruta original. FARO no sobrescribe archivos al restaurar.".to_string());
    }
    Ok(destination)
}

fn download_remote_file(
    access_token: &str,
    remote_id: &str,
    temporary: &Path,
) -> Result<(), String> {
    let arguments = vec![
        "--silent".to_string(),
        "--show-error".to_string(),
        "--fail-with-body".to_string(),
        "--max-time".to_string(),
        "180".to_string(),
        "-H".to_string(),
        format!("Authorization: Bearer {access_token}"),
        "-o".to_string(),
        temporary.display().to_string(),
        format!("{DRIVE_API}/files/{}?alt=media", url_encode(remote_id)),
    ];
    let _ = run_curl(&arguments, None)?;
    Ok(())
}

fn open_drive_url(path: &str) -> Result<(), String> {
    // The host is fixed; IDs from the local ledger are percent-encoded before
    // becoming part of the URL, so this command never opens an arbitrary URL.
    let url = format!("https://drive.google.com/{path}");
    Command::new("/usr/bin/open")
        .arg(url)
        .spawn()
        .map_err(|_| "No pude abrir Google Drive en tu navegador.".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn archive_open_remote_item_command(app: AppHandle, item_id: String) -> Result<(), String> {
    let state = read_state(&app)?;
    let remote_id = state
        .archive_items
        .iter()
        .find(|item| {
            item.id == item_id && matches!(item.status.as_str(), "backed_up" | "archived")
        })
        .and_then(|item| item.provider_file_id.as_deref())
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or_else(|| "No encontré una copia verificada de ese archivo en Drive.".to_string())?;
    open_drive_url(&format!("open?id={}", url_encode(remote_id)))
}

#[tauri::command]
pub fn archive_open_root_folder_command(app: AppHandle) -> Result<(), String> {
    let state = read_state(&app)?;
    let root_id = state
        .settings
        .google_drive
        .root_folder_id
        .as_deref()
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or_else(|| "FARO Archive todavía no tiene una carpeta de Drive verificada.".to_string())?;
    open_drive_url(&format!("drive/folders/{}", url_encode(root_id)))
}

#[tauri::command]
pub fn archive_restore_item_command(
    app: AppHandle,
    item_id: String,
    confirmation: String,
) -> Result<ArchiveProcessResult, String> {
    if confirmation.trim().to_uppercase() != "RESTAURAR" {
        return Err(
            "Escribe RESTAURAR para confirmar. FARO nunca sobrescribirá un archivo existente."
                .to_string(),
        );
    }
    let state = read_state(&app)?;
    let item = state
        .archive_items
        .iter()
        .find(|item| item.id == item_id && matches!(item.status.as_str(), "backed_up" | "archived"))
        .cloned()
        .ok_or_else(|| {
            "Ese archivo no tiene una copia verificada disponible para restaurar.".to_string()
        })?;
    if item.is_directory {
        return Err("La copia de esta carpeta está disponible en Drive, pero la restauración completa de carpetas llegará en una siguiente versión. Por ahora puedes abrirla en Drive sin riesgo.".to_string());
    }
    let remote_id = item
        .provider_file_id
        .clone()
        .ok_or_else(|| "No encontré el ID remoto del archivo.".to_string())?;
    let destination = restore_destination(&app, &item.source_path, &item.name)?;
    let temporary = destination.with_file_name(format!(".faro-restoring-{}", item.id));
    if temporary.exists() {
        return Err("Ya hay una restauración pendiente para ese archivo. Revisa la carpeta original antes de continuar.".to_string());
    }
    let tokens = active_google_tokens(&state.settings.google_drive)?;
    if let Err(error) = download_remote_file(&tokens.access_token, &remote_id, &temporary) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    let downloaded = fs::metadata(&temporary)
        .map_err(|_| "La restauración no produjo un archivo local.".to_string())?;
    let hash_matches = item
        .sha256
        .as_deref()
        .map(|expected| sha256_file(&temporary).map(|actual| actual.eq_ignore_ascii_case(expected)))
        .transpose()?
        .unwrap_or(true);
    if !downloaded.is_file() || downloaded.len() != item.bytes || !hash_matches {
        let _ = fs::remove_file(&temporary);
        return Err("La restauración no pasó la verificación de tamaño y hash. No se creó ningún archivo final.".to_string());
    }
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("No pude colocar el archivo restaurado: {error}"))?;
    let mut ledger = read_state(&app)?;
    if let Some(saved) = ledger
        .archive_items
        .iter_mut()
        .find(|saved| saved.id == item_id)
    {
        saved.restored_at = Some(now_seconds());
        saved.updated_at = now_seconds();
    }
    add_event(
        &mut ledger,
        "restored",
        format!(
            "{} se restauró en su ruta original sin sobrescribir archivos.",
            item.name
        ),
        Some(item_id.clone()),
    );
    write_state(&app, &ledger)?;
    Ok(ArchiveProcessResult {
        item_id,
        operation: "restore".to_string(),
        status: "restored".to_string(),
        bytes: item.bytes,
        message: format!("Restauré {} en {}.", item.name, destination.display()),
    })
}

fn trash_path_is_owned(path: &Path, home: &Path) -> Result<bool, String> {
    let trash = home.join(".Trash");
    if !path.is_absolute()
        || !path.starts_with(&trash)
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Ok(false);
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    // Removing a symlink only removes the link itself; never follow it to a
    // destination outside the Trash directory.
    if metadata.file_type().is_symlink() {
        return Ok(true);
    }
    let canonical_trash = trash.canonicalize().map_err(|error| error.to_string())?;
    let canonical_path = path.canonicalize().map_err(|error| error.to_string())?;
    Ok(canonical_path.starts_with(canonical_trash))
}

fn remove_owned_trash_entry(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())
    } else if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        Err("El registro no apunta a un archivo o carpeta gestionable.".to_string())
    }
}

/// Finder is allowed to restore or empty the user's Trash at any time. The
/// FARO ledger is only an authorization record, never a second source of
/// truth for the filesystem, so reconcile it before rendering or purging.
/// Missing entries are deliberately not counted as bytes freed *by FARO*:
/// they were removed outside this controlled permanent-purge flow.
fn reconcile_faro_trash(state: &mut ArchiveState, home: &Path) -> usize {
    let now = now_seconds();
    let mut missing = 0_usize;
    for item in state
        .trash_items
        .iter_mut()
        .filter(|item| item.status == "trashed")
    {
        let path = PathBuf::from(&item.trash_path);
        let exists = match fs::symlink_metadata(&path) {
            Ok(_) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            // A temporary permission or I/O failure must not make a record
            // disappear. It can still be reviewed again later.
            Err(_) => true,
        };
        if !exists || !trash_path_is_owned(&path, home).unwrap_or(false) {
            item.status = "missing".to_string();
            item.purged_at = Some(now);
            missing += 1;
        }
    }
    if missing > 0 {
        add_event(
            state,
            "trash_reconciled",
            format!(
                "FARO retiró {missing} registro(s) cuyo archivo ya no está en la Papelera de macOS."
            ),
            None,
        );
    }
    missing
}

fn overview_from_state(
    state: &ArchiveState,
    monthly_review_due: bool,
    oauth_in_progress: bool,
) -> ArchiveOverview {
    let now = now_seconds();
    let active_trash = state
        .trash_items
        .iter()
        .filter(|item| item.status == "trashed")
        .collect::<Vec<_>>();
    let eligible = active_trash
        .iter()
        .filter(|item| now >= item.grace_ends_at)
        .collect::<Vec<_>>();
    let backup_items = state
        .archive_items
        .iter()
        .filter(|item| item.status == "backed_up")
        .collect::<Vec<_>>();
    let archived_items = state
        .archive_items
        .iter()
        .filter(|item| item.status == "archived")
        .collect::<Vec<_>>();
    let provider = GoogleDriveArchiveProvider {
        config: &state.settings.google_drive,
    };
    let configured = provider.is_configured();
    // Reading a Keychain item can present a macOS password dialog. Connection
    // status is durable metadata already recorded after OAuth; do not turn a
    // passive UI refresh into a Keychain access. The actual archive operation
    // still reads and validates the token before any file is touched.
    let connected = configured
        && state.settings.google_drive.account_email.is_some()
        && state.settings.google_drive.root_folder_id.is_some();
    let client_secret_configured = state.settings.google_drive.client_secret_configured || connected;
    let events = state
        .events
        .iter()
        .rev()
        .take(8)
        .map(|event| ArchiveEventOverview {
            id: event.id.clone(),
            created_at: event.created_at,
            kind: event.kind.clone(),
            message: event.message.clone(),
            item_id: event.item_id.clone(),
        })
        .collect();
    let item_overview = |item: &ArchiveItem| ArchiveItemOverview {
        id: item.id.clone(),
        name: item.name.clone(),
        source_path: item.source_path.clone(),
        // Older FARO Archive records predate route-level folder tracking.
        // They remain restorable and are labelled with their original
        // category rather than being hidden from the new Drive inventory.
        remote_path: item.remote_path.clone().or_else(|| {
            let (category, _) = source_archive_route(Path::new(&item.source_path));
            Some(format!("{} / {}", state.settings.google_drive.root_folder_name, category))
        }),
        bytes: item.bytes,
        operation: item.operation.clone(),
        status: item.status.clone(),
        verified_at: item.verified_at,
        restored_at: item.restored_at,
        restorable: !item.is_directory
            && item.provider_file_id.is_some()
            && matches!(item.status.as_str(), "backed_up" | "archived"),
        is_directory: item.is_directory,
    };
    let recent_items = state
        .archive_items
        .iter()
        .rev()
        .take(12)
        .map(&item_overview)
        .collect();
    let mut remote_items = state
        .archive_items
        .iter()
        .filter(|item| matches!(item.status.as_str(), "backed_up" | "archived"))
        .collect::<Vec<_>>();
    remote_items.sort_by_key(|item| std::cmp::Reverse(item.verified_at.unwrap_or(item.updated_at)));
    let remote_items = remote_items
        .into_iter()
        .take(250)
        .map(item_overview)
        .collect();
    ArchiveOverview {
        provider: ArchiveProviderOverview {
            provider: "Google Drive".to_string(),
            configured,
            client_id: state.settings.google_drive.client_id.clone(),
            client_secret_configured,
            connected,
            account_email: state.settings.google_drive.account_email.clone(),
            root_folder_name: state.settings.google_drive.root_folder_name.clone(),
            root_folder_id: state.settings.google_drive.root_folder_id.clone(),
            scope: GOOGLE_DRIVE_SCOPE.to_string(),
            status_message: if connected {
                "Drive conectado con acceso limitado a archivos creados por FARO.".to_string()
            } else if oauth_in_progress {
                "Esperando la autorización de Google en tu navegador…".to_string()
            } else if let Some(error) = state.settings.google_drive.last_connection_error.as_ref() {
                format!("La conexión no terminó: {error}")
            } else if configured && !client_secret_configured {
                "El Client ID está guardado, pero falta el Client Secret. Abre «Editar configuración» antes de conectar Drive.".to_string()
            } else if configured {
                "Configuración guardada localmente. Falta terminar la conexión OAuth de Google.".to_string()
            } else {
                "Google Drive aún no está configurado. FARO no subirá nada hasta que conectes una cuenta dedicada.".to_string()
            },
            oauth_in_progress,
            quota_limit_bytes: state.settings.google_drive.quota_limit_bytes,
            quota_used_bytes: state.settings.google_drive.quota_used_bytes,
        },
        archive: ArchiveMetricOverview {
            item_count: state.archive_items.len(),
            backup_count: backup_items.len(),
            archived_count: archived_items.len(),
            bytes_backed_up: backup_items.iter().fold(0_u64, |sum, item| sum.saturating_add(item.bytes)),
            bytes_archived: archived_items.iter().fold(0_u64, |sum, item| sum.saturating_add(item.bytes)),
            // A move to Trash is reversible but does not yet release disk
            // blocks. Only a user-confirmed permanent purge may be counted.
            local_bytes_freed_by_faro: state.trash_items.iter().filter(|item| item.status == "purged").fold(0_u64, |sum, item| sum.saturating_add(item.bytes)),
        },
        trash: FaroTrashOverview {
            tracked_count: active_trash.len(),
            tracked_bytes: active_trash.iter().fold(0_u64, |sum, item| sum.saturating_add(item.bytes)),
            eligible_count: eligible.len(),
            eligible_bytes: eligible.iter().fold(0_u64, |sum, item| sum.saturating_add(item.bytes)),
            grace_days: state.settings.trash_grace_days,
            monthly_review_due,
            items: active_trash.into_iter().rev().take(80).map(|item| FaroTrashItemOverview {
                id: item.id.clone(), name: item.name.clone(), source_path: item.source_path.clone(), bytes: item.bytes,
                reason: item.reason.clone(), action: item.action.clone(), moved_at: item.moved_at,
                grace_ends_at: item.grace_ends_at, status: item.status.clone(), eligible_for_purge: now >= item.grace_ends_at,
            }).collect(),
        },
        policy: ArchivePolicyOverview {
            protected_paths_only: true,
            sensitive_files_blocked: true,
            auto_purge_enabled: false,
            monthly_review_enabled: state.settings.monthly_review_enabled,
            rules: vec![
                "Capturas y descargas grandes antiguas: revisar antes de enviar a Papelera.".to_string(),
                "ZIP, DMG e instaladores antiguos: sugerir Papelera o Archive según su valor.".to_string(),
                "Videos grandes en Escritorio o Descargas: sugerir Archive; nunca mover sin verificación.".to_string(),
                "Carpetas de builds y cachés: limpieza local, nunca Archive.".to_string(),
                "Credenciales, llaves y archivos .env: bloqueados de FARO Archive.".to_string(),
            ],
        },
        recent_events: events,
        recent_items,
        remote_items,
    }
}

/// Called only after the native storage command has safely moved an item to
/// ~/.Trash. The record is what later authorizes a *specific* purge; FARO does
/// not enumerate or delete unrelated macOS Trash entries.
pub fn record_faro_trash(
    app: &AppHandle,
    source_path: &Path,
    trash_path: &Path,
    bytes: u64,
    reason: &str,
) -> Result<(), String> {
    record_faro_trash_action(app, source_path, trash_path, bytes, reason, "trash", None)
}

pub fn record_faro_archive_trash(
    app: &AppHandle,
    source_path: &Path,
    trash_path: &Path,
    bytes: u64,
    archive_item_id: &str,
) -> Result<(), String> {
    record_faro_trash_action(
        app,
        source_path,
        trash_path,
        bytes,
        "Copia verificada en FARO Archive",
        "archive",
        Some(archive_item_id.to_string()),
    )
}

fn record_faro_trash_action(
    app: &AppHandle,
    source_path: &Path,
    trash_path: &Path,
    bytes: u64,
    reason: &str,
    action: &str,
    archive_item_id: Option<String>,
) -> Result<(), String> {
    let home = user_home()?;
    if is_sensitive_path(source_path) || !trash_path_is_owned(trash_path, &home)? {
        return Err("FARO no pudo registrar ese elemento para su Papelera gobernada.".to_string());
    }
    let mut state = read_state(app)?;
    let moved_at = now_seconds();
    let name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Archivo")
        .to_string();
    let item = FaroTrashItem {
        id: stable_id(
            "trash",
            &[
                &source_path.display().to_string(),
                &trash_path.display().to_string(),
            ],
        ),
        name: name.clone(),
        source_path: source_path.display().to_string(),
        trash_path: trash_path.display().to_string(),
        bytes,
        reason: reason.to_string(),
        action: action.to_string(),
        archive_item_id,
        moved_at,
        grace_ends_at: moved_at
            .saturating_add(state.settings.trash_grace_days.saturating_mul(86_400)),
        status: "trashed".to_string(),
        purged_at: None,
    };
    state.trash_items.push(item);
    if state.trash_items.len() > MAX_TRASH_ITEMS {
        let overflow = state.trash_items.len() - MAX_TRASH_ITEMS;
        state.trash_items.drain(0..overflow);
    }
    add_event(
        &mut state,
        "local_trashed",
        format!("{name} se movió a la Papelera de macOS desde FARO."),
        None,
    );
    write_state(app, &state)
}

#[tauri::command]
pub fn archive_overview_command(app: AppHandle) -> Result<ArchiveOverview, String> {
    let mut state = read_state(&app)?;
    let home = user_home()?;
    let reconciled = reconcile_faro_trash(&mut state, &home);
    let review_created = update_monthly_review(&mut state);
    if review_created || reconciled > 0 {
        write_state(&app, &state)?;
    }
    let oauth_in_progress = app
        .state::<ArchiveOauthState>()
        .active
        .lock()
        .map(|value| *value)
        .unwrap_or(false);
    Ok(overview_from_state(
        &state,
        monthly_review_is_due(&state),
        oauth_in_progress,
    ))
}

#[tauri::command]
pub fn archive_acknowledge_monthly_review_command(
    app: AppHandle,
) -> Result<ArchiveOverview, String> {
    let mut state = read_state(&app)?;
    let home = user_home()?;
    let _ = reconcile_faro_trash(&mut state, &home);
    let _ = update_monthly_review(&mut state);
    if state.settings.monthly_review_enabled {
        state.monthly_review_acknowledged_month = Some(current_month());
        add_event(
            &mut state,
            "monthly_review_opened",
            "Se abrió el cierre mensual de Papelera FARO.".to_string(),
            None,
        );
    }
    write_state(&app, &state)?;
    Ok(overview_from_state(
        &state,
        monthly_review_is_due(&state),
        false,
    ))
}

#[tauri::command]
pub fn archive_update_settings_command(
    app: AppHandle,
    patch: ArchiveSettingsPatch,
) -> Result<ArchiveOverview, String> {
    let mut state = read_state(&app)?;
    if let Some(days) = patch.trash_grace_days {
        state.settings.trash_grace_days = days.clamp(1, 30);
    }
    if let Some(enabled) = patch.monthly_review_enabled {
        state.settings.monthly_review_enabled = enabled;
    }
    state.settings.auto_purge = false;
    add_event(
        &mut state,
        "settings_updated",
        "Se actualizaron las políticas locales de FARO Archive.".to_string(),
        None,
    );
    write_state(&app, &state)?;
    Ok(overview_from_state(&state, false, false))
}

#[tauri::command]
pub fn archive_configure_google_drive_command(
    app: AppHandle,
    input: GoogleDriveConfigurationInput,
) -> Result<ArchiveOverview, String> {
    validate_google_config(&input)?;
    let mut state = read_state(&app)?;
    let client_changed = state.settings.google_drive.client_id != input.client_id.trim();
    if client_changed {
        clear_google_tokens()?;
        clear_google_client_secret()?;
        state.settings.google_drive.client_secret_configured = false;
        state.settings.google_drive.account_email = None;
        state.settings.google_drive.root_folder_id = None;
        state.settings.google_drive.folder_ids.clear();
        state.settings.google_drive.quota_limit_bytes = None;
        state.settings.google_drive.quota_used_bytes = None;
        state.settings.google_drive.last_verified_at = None;
    }
    if !input.client_secret.trim().is_empty() {
        write_google_client_secret(&input.client_secret)?;
        if read_google_client_secret()?.is_none() {
            return Err("No pude confirmar el Client Secret en el Llavero de macOS. FARO no abrió Google para evitar una conexión incompleta.".to_string());
        }
        state.settings.google_drive.client_secret_configured = true;
    }
    state.settings.google_drive.client_id = input.client_id.trim().to_string();
    state.settings.google_drive.last_connection_error = None;
    // Desktop OAuth uses a new loopback URI on an ephemeral 127.0.0.1 port
    // every time. This legacy field stays blank for backwards-compatible
    // state deserialization, never as an externally registered callback.
    state.settings.google_drive.redirect_uri.clear();
    // No client secret, token or refresh token is persisted in this JSON.
    // OAuth credentials belong in the macOS Keychain when the interactive
    // connector is completed.
    add_event(&mut state, "google_configured", "Se guardó la configuración local de Google Drive. FARO solicitará sólo drive.file al conectar.".to_string(), None);
    write_state(&app, &state)?;
    Ok(overview_from_state(&state, false, false))
}

#[tauri::command]
pub fn archive_purge_faro_trash_command(
    app: AppHandle,
    item_ids: Vec<String>,
    confirmation: String,
) -> Result<ArchivePurgeResult, String> {
    if item_ids.is_empty() || item_ids.len() > MAX_PURGE_ITEMS {
        return Err(format!(
            "Selecciona entre 1 y {MAX_PURGE_ITEMS} archivos de la Papelera FARO."
        ));
    }
    if confirmation.trim().to_uppercase() != "ELIMINAR" {
        return Err(
            "Escribe ELIMINAR para confirmar el borrado permanente de estos registros de FARO."
                .to_string(),
        );
    }
    let home = user_home()?;
    let mut state = read_state(&app)?;
    let reconciled = reconcile_faro_trash(&mut state, &home);
    let now = now_seconds();
    let mut purged_count = 0;
    let mut reclaimed_bytes = 0_u64;
    let mut failed = Vec::new();
    for item_id in item_ids {
        let Some(item) = state.trash_items.iter_mut().find(|item| item.id == item_id) else {
            failed.push("Un elemento ya no pertenece a la Papelera FARO.".to_string());
            continue;
        };
        if item.status != "trashed" {
            failed.push(format!("{} ya no está disponible para purga.", item.name));
            continue;
        }
        if now < item.grace_ends_at {
            failed.push(format!(
                "{} sigue dentro de su periodo de gracia.",
                item.name
            ));
            continue;
        }
        let path = PathBuf::from(&item.trash_path);
        match trash_path_is_owned(&path, &home) {
            Ok(true) => match remove_owned_trash_entry(&path) {
                Ok(()) => {
                    item.status = "purged".to_string();
                    item.purged_at = Some(now);
                    purged_count += 1;
                    reclaimed_bytes = reclaimed_bytes.saturating_add(item.bytes);
                }
                Err(error) => failed.push(format!("{}: {error}", item.name)),
            },
            Ok(false) => failed.push(format!(
                "{} no está en una ruta segura de la Papelera FARO.",
                item.name
            )),
            Err(_) => {
                item.status = "missing".to_string();
                failed.push(format!(
                    "{} ya no está disponible en la Papelera de macOS.",
                    item.name
                ));
            }
        }
    }
    if purged_count > 0 {
        add_event(
            &mut state,
            "permanently_deleted",
            format!(
                "Se eliminaron permanentemente {purged_count} elemento(s) gobernados por FARO."
            ),
            None,
        );
    }
    if reconciled > 0 {
        failed.push(format!(
            "{reconciled} registro(s) ya no estaban en la Papelera de macOS y se retiraron de FARO."
        ));
    }
    write_state(&app, &state)?;
    Ok(ArchivePurgeResult {
        purged_count,
        reclaimed_bytes,
        failed,
    })
}

#[cfg(test)]
mod tests {
    use super::{base64_url, is_sensitive_name, query_values, url_decode};

    #[test]
    fn sensitive_files_are_hard_blocked() {
        assert!(is_sensitive_name(".env"));
        assert!(is_sensitive_name("deploy.pem"));
        assert!(is_sensitive_name("google_client_secret.json"));
        assert!(!is_sensitive_name("ideas-septiembre.pdf"));
    }

    #[test]
    fn pkce_base64_is_url_safe_and_unpadded() {
        assert_eq!(base64_url(b"f"), "Zg");
        assert_eq!(base64_url(b"fo"), "Zm8");
        assert_eq!(base64_url(b"foo"), "Zm9v");
    }

    #[test]
    fn loopback_query_decoding_handles_google_callback_values() {
        let values = query_values("code=abc%2F123&state=safe-state&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file").expect("valid callback");
        assert_eq!(values.get("code").map(String::as_str), Some("abc/123"));
        assert_eq!(values.get("state").map(String::as_str), Some("safe-state"));
        assert_eq!(url_decode("FARO+Archive"), Ok("FARO Archive".to_string()));
    }
}
