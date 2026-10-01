use std::{
    collections::HashMap,
    env, fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::archive;

// Keep the scan bounded, but leave enough room after excluding development
// dependencies so regular personal folders can be covered in one pass.
const MAX_SCANNED_ENTRIES: usize = 240_000;
const MAX_CANDIDATES: usize = 80;
const MAX_ACCUMULATION_DETAIL_ITEMS: usize = 100;
const MAX_TRASH_SUMMARY_ENTRIES: usize = 80_000;
const MAX_BROWSER_SCANNED_ENTRIES: usize = 80_000;
const MAX_BROWSER_ENTRIES: usize = 600;
// A folder such as Desktop can have tens of thousands of direct children. Read
// enough of that one level to rank the heaviest files before returning the
// compact, usable 600-row view to the UI.
const MAX_BROWSER_DIRECT_ENTRIES: usize = 30_000;
const MAX_APPLICATION_SCANNED_ENTRIES: usize = 100_000;
const MAX_APPLICATIONS: usize = 80;
const MAX_INTELLIGENCE_SCANNED_ENTRIES: usize = 72_000;
const MAX_DEVELOPMENT_ARTIFACTS: usize = 60;
const MINIMUM_OPERATING_FREE_BYTES: u64 = 25 * 1024 * 1024 * 1024;
const MEBIBYTE: u64 = 1024 * 1024;

/// The UI never sends filesystem paths to the destructive command. A path is
/// eligible for the Trash only when it was returned by the latest local scan.
#[derive(Default)]
pub struct StorageScanState {
    trash_targets: Mutex<HashMap<String, StorageTrashTarget>>,
    browse_targets: Mutex<HashMap<String, StorageBrowseTarget>>,
}

#[derive(Clone)]
struct StorageTrashTarget {
    path: PathBuf,
    bytes: u64,
    scope: StorageTargetScope,
}

#[derive(Clone)]
enum StorageTargetScope {
    Personal,
    Application,
    Regenerable,
    /// A direct child of a user-maintained Library root, such as Application
    /// Support or Caches.  These are deliberately narrower than arbitrary
    /// Library paths: FARO may only move the whole top-level folder to Trash.
    MaintenanceFolder,
    Inspection,
}

#[derive(Clone)]
struct StorageBrowseTarget {
    folder_id: String,
    root_name: String,
    path: PathBuf,
    can_manage: bool,
    can_manage_folders: bool,
}

#[derive(Clone)]
struct StorageRoot {
    id: &'static str,
    name: &'static str,
    path: PathBuf,
}

#[derive(Clone)]
struct CandidateDraft {
    name: String,
    path: PathBuf,
    bytes: u64,
    modified_at: u64,
    age_days: u64,
    area: String,
    kind: String,
    reason: String,
}

#[derive(Clone)]
struct BrowserEntryDraft {
    id: String,
    name: String,
    path: PathBuf,
    bytes: u64,
    modified_at: u64,
    is_directory: bool,
    file_count: u64,
    scan_complete: bool,
    suggested_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    total_bytes: u64,
    used_bytes: u64,
    free_bytes: u64,
    scanned_at: u64,
    folders: Vec<StorageFolderSummary>,
    candidates: Vec<StorageCandidate>,
    screenshots: Vec<StorageCandidate>,
    apps: Vec<StorageApp>,
    apps_scan_limited: bool,
    trash: StorageTrashSummary,
    scanned_entries: usize,
    scan_limited: bool,
    warnings: Vec<String>,
    intelligence: StorageIntelligence,
}

/// A capacity-only response intentionally avoids scanning user files when a
/// compact surface such as Dashboard only needs disk pressure.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCapacity {
    total_bytes: u64,
    used_bytes: u64,
    free_bytes: u64,
    minimum_operating_free_bytes: u64,
    health: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageIntelligence {
    classified_bytes: u64,
    unexplained_bytes: u64,
    manageable_bytes: u64,
    protected_bytes: u64,
    recoverable_bytes: u64,
    minimum_free_bytes: u64,
    bytes_to_operating_margin: u64,
    health: String,
    categories: Vec<StorageCategory>,
    accumulations: Vec<StorageAccumulation>,
    development: Vec<StorageDevelopmentArtifact>,
    recovery_plan: Vec<StorageRecoveryStep>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCategory {
    id: String,
    name: String,
    bytes: u64,
    potentially_recoverable_bytes: u64,
    managed_by_faro: bool,
    protected: bool,
    scan_complete: bool,
    note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageAccumulation {
    id: String,
    name: String,
    bytes: u64,
    file_count: u64,
    oldest_age_days: u64,
    risk: String,
    reason: String,
    items: Vec<StorageCandidate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDevelopmentArtifact {
    id: String,
    name: String,
    path: String,
    project: String,
    bytes: u64,
    modified_at: u64,
    kind: String,
    lifecycle: String,
    scan_complete: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRecoveryStep {
    id: String,
    name: String,
    bytes: u64,
    lifecycle: String,
    reason: String,
}

#[derive(Default)]
struct AccumulationDraft {
    name: String,
    bytes: u64,
    file_count: u64,
    oldest_age_days: u64,
    risk: String,
    reason: String,
    items: Vec<CandidateDraft>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageTrashSummary {
    bytes: u64,
    file_count: u64,
    scan_complete: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageFolderSummary {
    id: String,
    name: String,
    path: String,
    bytes: u64,
    file_count: u64,
    scan_complete: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCandidate {
    id: String,
    name: String,
    path: String,
    bytes: u64,
    modified_at: u64,
    age_days: u64,
    area: String,
    kind: String,
    reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageFolderBrowser {
    folder_id: String,
    root_name: String,
    path: String,
    entries: Vec<StorageBrowserEntry>,
    scanned_entries: usize,
    scan_complete: bool,
    can_manage: bool,
    can_manage_folders: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageBrowserEntry {
    id: String,
    name: String,
    path: String,
    bytes: u64,
    modified_at: u64,
    age_days: u64,
    kind: String,
    is_directory: bool,
    can_move_to_trash: bool,
    file_count: u64,
    scan_complete: bool,
    suggested_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageApp {
    id: String,
    name: String,
    path: String,
    bytes: u64,
    modified_at: u64,
    last_accessed_at: Option<u64>,
    activity_age_days: Option<u64>,
    scan_complete: bool,
    classification: String,
    removal_reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageTrashResult {
    moved_count: usize,
    reclaimed_bytes: u64,
    failed: Vec<String>,
    warnings: Vec<String>,
}

/// A local file is exposed to Archive only through the most recent bounded
/// scan. The frontend never supplies a filesystem path for backup or archive.
pub struct ArchiveLocalSource {
    pub path: PathBuf,
    pub bytes: u64,
    pub is_directory: bool,
}

fn user_home() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| "No fue posible resolver tu carpeta de usuario.".to_string())
}

fn root_path(
    home: &Path,
    default_name: &'static str,
    localized_name: &'static str,
) -> Option<PathBuf> {
    let default_path = home.join(default_name);
    if default_path.is_dir() {
        Some(default_path)
    } else {
        let localized_path = home.join(localized_name);
        localized_path.is_dir().then_some(localized_path)
    }
}

fn storage_roots(home: &Path) -> Vec<StorageRoot> {
    let mut roots = Vec::new();
    for (id, name, english, spanish) in [
        ("downloads", "Descargas", "Downloads", "Descargas"),
        ("desktop", "Escritorio", "Desktop", "Escritorio"),
        ("documents", "Documentos", "Documents", "Documentos"),
        ("movies", "Videos", "Movies", "Películas"),
        ("pictures", "Fotos", "Pictures", "Imágenes"),
        ("developer", "Developer", "Developer", "Desarrollador"),
        ("projects", "Proyectos", "Projects", "Proyectos"),
        ("code", "Code", "Code", "Código"),
    ] {
        if let Some(path) = root_path(home, english, spanish) {
            if !roots.iter().any(|root: &StorageRoot| root.path == path) {
                roots.push(StorageRoot { id, name, path });
            }
        }
    }
    roots
}

fn disk_space(path: &Path) -> Result<(u64, u64, u64), String> {
    let output = Command::new("/bin/df")
        .args(["-k", &path.display().to_string()])
        .output()
        .map_err(|error| format!("No pude consultar el espacio del disco: {error}"))?;
    if !output.status.success() {
        return Err("macOS no pudo consultar el espacio del disco.".to_string());
    }
    let output_text = String::from_utf8_lossy(&output.stdout);
    let line = output_text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .last()
        .ok_or_else(|| "No recibí datos del disco.".to_string())?;
    let parts = line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 4 {
        return Err("Los datos del disco no tienen el formato esperado.".to_string());
    }
    let total = parts[1]
        .parse::<u64>()
        .map_err(|_| "No pude leer el tamaño total del disco.".to_string())?
        * 1024;
    let free = parts[3]
        .parse::<u64>()
        .map_err(|_| "No pude leer el espacio disponible del disco.".to_string())?
        * 1024;
    // On APFS `df` reports the used blocks for the Data volume, but the
    // remaining container space may be occupied by sibling system volumes,
    // snapshots or purgeable data.  Its `Used` and `Available` fields often
    // do not add up to the displayed total.  For the operating question the
    // UI answers ("how much room can I actually reclaim/use?"), total minus
    // available matches macOS System Settings much more closely.
    let used = total.saturating_sub(free);
    Ok((total, used, free))
}

fn storage_health(free_bytes: u64) -> &'static str {
    if free_bytes >= MINIMUM_OPERATING_FREE_BYTES {
        "saludable"
    } else if free_bytes >= MINIMUM_OPERATING_FREE_BYTES / 2 {
        "precaucion"
    } else if free_bytes >= MINIMUM_OPERATING_FREE_BYTES / 4 {
        "bajo"
    } else {
        "critico"
    }
}

fn timestamp(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn accessed_timestamp(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .accessed()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .filter(|value| *value > 0)
}

fn age_days(modified_at: u64) -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_sub(modified_at)
        / 86_400
}

fn should_skip_directory(path: &Path, home: &Path) -> bool {
    let relative = path.strip_prefix(home).unwrap_or(path);
    // These folders may exist inside a project on Desktop, not only directly
    // under the user home. Checking only `relative.starts_with("node_modules")`
    // made one project consume the entire scan budget before FARO reached the
    // rest of the user's files.
    let internal_directory_names = [".ssh", ".aws", ".gnupg", ".Trash", ".git", "node_modules"];
    if relative.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| internal_directory_names.contains(&name))
    }) {
        return true;
    }
    let sensitive_roots = [
        "Library/Keychains",
        "Library/CloudStorage",
        "Library/Mobile Documents",
    ];
    if sensitive_roots
        .iter()
        .any(|blocked| relative.starts_with(blocked))
    {
        return true;
    }
    // A Photos Library is a macOS-managed package/database, not a regular
    // folder of images. Traversing it makes the scan hit TCC-protected files
    // and incorrectly report that FARO cannot read Photos. Normal images
    // stored beside the library in Pictures remain visible and manageable.
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("photoslibrary"))
    {
        return true;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn candidate_for(
    root: &StorageRoot,
    path: &Path,
    bytes: u64,
    modified_at: u64,
) -> Option<CandidateDraft> {
    let age_days = age_days(modified_at);
    let extension = extension(path);
    let installer = ["dmg", "pkg", "iso", "msi", "appimage"].contains(&extension.as_str());
    let archive = ["zip", "rar", "7z", "tar", "gz", "bz2"].contains(&extension.as_str());
    let video = ["mov", "mp4", "mkv", "avi", "m4v"].contains(&extension.as_str());
    let download_candidate = root.id == "downloads" && bytes >= 50 * MEBIBYTE && age_days >= 14;
    let installer_candidate = installer && bytes >= 25 * MEBIBYTE && age_days >= 14;
    let archive_candidate = archive && bytes >= 50 * MEBIBYTE && age_days >= 21;
    let video_candidate = video && bytes >= 350 * MEBIBYTE && age_days >= 45;
    let large_candidate = bytes >= 700 * MEBIBYTE && age_days >= 45;
    if !(download_candidate
        || installer_candidate
        || archive_candidate
        || video_candidate
        || large_candidate)
    {
        return None;
    }

    let (kind, reason) = if installer_candidate {
        (
            "Instalador".to_string(),
            format!("Instalador de {age_days} días; quizá ya no lo necesitas."),
        )
    } else if archive_candidate {
        (
            "Archivo comprimido".to_string(),
            format!("Archivo comprimido sin cambios desde hace {age_days} días."),
        )
    } else if download_candidate {
        (
            "Descarga".to_string(),
            format!("Descarga grande sin cambios desde hace {age_days} días."),
        )
    } else if video_candidate {
        (
            "Video".to_string(),
            format!("Video grande sin cambios desde hace {age_days} días."),
        )
    } else {
        (
            "Archivo grande".to_string(),
            format!("Archivo grande sin cambios desde hace {age_days} días."),
        )
    };
    Some(CandidateDraft {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Archivo")
            .to_string(),
        path: path.to_path_buf(),
        bytes,
        modified_at,
        age_days,
        area: root.name.to_string(),
        kind,
        reason,
    })
}

fn add_accumulation(
    groups: &mut HashMap<String, AccumulationDraft>,
    id: &str,
    name: &str,
    risk: &str,
    reason: &str,
    item: CandidateDraft,
) {
    let group = groups
        .entry(id.to_string())
        .or_insert_with(|| AccumulationDraft {
            name: name.to_string(),
            risk: risk.to_string(),
            reason: reason.to_string(),
            ..AccumulationDraft::default()
        });
    group.bytes = group.bytes.saturating_add(item.bytes);
    group.file_count += 1;
    group.oldest_age_days = group.oldest_age_days.max(item.age_days);
    group.items.push(item);
}

fn collect_accumulation(
    root: &StorageRoot,
    path: &Path,
    bytes: u64,
    modified_at: u64,
    groups: &mut HashMap<String, AccumulationDraft>,
) {
    let ext = extension(path);
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let group = if name.contains("screenshot") || name.contains("captura de pantalla") {
        Some((
            "screenshots",
            "Capturas de pantalla",
            "bajo",
            "Agrupadas por nombre; revísalas antes de decidir.",
            "Captura de pantalla",
        ))
    } else if ["dmg", "pkg", "iso", "msi", "appimage"].contains(&ext.as_str()) {
        Some((
            "installers",
            "Instaladores",
            "bajo",
            "Instaladores encontrados en rutas personales.",
            "Instalador",
        ))
    } else if ["zip", "rar", "7z", "tar", "gz", "bz2"].contains(&ext.as_str()) {
        Some((
            "archives",
            "ZIPs y archivos comprimidos",
            "medio",
            "Un comprimido puede contener material importante; abre primero en Finder.",
            "Archivo comprimido",
        ))
    } else if ["log", "tmp", "temp", "cache"].contains(&ext.as_str()) {
        Some((
            "temporary",
            "Logs y temporales",
            "bajo",
            "Archivos temporales detectados fuera de rutas protegidas.",
            "Temporal",
        ))
    } else if root.id == "downloads" && age_days(modified_at) >= 60 {
        Some((
            "old-downloads",
            "Descargas antiguas",
            "medio",
            "Descargas sin cambios por más de 60 días.",
            "Descarga antigua",
        ))
    } else {
        None
    };
    if let Some((id, group_name, risk, reason, kind)) = group {
        add_accumulation(
            groups,
            id,
            group_name,
            risk,
            reason,
            CandidateDraft {
                name: path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Archivo")
                    .to_string(),
                path: path.to_path_buf(),
                bytes,
                modified_at,
                age_days: age_days(modified_at),
                area: root.name.to_string(),
                kind: kind.to_string(),
                reason: reason.to_string(),
            },
        );
    }
}

fn screenshot_candidate_for(
    root: &StorageRoot,
    path: &Path,
    bytes: u64,
    modified_at: u64,
) -> Option<CandidateDraft> {
    if !matches!(root.id, "desktop" | "downloads" | "documents" | "pictures") {
        return None;
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_screenshot = file_name.contains("captura de pantalla")
        || file_name.contains("screenshot")
        || file_name.contains("screen shot");
    let age_days = age_days(modified_at);
    // Fresh captures are usually active context. This queue starts after two
    // weeks and never decides that a capture is disposable by itself.
    if !is_screenshot || age_days < 14 {
        return None;
    }
    Some(CandidateDraft {
        name: path.file_name().and_then(|value| value.to_str()).unwrap_or("Captura de pantalla").to_string(),
        path: path.to_path_buf(), bytes, modified_at, age_days,
        area: root.name.to_string(), kind: "Captura de pantalla".to_string(),
        reason: format!("Captura sin cambios desde hace {age_days} días; revísala, archívala o envíala a Papelera."),
    })
}

fn development_root(root: &StorageRoot) -> bool {
    matches!(root.id, "developer" | "projects" | "code")
}

fn development_scan_root(root: &StorageRoot) -> bool {
    // Many personal projects live on Desktop instead of ~/Developer.  This
    // only looks for known regenerable directory names, never source files.
    development_root(root) || root.id == "desktop"
}

fn should_skip_development_directory(path: &Path, home: &Path) -> bool {
    let relative = path.strip_prefix(home).unwrap_or(path);
    if [".ssh", ".aws", ".gnupg", ".Trash", ".git"]
        .iter()
        .any(|blocked| {
            relative
                .components()
                .any(|component| component.as_os_str() == *blocked)
        })
    {
        return true;
    }
    [
        "Library/Keychains",
        "Library/CloudStorage",
        "Library/Mobile Documents",
    ]
    .iter()
    .any(|blocked| relative.starts_with(blocked))
}

fn scan_root(
    root: &StorageRoot,
    home: &Path,
    remaining_entries: &mut usize,
    warnings: &mut Vec<String>,
    candidates: &mut Vec<CandidateDraft>,
    screenshots: &mut Vec<CandidateDraft>,
    accumulations: &mut HashMap<String, AccumulationDraft>,
) -> StorageFolderSummary {
    let mut bytes = 0_u64;
    let mut file_count = 0_u64;
    let mut scan_complete = true;
    let mut stack = vec![root.path.clone()];

    while let Some(directory) = stack.pop() {
        if *remaining_entries == 0 {
            scan_complete = false;
            break;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => {
                if warnings.len() < 4 {
                    let message = if root.id == "photos" {
                        "No pude leer una parte de Fotos. Las Fototecas de Apple se conservan protegidas; FARO sí revisa imágenes sueltas en Fotos.".to_string()
                    } else {
                        format!("No pude leer una parte de {}.", root.name)
                    };
                    if !warnings.contains(&message) {
                        warnings.push(message);
                    }
                }
                continue;
            }
        };
        for entry in entries.flatten() {
            if *remaining_entries == 0 {
                scan_complete = false;
                break;
            }
            *remaining_entries -= 1;
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if (development_root(root) && !should_skip_development_directory(&path, home))
                    || (!development_root(root) && !should_skip_directory(&path, home))
                {
                    stack.push(path);
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let size = metadata.len();
            let modified_at = timestamp(&metadata);
            bytes = bytes.saturating_add(size);
            file_count += 1;
            if let Some(candidate) = candidate_for(root, &path, size, modified_at) {
                candidates.push(candidate);
            }
            if let Some(screenshot) = screenshot_candidate_for(root, &path, size, modified_at) {
                screenshots.push(screenshot);
            }
            collect_accumulation(root, &path, size, modified_at, accumulations);
        }
    }

    StorageFolderSummary {
        id: root.id.to_string(),
        name: root.name.to_string(),
        path: root.path.display().to_string(),
        bytes,
        file_count,
        scan_complete,
    }
}

fn development_artifact_kind(path: &Path) -> Option<&'static str> {
    match path.file_name().and_then(|value| value.to_str())? {
        "node_modules" => Some("node_modules"),
        "dist" | "build" | ".next" | ".vite" | ".cache" | "coverage" => Some("build o caché"),
        ".venv" | "venv" | "__pycache__" | ".pytest_cache" | ".mypy_cache" => {
            Some("entorno Python")
        }
        "target" => Some("build Rust/Tauri"),
        ".gradle" => Some("Gradle"),
        _ => None,
    }
}

fn development_project_name(path: &Path, root: &StorageRoot) -> String {
    path.parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .filter(|name| *name != root.name)
        .unwrap_or(root.name)
        .to_string()
}

fn scan_development_artifacts(
    roots: &[StorageRoot],
    home: &Path,
) -> (Vec<StorageDevelopmentArtifact>, bool) {
    let mut remaining = MAX_INTELLIGENCE_SCANNED_ENTRIES;
    let mut complete = true;
    let mut artifacts = Vec::new();
    for root in roots.iter().filter(|root| development_scan_root(root)) {
        let mut stack = vec![root.path.clone()];
        while let Some(directory) = stack.pop() {
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.flatten() {
                if remaining == 0 || artifacts.len() >= MAX_DEVELOPMENT_ARTIFACTS {
                    complete = false;
                    break;
                }
                remaining -= 1;
                let path = entry.path();
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_symlink() || !file_type.is_dir() {
                    continue;
                }
                if let Some(kind) = development_artifact_kind(&path) {
                    let metadata = match entry.metadata() {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    let (bytes, _files, artifact_complete) =
                        scan_directory_bytes(&path, home, &mut remaining, false);
                    artifacts.push(StorageDevelopmentArtifact {
                        id: candidate_id(&path, bytes, timestamp(&metadata)),
                        name: path
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or("Artefacto")
                            .to_string(),
                        path: path.display().to_string(),
                        project: development_project_name(&path, root),
                        bytes,
                        modified_at: timestamp(&metadata),
                        kind: kind.to_string(),
                        lifecycle: "regenerate".to_string(),
                        scan_complete: artifact_complete,
                    });
                    if !artifact_complete {
                        complete = false;
                    }
                    continue;
                }
                if !should_skip_development_directory(&path, home) {
                    stack.push(path);
                }
            }
            if !complete {
                break;
            }
        }
        if !complete {
            break;
        }
    }
    artifacts.sort_by(|left, right| {
        right
            .bytes
            .cmp(&left.bytes)
            .then_with(|| left.path.cmp(&right.path))
    });
    (artifacts, complete)
}

fn limited_directory_bytes(path: &Path, home: &Path, remaining: &mut usize) -> (u64, bool) {
    if !path.is_dir() || *remaining == 0 {
        return (0, false);
    }
    let (bytes, _files, complete) = scan_directory_bytes(path, home, remaining, true);
    (bytes, complete)
}

fn folder_bytes(folders: &[StorageFolderSummary], ids: &[&str]) -> (u64, bool) {
    let selected = folders
        .iter()
        .filter(|folder| ids.contains(&folder.id.as_str()))
        .collect::<Vec<_>>();
    (
        selected
            .iter()
            .fold(0_u64, |sum, folder| sum.saturating_add(folder.bytes)),
        selected.iter().all(|folder| folder.scan_complete),
    )
}

fn build_intelligence(
    home: &Path,
    used_bytes: u64,
    free_bytes: u64,
    folders: &[StorageFolderSummary],
    apps: &[StorageApp],
    trash: &StorageTrashSummary,
    accumulations: HashMap<String, AccumulationDraft>,
    development: Vec<StorageDevelopmentArtifact>,
    development_complete: bool,
    archive_local_bytes: u64,
    archive_local_complete: bool,
    vault_local_bytes: u64,
    vault_local_complete: bool,
) -> StorageIntelligence {
    let (downloads, downloads_complete) = folder_bytes(folders, &["downloads"]);
    let (personal, personal_complete) =
        folder_bytes(folders, &["desktop", "documents", "movies", "pictures"]);
    let (development_bytes, development_root_complete) =
        folder_bytes(folders, &["developer", "projects", "code"]);
    let apps_bytes = apps
        .iter()
        .fold(0_u64, |sum, app| sum.saturating_add(app.bytes));
    let apps_complete = apps.iter().all(|app| app.scan_complete);
    let mut library_remaining = MAX_INTELLIGENCE_SCANNED_ENTRIES;
    let (app_data_raw, app_data_complete) = limited_directory_bytes(
        &home.join("Library/Application Support"),
        home,
        &mut library_remaining,
    );
    let (caches, caches_complete) =
        limited_directory_bytes(&home.join("Library/Caches"), home, &mut library_remaining);
    // The FARO local state normally lives inside Application Support. Avoid
    // showing it twice; if the broad scan was partial this is conservative.
    let app_data = app_data_raw
        .saturating_sub(archive_local_bytes)
        .saturating_sub(vault_local_bytes);
    let accumulation_items = accumulations
        .into_iter()
        .map(|(id, mut group)| {
            group.items.sort_by(|left, right| {
                right
                    .bytes
                    .cmp(&left.bytes)
                    .then_with(|| right.age_days.cmp(&left.age_days))
                    .then_with(|| left.name.cmp(&right.name))
            });
            group.items.truncate(MAX_ACCUMULATION_DETAIL_ITEMS);
            StorageAccumulation {
                id,
                name: group.name,
                bytes: group.bytes,
                file_count: group.file_count,
                oldest_age_days: group.oldest_age_days,
                risk: group.risk,
                reason: group.reason,
                items: group
                    .items
                    .into_iter()
                    .map(storage_candidate_from_draft)
                    .collect(),
            }
        })
        .collect::<Vec<_>>();
    let mut accumulation_items = accumulation_items;
    accumulation_items.sort_by(|left, right| {
        right
            .bytes
            .cmp(&left.bytes)
            .then_with(|| left.name.cmp(&right.name))
    });
    accumulation_items.truncate(10);
    let artifact_recoverable = development
        .iter()
        .fold(0_u64, |sum, item| sum.saturating_add(item.bytes));
    // Some artifacts live inside Desktop/Document projects and are therefore
    // already counted as personal bytes.  Show their recoverable amount in
    // the Development card without adding it again to classified_bytes.
    let development_display_bytes = development_bytes.max(artifact_recoverable);
    let candidate_sum = accumulations_recoverable(&accumulation_items);
    let classified_bytes = downloads
        .saturating_add(personal)
        .saturating_add(development_bytes)
        .saturating_add(apps_bytes)
        .saturating_add(app_data)
        .saturating_add(caches)
        .saturating_add(archive_local_bytes)
        .saturating_add(vault_local_bytes);
    let unexplained_bytes = used_bytes.saturating_sub(classified_bytes);
    let manageable_bytes = classified_bytes;
    let protected_bytes = unexplained_bytes;
    let recoverable_bytes = artifact_recoverable
        .saturating_add(candidate_sum)
        .saturating_add(trash.bytes);
    let mut categories = vec![
        StorageCategory {
            id: "applications".to_string(),
            name: "Aplicaciones".to_string(),
            bytes: apps_bytes,
            potentially_recoverable_bytes: 0,
            managed_by_faro: true,
            protected: false,
            scan_complete: apps_complete,
            note: "Paquetes en Aplicaciones y ~/Aplicaciones.".to_string(),
        },
        StorageCategory {
            id: "app-data".to_string(),
            name: "Datos de aplicaciones".to_string(),
            bytes: app_data,
            potentially_recoverable_bytes: 0,
            managed_by_faro: true,
            protected: false,
            scan_complete: app_data_complete,
            note: "Application Support; no incluye llaveros ni nubes protegidas.".to_string(),
        },
        StorageCategory {
            id: "development".to_string(),
            name: "Desarrollo".to_string(),
            bytes: development_display_bytes,
            potentially_recoverable_bytes: artifact_recoverable,
            managed_by_faro: true,
            protected: false,
            scan_complete: development_root_complete && development_complete,
            note: if artifact_recoverable > development_bytes {
                "Artefactos regenerables detectados dentro de rutas personales; no se suman dos veces.".to_string()
            } else {
                "Código y artefactos de proyectos detectados.".to_string()
            },
        },
        StorageCategory {
            id: "personal".to_string(),
            name: "Archivos personales".to_string(),
            bytes: personal,
            potentially_recoverable_bytes: 0,
            managed_by_faro: true,
            protected: false,
            scan_complete: personal_complete,
            note: "Escritorio, Documentos, Fotos y Videos.".to_string(),
        },
        StorageCategory {
            id: "caches".to_string(),
            name: "Caches y temporales".to_string(),
            bytes: caches,
            potentially_recoverable_bytes: candidate_sum,
            managed_by_faro: true,
            protected: false,
            scan_complete: caches_complete,
            note: "Lectura acotada de Library/Caches.".to_string(),
        },
        StorageCategory {
            id: "downloads".to_string(),
            name: "Descargas e instaladores".to_string(),
            bytes: downloads,
            potentially_recoverable_bytes: candidate_sum,
            managed_by_faro: true,
            protected: false,
            scan_complete: downloads_complete,
            note: "Descargas personales y acumulaciones detectadas.".to_string(),
        },
        StorageCategory {
            id: "faro-archive-local".to_string(),
            name: "FARO Archive local".to_string(),
            bytes: archive_local_bytes,
            potentially_recoverable_bytes: 0,
            managed_by_faro: true,
            protected: false,
            scan_complete: archive_local_complete,
            note: "Estado local de FARO; no se borra desde recomendaciones.".to_string(),
        },
        StorageCategory {
            id: "faro-vault-local".to_string(),
            name: "FARO Vault cifrado".to_string(),
            bytes: vault_local_bytes,
            potentially_recoverable_bytes: 0,
            managed_by_faro: false,
            protected: true,
            scan_complete: vault_local_complete,
            note: "Datos de seguridad cifrados; FARO Vault nunca se muestra para limpiar, archivar o mover.".to_string(),
        },
        StorageCategory {
            id: "system-apfs".to_string(),
            name: "Otros / Sistema / APFS".to_string(),
            bytes: unexplained_bytes,
            potentially_recoverable_bytes: 0,
            managed_by_faro: false,
            protected: true,
            scan_complete: true,
            note: "Diferencia real no atribuida: macOS, APFS, snapshots y metadatos.".to_string(),
        },
    ];
    categories.sort_by(|left, right| right.bytes.cmp(&left.bytes));
    let mut recovery_plan = development
        .iter()
        .map(|item| StorageRecoveryStep {
            id: item.id.clone(),
            name: format!("{} · {}", item.project, item.name),
            bytes: item.bytes,
            lifecycle: "regenerate".to_string(),
            reason: "Artefacto regenerable; revisa el proyecto antes de limpiar.".to_string(),
        })
        .collect::<Vec<_>>();
    recovery_plan.extend(accumulation_items.iter().map(|item| StorageRecoveryStep {
        id: format!("accumulation-{}", item.id),
        name: item.name.clone(),
        bytes: item.bytes,
        lifecycle: if item.id == "archives" {
            "archive".to_string()
        } else {
            "review".to_string()
        },
        reason: item.reason.clone(),
    }));
    recovery_plan.sort_by(|left, right| right.bytes.cmp(&left.bytes));
    recovery_plan.truncate(6);
    let health = if free_bytes >= MINIMUM_OPERATING_FREE_BYTES {
        "saludable"
    } else if free_bytes >= MINIMUM_OPERATING_FREE_BYTES / 2 {
        "precaucion"
    } else if free_bytes >= MINIMUM_OPERATING_FREE_BYTES / 4 {
        "bajo"
    } else {
        "critico"
    };
    StorageIntelligence {
        classified_bytes: classified_bytes.min(used_bytes),
        unexplained_bytes,
        manageable_bytes: manageable_bytes.min(used_bytes),
        protected_bytes,
        recoverable_bytes,
        minimum_free_bytes: MINIMUM_OPERATING_FREE_BYTES,
        bytes_to_operating_margin: MINIMUM_OPERATING_FREE_BYTES.saturating_sub(free_bytes),
        health: health.to_string(),
        categories,
        accumulations: accumulation_items,
        development,
        recovery_plan,
    }
}

fn accumulations_recoverable(groups: &[StorageAccumulation]) -> u64 {
    groups
        .iter()
        .filter(|item| {
            matches!(
                item.id.as_str(),
                "installers" | "temporary" | "old-downloads"
            )
        })
        .fold(0_u64, |sum, item| sum.saturating_add(item.bytes))
}

fn browse_id(path: &Path, bytes: u64, modified_at: u64, is_directory: bool) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    bytes.hash(&mut hasher);
    modified_at.hash(&mut hasher);
    is_directory.hash(&mut hasher);
    format!("browser-{:016x}", hasher.finish())
}

fn app_id(path: &Path, bytes: u64, modified_at: u64) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    bytes.hash(&mut hasher);
    modified_at.hash(&mut hasher);
    format!("app-{:016x}", hasher.finish())
}

fn scan_directory_bytes(
    path: &Path,
    home: &Path,
    remaining_entries: &mut usize,
    skip_internal: bool,
) -> (u64, u64, bool) {
    let mut bytes = 0_u64;
    let mut file_count = 0_u64;
    let mut complete = true;
    let mut stack = vec![path.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if *remaining_entries == 0 {
                complete = false;
                break;
            }
            *remaining_entries -= 1;
            let entry_path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if !skip_internal || !should_skip_directory(&entry_path, home) {
                    stack.push(entry_path);
                }
                continue;
            }
            if file_type.is_file() {
                if let Ok(metadata) = entry.metadata() {
                    bytes = bytes.saturating_add(metadata.len());
                    file_count += 1;
                }
            }
        }
        if !complete {
            break;
        }
    }
    (bytes, file_count, complete)
}

fn storage_root_by_id(home: &Path, folder_id: &str) -> Option<StorageRoot> {
    storage_roots(home)
        .into_iter()
        .find(|root| root.id == folder_id)
}

fn inspectable_library_root(home: &Path, folder_id: &str) -> Option<StorageBrowseTarget> {
    let (name, path) = match folder_id {
        "app-data" => (
            "Datos de aplicaciones",
            home.join("Library/Application Support"),
        ),
        "caches" => ("Caches y temporales", home.join("Library/Caches")),
        _ => return None,
    };
    path.is_dir().then_some(StorageBrowseTarget {
        folder_id: folder_id.to_string(),
        root_name: name.to_string(),
        path,
        can_manage: false,
        // Application Support and Caches can be very useful to reclaim, but
        // their individual contents are not safe to treat as generic files.
        // FARO exposes only their direct application folders for a deliberate
        // move to the macOS Trash.
        can_manage_folders: true,
    })
}

fn valid_browse_path(target: &StorageBrowseTarget, home: &Path) -> bool {
    if target.can_manage {
        return valid_personal_path(&target.path, home);
    }
    let Ok(canonical) = target.path.canonicalize() else {
        return false;
    };
    let permitted = [
        home.join("Library/Application Support"),
        home.join("Library/Caches"),
    ];
    permitted.into_iter().any(|root| {
        root.canonicalize()
            .ok()
            .is_some_and(|root| canonical.starts_with(root))
    }) && !should_skip_directory(&canonical, home)
}

fn browse_target_for(
    app: &AppHandle,
    home: &Path,
    folder_id: &str,
    parent_id: Option<&str>,
) -> Result<StorageBrowseTarget, String> {
    if let Some(parent_id) = parent_id {
        let target = app.state::<StorageScanState>()
            .browse_targets
            .lock()
            .map_err(|_| "No pude abrir el explorador de archivos.".to_string())?
            .get(parent_id)
            .cloned()
            .ok_or_else(|| "Esa carpeta ya no forma parte de la exploración. Vuelve a abrir la carpeta principal.".to_string())?;
        if target.folder_id != folder_id {
            return Err("La carpeta solicitada no coincide con esta exploración.".to_string());
        }
        return Ok(target);
    }

    if let Some(root) = inspectable_library_root(home, folder_id) {
        return Ok(root);
    }
    let root = storage_root_by_id(home, folder_id)
        .ok_or_else(|| "No encontré esa carpeta personal. Actualiza el análisis.".to_string())?;
    Ok(StorageBrowseTarget {
        folder_id: root.id.to_string(),
        root_name: root.name.to_string(),
        path: root.path,
        can_manage: true,
        can_manage_folders: true,
    })
}

fn browser_for_folder(
    target: &StorageBrowseTarget,
    home: &Path,
) -> Result<
    (
        StorageFolderBrowser,
        Vec<(String, StorageBrowseTarget)>,
        Vec<(String, StorageTrashTarget)>,
    ),
    String,
> {
    if !target.path.is_dir() || !valid_browse_path(target, home) {
        return Err(
            "La carpeta cambió desde el último análisis. Actualiza la vista antes de explorarla."
                .to_string(),
        );
    }

    let root = StorageRoot {
        id: "browser",
        name: "Esta carpeta",
        path: target.path.clone(),
    };
    let mut remaining_entries = MAX_BROWSER_SCANNED_ENTRIES;
    let mut scan_complete = true;
    let mut drafts = Vec::new();
    let entries = fs::read_dir(&target.path)
        .map_err(|error| format!("No pude leer esta carpeta: {error}"))?;

    for entry in entries.flatten().take(MAX_BROWSER_DIRECT_ENTRIES) {
        if remaining_entries == 0 {
            scan_complete = false;
            break;
        }
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() || (file_type.is_dir() && should_skip_directory(&path, home)) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let is_directory = file_type.is_dir();
        let modified_at = timestamp(&metadata);
        let (bytes, file_count, item_complete) = if is_directory {
            scan_directory_bytes(&path, home, &mut remaining_entries, true)
        } else {
            remaining_entries = remaining_entries.saturating_sub(1);
            (metadata.len(), 1, remaining_entries > 0)
        };
        if remaining_entries == 0 {
            scan_complete = false;
        }
        let suggested_reason = if is_directory {
            None
        } else {
            candidate_for(&root, &path, bytes, modified_at).map(|candidate| candidate.reason)
        };
        drafts.push(BrowserEntryDraft {
            id: browse_id(&path, bytes, modified_at, is_directory),
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Elemento")
                .to_string(),
            path,
            bytes,
            modified_at,
            is_directory,
            file_count,
            scan_complete: item_complete,
            suggested_reason,
        });
        if remaining_entries == 0 {
            break;
        }
    }

    // `read_dir` does not promise a useful ordering. If the direct-entry cap
    // was hit, make the partial result explicit instead of suggesting that the
    // first files returned by the filesystem are the complete folder.
    if drafts.len() >= MAX_BROWSER_DIRECT_ENTRIES {
        scan_complete = false;
    }

    drafts.sort_by(|left, right| {
        right
            .bytes
            .cmp(&left.bytes)
            .then_with(|| left.name.cmp(&right.name))
    });
    let scanned_entries = MAX_BROWSER_SCANNED_ENTRIES.saturating_sub(remaining_entries);
    let mut browser_targets = Vec::new();
    let mut trash_targets = Vec::new();
    let entries = drafts
        .into_iter()
        .take(MAX_BROWSER_ENTRIES)
        .map(|draft| {
            let can_move_to_trash = if draft.is_directory {
                target.can_manage_folders
                    && (target.can_manage || valid_maintenance_folder_path(&draft.path, home))
                    && !archive::is_sensitive_path(&draft.path)
            } else {
                target.can_manage && !archive::is_sensitive_path(&draft.path)
            };
            if draft.is_directory {
                browser_targets.push((
                    draft.id.clone(),
                    StorageBrowseTarget {
                        folder_id: target.folder_id.clone(),
                        root_name: target.root_name.clone(),
                        path: draft.path.clone(),
                        can_manage: target.can_manage,
                        // Folder-level cleanup is allowed only at the
                        // immediate root. Nested app data stays inspect-only.
                        can_manage_folders: false,
                    },
                ));
                if can_move_to_trash {
                    trash_targets.push((
                        draft.id.clone(),
                        StorageTrashTarget {
                            path: draft.path.clone(),
                            bytes: draft.bytes,
                            scope: if target.can_manage {
                                StorageTargetScope::Personal
                            } else {
                                StorageTargetScope::MaintenanceFolder
                            },
                        },
                    ));
                }
            } else {
                trash_targets.push((
                    draft.id.clone(),
                    StorageTrashTarget {
                        path: draft.path.clone(),
                        bytes: draft.bytes,
                        scope: if target.can_manage {
                            StorageTargetScope::Personal
                        } else {
                            StorageTargetScope::Inspection
                        },
                    },
                ));
            }
            StorageBrowserEntry {
                id: draft.id,
                name: draft.name,
                path: draft.path.display().to_string(),
                bytes: draft.bytes,
                modified_at: draft.modified_at,
                age_days: age_days(draft.modified_at),
                kind: if draft.is_directory {
                    "Carpeta".to_string()
                } else {
                    "Archivo".to_string()
                },
                is_directory: draft.is_directory,
                can_move_to_trash,
                file_count: draft.file_count,
                scan_complete: draft.scan_complete,
                suggested_reason: draft.suggested_reason,
            }
        })
        .collect();

    Ok((
        StorageFolderBrowser {
            folder_id: target.folder_id.clone(),
            root_name: target.root_name.clone(),
            path: target.path.display().to_string(),
            entries,
            scanned_entries,
            scan_complete,
            can_manage: target.can_manage,
            can_manage_folders: target.can_manage_folders,
        },
        browser_targets,
        trash_targets,
    ))
}

fn application_roots(home: &Path) -> Vec<PathBuf> {
    [PathBuf::from("/Applications"), home.join("Applications")]
        .into_iter()
        .filter(|path| path.is_dir())
        .collect()
}

fn scan_applications(home: &Path) -> (Vec<StorageApp>, bool, Vec<(String, StorageTrashTarget)>) {
    let mut remaining_entries = MAX_APPLICATION_SCANNED_ENTRIES;
    let mut complete = true;
    let mut apps = Vec::new();
    let mut targets = Vec::new();

    for root in application_roots(home) {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            if apps.len() >= MAX_APPLICATIONS || remaining_entries == 0 {
                complete = false;
                break;
            }
            let path = entry.path();
            let is_app = path.is_dir()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("app"));
            if !is_app {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let modified_at = timestamp(&metadata);
            let last_accessed_at = accessed_timestamp(&metadata);
            let (bytes, _files, app_complete) =
                scan_directory_bytes(&path, home, &mut remaining_entries, false);
            if !app_complete {
                complete = false;
            }
            let id = app_id(&path, bytes, modified_at);
            let name = path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Aplicación")
                .to_string();
            let (classification, removal_reason) = application_classification(&path, &name);
            targets.push((
                id.clone(),
                StorageTrashTarget {
                    path: path.clone(),
                    bytes,
                    scope: StorageTargetScope::Application,
                },
            ));
            apps.push(StorageApp {
                id,
                name,
                path: path.display().to_string(),
                bytes,
                modified_at,
                last_accessed_at,
                activity_age_days: last_accessed_at.map(age_days),
                scan_complete: app_complete,
                classification: classification.to_string(),
                removal_reason: removal_reason.to_string(),
            });
        }
        if !complete {
            break;
        }
    }
    apps.sort_by(|left, right| {
        right
            .bytes
            .cmp(&left.bytes)
            .then_with(|| left.name.cmp(&right.name))
    });
    (apps, !complete, targets)
}

fn candidate_id(path: &Path, bytes: u64, modified_at: u64) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    bytes.hash(&mut hasher);
    modified_at.hash(&mut hasher);
    format!("storage-{:016x}", hasher.finish())
}

fn storage_candidate_from_draft(draft: CandidateDraft) -> StorageCandidate {
    let id = candidate_id(&draft.path, draft.bytes, draft.modified_at);
    StorageCandidate {
        id,
        name: draft.name,
        path: draft.path.display().to_string(),
        bytes: draft.bytes,
        modified_at: draft.modified_at,
        age_days: draft.age_days,
        area: draft.area,
        kind: draft.kind,
        reason: draft.reason,
    }
}

fn valid_personal_path(path: &Path, home: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    if canonical == home || !canonical.starts_with(home) {
        return false;
    }
    !should_skip_directory(&canonical, home)
}

fn valid_application_path(path: &Path, home: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    let direct_application = canonical.parent().is_some_and(|parent| {
        parent == Path::new("/Applications") || parent == home.join("Applications")
    });
    direct_application
        && canonical.is_dir()
        && canonical
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        && application_classification(
            &canonical,
            canonical
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default(),
        )
        .0 != "SYSTEM_PROTECTED"
}

fn application_classification(path: &Path, name: &str) -> (&'static str, &'static str) {
    if path.starts_with("/System")
        || matches!(
            name,
            "Safari" | "Finder" | "System Settings" | "App Store" | "Terminal"
        )
    {
        return (
            "SYSTEM_PROTECTED",
            "Protegida por macOS; FARO no permite moverla.",
        );
    }
    if matches!(
        name,
        "Keynote" | "Pages" | "Numbers" | "GarageBand" | "iMovie"
    ) {
        return (
            "APPLE_REMOVABLE",
            "App de Apple removible; macOS puede pedir permisos o impedir el movimiento.",
        );
    }
    (
        "NORMAL_REMOVABLE",
        "Paquete de aplicación revisable; sus datos asociados no se eliminan automáticamente.",
    )
}

fn valid_regenerable_path(path: &Path, home: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    canonical.starts_with(home)
        && canonical.is_dir()
        && development_artifact_kind(&canonical).is_some()
        && !should_skip_development_directory(&canonical, home)
}

/// A maintenance folder must be exactly one direct child of an explicitly
/// exposed Library root.  This prevents the browser from minting destructive
/// capabilities for arbitrary nested Library data.
fn valid_maintenance_folder_path(path: &Path, home: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    if !canonical.is_dir() || should_skip_directory(&canonical, home) {
        return false;
    }
    let protected_names = ["com.faroos.desktop", "com.faroos.desktop.archive"];
    if canonical
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| protected_names.contains(&name))
    {
        return false;
    }
    [
        home.join("Library/Application Support"),
        home.join("Library/Caches"),
    ]
    .into_iter()
    .filter_map(|root| root.canonicalize().ok())
    .any(|root| canonical.parent().is_some_and(|parent| parent == root))
}

fn valid_target(target: &StorageTrashTarget, home: &Path) -> bool {
    match target.scope {
        StorageTargetScope::Personal => valid_personal_path(&target.path, home),
        StorageTargetScope::Application => valid_application_path(&target.path, home),
        StorageTargetScope::Regenerable => valid_regenerable_path(&target.path, home),
        StorageTargetScope::MaintenanceFolder => valid_maintenance_folder_path(&target.path, home),
        StorageTargetScope::Inspection => false,
    }
}

fn valid_reveal_target(target: &StorageTrashTarget, home: &Path) -> bool {
    if !matches!(target.scope, StorageTargetScope::Inspection) {
        return valid_target(target, home);
    }
    let inspect_target = StorageBrowseTarget {
        folder_id: "inspection".to_string(),
        root_name: "inspection".to_string(),
        path: target.path.clone(),
        can_manage: false,
        can_manage_folders: false,
    };
    valid_browse_path(&inspect_target, home)
}

fn target_for(app: &AppHandle, candidate_id: &str) -> Result<StorageTrashTarget, String> {
    app.state::<StorageScanState>()
        .trash_targets
        .lock()
        .map_err(|_| "No pude abrir la cola de limpieza.".to_string())?
        .get(candidate_id)
        .cloned()
        .ok_or_else(|| {
            "Ese elemento ya no está en la cola de limpieza. Actualiza el escaneo.".to_string()
        })
}

fn reveal(path: &Path) -> Result<(), String> {
    let output = Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .output()
        .map_err(|error| format!("No pude abrir Finder: {error}"))?;
    output
        .status
        .success()
        .then_some(())
        .ok_or_else(|| "Finder no pudo mostrar ese archivo.".to_string())
}

fn trash_destination(path: &Path, home: &Path) -> Result<PathBuf, String> {
    let trash = home.join(".Trash");
    fs::create_dir_all(&trash)
        .map_err(|error| format!("No pude preparar la Papelera de macOS: {error}"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "El archivo no tiene un nombre válido.".to_string())?;
    let initial = trash.join(file_name);
    if !initial.exists() {
        return Ok(initial);
    }

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Archivo");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty());
    for index in 1..10_000 {
        let name = extension
            .map(|extension| format!("{stem} {index}.{extension}"))
            .unwrap_or_else(|| format!("{stem} {index}"));
        let candidate = trash.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("No pude elegir un nombre libre en la Papelera.".to_string())
}

fn move_to_user_trash(path: &Path, home: &Path) -> Result<PathBuf, String> {
    let destination = trash_destination(path, home)?;
    fs::rename(path, &destination)
        .map_err(|error| format!("La Papelera local no pudo recibir el archivo: {error}"))?;
    Ok(destination)
}

fn move_to_trash(path: &Path, home: &Path) -> Result<PathBuf, String> {
    // FARO moves directly into the current user's Trash instead of asking
    // Finder to do it. That gives the Archive ledger the exact destination it
    // must later validate before any permanent purge. The item remains fully
    // recoverable through Finder's native Trash UI.
    move_to_user_trash(path, home)
}

fn trash_summary(home: &Path) -> StorageTrashSummary {
    let trash = home.join(".Trash");
    let Ok(entries) = fs::read_dir(&trash) else {
        return StorageTrashSummary {
            bytes: 0,
            file_count: 0,
            scan_complete: true,
        };
    };
    let mut bytes = 0_u64;
    let mut file_count = 0_u64;
    let mut remaining = MAX_TRASH_SUMMARY_ENTRIES;
    let mut stack = entries
        .flatten()
        .map(|entry| entry.path())
        .collect::<Vec<_>>();

    while let Some(path) = stack.pop() {
        if remaining == 0 {
            return StorageTrashSummary {
                bytes,
                file_count,
                scan_complete: false,
            };
        }
        remaining -= 1;
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() || metadata.is_file() {
            bytes = bytes.saturating_add(metadata.len());
            file_count += 1;
        } else if metadata.is_dir() {
            if let Ok(entries) = fs::read_dir(path) {
                stack.extend(entries.flatten().map(|entry| entry.path()));
            }
        }
    }
    StorageTrashSummary {
        bytes,
        file_count,
        scan_complete: true,
    }
}

#[tauri::command]
pub async fn storage_capacity_command() -> Result<StorageCapacity, String> {
    tauri::async_runtime::spawn_blocking(move || storage_capacity_command_blocking())
        .await
        .map_err(|error| format!("No pude completar la operación de almacenamiento: {error}"))?
}

fn storage_capacity_command_blocking() -> Result<StorageCapacity, String> {
    let home = user_home()?;
    let (total_bytes, used_bytes, free_bytes) = disk_space(&home)?;
    Ok(StorageCapacity {
        total_bytes,
        used_bytes,
        free_bytes,
        minimum_operating_free_bytes: MINIMUM_OPERATING_FREE_BYTES,
        health: storage_health(free_bytes).to_string(),
    })
}

#[tauri::command]
pub async fn scan_storage_command(app: AppHandle) -> Result<StorageOverview, String> {
    tauri::async_runtime::spawn_blocking(move || scan_storage_command_blocking(app))
        .await
        .map_err(|error| format!("No pude completar la operación de almacenamiento: {error}"))?
}

fn scan_storage_command_blocking(app: AppHandle) -> Result<StorageOverview, String> {
    let home = user_home()?;
    let mut remaining_entries = MAX_SCANNED_ENTRIES;
    let mut warnings = Vec::new();
    let trash = trash_summary(&home);
    let mut drafts = Vec::new();
    let mut screenshot_drafts = Vec::new();
    let mut accumulation_drafts = HashMap::new();
    let mut folders = storage_roots(&home)
        .iter()
        .map(|root| {
            scan_root(
                root,
                &home,
                &mut remaining_entries,
                &mut warnings,
                &mut drafts,
                &mut screenshot_drafts,
                &mut accumulation_drafts,
            )
        })
        .collect::<Vec<_>>();
    folders.sort_by(|left, right| right.bytes.cmp(&left.bytes));
    drafts.sort_by(|left, right| {
        right
            .bytes
            .cmp(&left.bytes)
            .then_with(|| right.age_days.cmp(&left.age_days))
    });
    drafts.truncate(MAX_CANDIDATES);
    screenshot_drafts.sort_by(|left, right| {
        right
            .bytes
            .cmp(&left.bytes)
            .then_with(|| right.age_days.cmp(&left.age_days))
    });
    screenshot_drafts.truncate(MAX_CANDIDATES);
    let (apps, apps_scan_limited, app_targets) = scan_applications(&home);
    let (development, development_complete) =
        scan_development_artifacts(&storage_roots(&home), &home);
    let development_targets = development
        .iter()
        .map(|artifact| {
            (
                artifact.id.clone(),
                StorageTrashTarget {
                    path: PathBuf::from(&artifact.path),
                    bytes: artifact.bytes,
                    scope: StorageTargetScope::Regenerable,
                },
            )
        })
        .collect::<Vec<_>>();
    let (archive_local_bytes, archive_local_complete, vault_local_bytes, vault_local_complete) = app
        .path()
        .app_data_dir()
        .ok()
        .map(|path| {
            let archive = path.join("faro-archive-v1.json");
            let vault = path.join("faro-vault-v1.enc");
            let archive_bytes = fs::metadata(&archive).map(|metadata| metadata.len()).unwrap_or(0);
            let vault_bytes = fs::metadata(&vault).map(|metadata| metadata.len()).unwrap_or(0);
            (archive_bytes, archive.is_file(), vault_bytes, vault.is_file())
        })
        .unwrap_or((0, false, 0, false));
    // Read disk capacity after traversing the roots. Finder may have finished
    // a move while this scan was in flight, so the headline reflects the most
    // recent filesystem state instead of the state at scan start.
    let (total_bytes, used_bytes, free_bytes) = disk_space(&home)?;
    let scanned_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let intelligence = build_intelligence(
        &home,
        used_bytes,
        free_bytes,
        &folders,
        &apps,
        &trash,
        accumulation_drafts,
        development,
        development_complete,
        archive_local_bytes,
        archive_local_complete,
        vault_local_bytes,
        vault_local_complete,
    );

    let storage_state = app.state::<StorageScanState>();
    let mut targets = storage_state
        .trash_targets
        .lock()
        .map_err(|_| "No pude preparar la cola de limpieza.".to_string())?;
    targets.clear();
    storage_state
        .browse_targets
        .lock()
        .map_err(|_| "No pude preparar el explorador de archivos.".to_string())?
        .clear();
    let candidates = drafts
        .into_iter()
        .map(|draft| {
            let id = candidate_id(&draft.path, draft.bytes, draft.modified_at);
            targets.insert(
                id.clone(),
                StorageTrashTarget {
                    path: draft.path.clone(),
                    bytes: draft.bytes,
                    scope: StorageTargetScope::Personal,
                },
            );
            StorageCandidate {
                id,
                name: draft.name,
                path: draft.path.display().to_string(),
                bytes: draft.bytes,
                modified_at: draft.modified_at,
                age_days: draft.age_days,
                area: draft.area,
                kind: draft.kind,
                reason: draft.reason,
            }
        })
        .collect();
    let screenshots = screenshot_drafts
        .into_iter()
        .map(|draft| {
            let id = candidate_id(&draft.path, draft.bytes, draft.modified_at);
            targets.insert(
                id.clone(),
                StorageTrashTarget {
                    path: draft.path.clone(),
                    bytes: draft.bytes,
                    scope: StorageTargetScope::Personal,
                },
            );
            StorageCandidate {
                id,
                name: draft.name,
                path: draft.path.display().to_string(),
                bytes: draft.bytes,
                modified_at: draft.modified_at,
                age_days: draft.age_days,
                area: draft.area,
                kind: draft.kind,
                reason: draft.reason,
            }
        })
        .collect();
    // Detailed accumulation rows are also first-class, scan-bound targets.
    // This lets the user open, back up, archive or send the exact item to
    // Trash without ever accepting a path from the frontend.
    for group in &intelligence.accumulations {
        for item in &group.items {
            targets.insert(
                item.id.clone(),
                StorageTrashTarget {
                    path: PathBuf::from(&item.path),
                    bytes: item.bytes,
                    scope: StorageTargetScope::Personal,
                },
            );
        }
    }
    for (id, target) in app_targets {
        targets.insert(id, target);
    }
    for (id, target) in development_targets {
        targets.insert(id, target);
    }

    if remaining_entries == 0 {
        warnings.push("El escaneo se detuvo al llegar a 240,000 elementos para no afectar tu Mac. Aun así se muestran los resultados encontrados.".to_string());
    }
    Ok(StorageOverview {
        total_bytes,
        used_bytes,
        free_bytes,
        scanned_at,
        folders,
        candidates,
        screenshots,
        apps,
        apps_scan_limited,
        trash,
        scanned_entries: MAX_SCANNED_ENTRIES.saturating_sub(remaining_entries),
        scan_limited: remaining_entries == 0,
        warnings,
        intelligence,
    })
}

#[tauri::command]
pub async fn storage_browse_folder_command(
    app: AppHandle,
    folder_id: String,
    parent_id: Option<String>,
) -> Result<StorageFolderBrowser, String> {
    tauri::async_runtime::spawn_blocking(move || storage_browse_folder_command_blocking(app, folder_id, parent_id))
        .await
        .map_err(|error| format!("No pude completar la operación de almacenamiento: {error}"))?
}

fn storage_browse_folder_command_blocking(
    app: AppHandle,
    folder_id: String,
    parent_id: Option<String>,
) -> Result<StorageFolderBrowser, String> {
    let home = user_home()?;
    let target = browse_target_for(&app, &home, &folder_id, parent_id.as_deref())?;
    let (browser, browser_targets, trash_targets) = browser_for_folder(&target, &home)?;
    let storage_state = app.state::<StorageScanState>();

    {
        let mut targets = storage_state
            .browse_targets
            .lock()
            .map_err(|_| "No pude preparar el explorador de archivos.".to_string())?;
        for (id, child) in browser_targets {
            targets.insert(id, child);
        }
    }
    {
        let mut targets = storage_state
            .trash_targets
            .lock()
            .map_err(|_| "No pude preparar la limpieza de archivos.".to_string())?;
        for (id, child) in trash_targets {
            targets.insert(id, child);
        }
    }
    Ok(browser)
}

#[tauri::command]
pub fn storage_reveal_folder_command(
    app: AppHandle,
    folder_id: String,
    parent_id: Option<String>,
) -> Result<(), String> {
    let home = user_home()?;
    let target = browse_target_for(&app, &home, &folder_id, parent_id.as_deref())?;
    if !valid_browse_path(&target, &home) {
        return Err(
            "La carpeta cambió desde el último escaneo. Actualiza la vista antes de gestionarla."
                .to_string(),
        );
    }
    reveal(&target.path)
}

#[tauri::command]
pub fn storage_reveal_item_command(app: AppHandle, candidate_id: String) -> Result<(), String> {
    let target = target_for(&app, &candidate_id)?;
    let home = user_home()?;
    if !valid_reveal_target(&target, &home) {
        return Err(
            "El elemento cambió desde el último escaneo. Actualiza la vista antes de gestionarlo."
                .to_string(),
        );
    }
    reveal(&target.path)
}

pub fn archive_source_for(
    app: &AppHandle,
    candidate_id: &str,
) -> Result<ArchiveLocalSource, String> {
    let target = target_for(app, candidate_id)?;
    let home = user_home()?;
    if !matches!(target.scope, StorageTargetScope::Personal)
        || !valid_personal_path(&target.path, &home)
        || archive::is_sensitive_path(&target.path)
    {
        return Err("Ese elemento no se puede enviar a FARO Archive. Actualiza el análisis y elige un archivo o carpeta personal no sensible.".to_string());
    }
    let metadata = fs::metadata(&target.path).map_err(|_| {
        "El archivo cambió desde el análisis. Actualiza antes de enviarlo a Archive.".to_string()
    })?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err("Ese elemento ya no es un archivo o carpeta que FARO pueda archivar.".to_string());
    }
    if metadata.is_file() && metadata.len() != target.bytes {
        return Err("El archivo cambió desde el análisis. FARO no lo enviará hasta que lo revises de nuevo.".to_string());
    }
    Ok(ArchiveLocalSource {
        path: target.path,
        bytes: target.bytes,
        is_directory: metadata.is_dir(),
    })
}

pub fn archive_move_verified_source_to_trash(
    app: &AppHandle,
    candidate_id: &str,
    archive_item_id: &str,
    verified_bytes: u64,
) -> Result<PathBuf, String> {
    let target = target_for(app, candidate_id)?;
    let home = user_home()?;
    if !matches!(target.scope, StorageTargetScope::Personal)
        || !valid_personal_path(&target.path, &home)
        || archive::is_sensitive_path(&target.path)
    {
        return Err(
            "El archivo ya no es elegible para Archive. No se movió nada a la Papelera."
                .to_string(),
        );
    }
    let metadata = fs::metadata(&target.path).map_err(|_| {
        "El archivo ya no existe en su ruta local. No se movió nada a la Papelera.".to_string()
    })?;
    if (!metadata.is_file() && !metadata.is_dir())
        || (metadata.is_file() && metadata.len() != target.bytes)
    {
        return Err(
            "El elemento cambió durante el respaldo. No se movió nada a la Papelera.".to_string(),
        );
    }
    let trash_path = move_to_trash(&target.path, &home)?;
    if let Err(error) = archive::record_faro_archive_trash(
        app,
        &target.path,
        &trash_path,
        verified_bytes,
        archive_item_id,
    ) {
        // Archive is only allowed to claim that it governs the local move
        // after the ledger write succeeds. If that write fails, put the
        // original back instead of leaving an untracked item in macOS Trash.
        return match fs::rename(&trash_path, &target.path) {
            Ok(()) => Err(format!(
                "No pude registrar el movimiento en la Papelera FARO ({error}). Restauré el original en su carpeta."
            )),
            Err(restore_error) => Err(format!(
                "La copia remota se verificó, pero no pude registrar el movimiento local ({error}) ni devolver el original ({restore_error}). Revisa la Papelera de macOS antes de continuar."
            )),
        };
    }
    if let Ok(mut targets) = app.state::<StorageScanState>().trash_targets.lock() {
        targets.remove(candidate_id);
    }
    Ok(trash_path)
}

#[tauri::command]
pub async fn storage_move_to_trash_command(
    app: AppHandle,
    candidate_ids: Vec<String>,
) -> Result<StorageTrashResult, String> {
    tauri::async_runtime::spawn_blocking(move || storage_move_to_trash_command_blocking(app, candidate_ids))
        .await
        .map_err(|error| format!("No pude completar la operación de almacenamiento: {error}"))?
}

fn storage_move_to_trash_command_blocking(
    app: AppHandle,
    candidate_ids: Vec<String>,
) -> Result<StorageTrashResult, String> {
    if candidate_ids.is_empty() || candidate_ids.len() > 100 {
        return Err(
            "Selecciona entre 1 y 100 elementos por tanda para moverlos a la Papelera.".to_string(),
        );
    }
    let home = user_home()?;
    let mut moved_count = 0;
    let mut reclaimed_bytes = 0_u64;
    let mut failed = Vec::new();
    let mut warnings = Vec::new();
    let mut moved_ids = Vec::new();

    for candidate_id in candidate_ids {
        let target = match target_for(&app, &candidate_id) {
            Ok(target) => target,
            Err(error) => {
                failed.push(error);
                continue;
            }
        };
        if !valid_target(&target, &home) {
            failed.push(format!(
                "{} cambió desde el escaneo.",
                target.path.display()
            ));
            continue;
        }
        if archive::is_sensitive_path(&target.path) {
            failed.push(format!(
                "{} está protegido por la política de archivos sensibles de FARO.",
                target
                    .path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("Archivo")
            ));
            continue;
        }
        match move_to_trash(&target.path, &home) {
            Ok(trash_path) => {
                moved_count += 1;
                reclaimed_bytes = reclaimed_bytes.saturating_add(target.bytes);
                if let Err(error) = archive::record_faro_trash(
                    &app,
                    &target.path,
                    &trash_path,
                    target.bytes,
                    "Limpieza local seleccionada por ti",
                ) {
                    warnings.push(format!(
                        "{} se movió, pero FARO no pudo registrarlo para una purga futura: {error}",
                        target
                            .path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or("Archivo")
                    ));
                }
                moved_ids.push(candidate_id);
            }
            Err(error) => failed.push(format!(
                "{}: {error}",
                target
                    .path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("Archivo")
            )),
        }
    }
    if !moved_ids.is_empty() {
        let storage_state = app.state::<StorageScanState>();
        let mut targets = storage_state
            .trash_targets
            .lock()
            .map_err(|_| "No pude actualizar la cola de limpieza.".to_string())?;
        for id in moved_ids {
            targets.remove(&id);
        }
    }
    Ok(StorageTrashResult {
        moved_count,
        reclaimed_bytes,
        failed,
        warnings,
    })
}
