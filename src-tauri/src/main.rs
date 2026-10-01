use std::{
    env, fs,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::Duration,
};

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2::runtime::Bool;
#[cfg(target_os = "macos")]
use objc2_foundation::{NSError, NSString};
#[cfg(target_os = "macos")]
use objc2_local_authentication::{LAContext, LAPolicy};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutoStartManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod mini;
mod archive;
mod storage;
mod vault;

const MAIN_LABEL: &str = "main";
const MINI_LABEL: &str = "mini";
const MINI_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const SESSION_SERVICE: &str = "com.faroos.desktop.supabase";
const WAKE_MODEL_FILE: &str = "wake/hola_faro.onnx";
const COMPUTER_CONFIG_FILE: &str = "computer-config.json";
const COMPUTER_OBSERVABILITY_FILE: &str = "computer-observability.jsonl";

#[derive(Default)]
struct DesktopLifecycle {
    quitting: AtomicBool,
}

#[derive(Default)]
struct VoiceSnapshotState {
    snapshot: Mutex<Option<Value>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBiometricStatus {
    available: bool,
    reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPreferences {
    wake_enabled: bool,
    wake_threshold: f32,
    launch_at_login: bool,
    notifications_enabled: bool,
    calendar_lead_minutes: u16,
    mini_always_on_top: bool,
    #[serde(default)]
    mini_visibility_version: u8,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            wake_enabled: false,
            wake_threshold: 0.84,
            launch_at_login: false,
            notifications_enabled: false,
            calendar_lead_minutes: 10,
            mini_always_on_top: true,
            mini_visibility_version: 1,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPreferencesPatch {
    wake_enabled: Option<bool>,
    wake_threshold: Option<f32>,
    launch_at_login: Option<bool>,
    notifications_enabled: Option<bool>,
    calendar_lead_minutes: Option<u16>,
    mini_always_on_top: Option<bool>,
}

impl DesktopPreferences {
    fn apply(&mut self, patch: DesktopPreferencesPatch) {
        if let Some(value) = patch.wake_enabled {
            self.wake_enabled = value;
        }
        if let Some(value) = patch.wake_threshold {
            self.wake_threshold = value.clamp(0.5, 0.99);
        }
        if let Some(value) = patch.launch_at_login {
            self.launch_at_login = value;
        }
        if let Some(value) = patch.notifications_enabled {
            self.notifications_enabled = value;
        }
        if let Some(value) = patch.calendar_lead_minutes {
            self.calendar_lead_minutes = value.clamp(1, 120);
        }
        if let Some(value) = patch.mini_always_on_top {
            self.mini_always_on_top = value;
        }
    }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("desktop-preferences.json"))
}

fn read_preferences(app: &AppHandle) -> Result<DesktopPreferences, String> {
    let path = preferences_path(app)?;
    match fs::read(path) {
        Ok(bytes) => {
            let mut preferences: DesktopPreferences = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
            if preferences.mini_visibility_version == 0 {
                preferences.mini_always_on_top = true;
                preferences.mini_visibility_version = 1;
                write_preferences(app, &preferences)?;
            }
            Ok(preferences)
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(DesktopPreferences::default())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn write_preferences(app: &AppHandle, preferences: &DesktopPreferences) -> Result<(), String> {
    let path = preferences_path(app)?;
    let data = serde_json::to_vec_pretty(preferences).map_err(|error| error.to_string())?;
    fs::write(path, data).map_err(|error| error.to_string())
}

fn computer_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(COMPUTER_CONFIG_FILE))
}

fn default_computer_config() -> Value {
    json!({
        "version": 1,
        "enabled": true,
        "projects": [],
        "automations": [],
        "focusPreferences": { "defaultDurationMinutes": 45, "defaultBreakDurationMinutes": 15, "enableDoNotDisturb": false },
        "layouts": [],
        "doNotDisturb": { "state": "unknown" }
    })
}

fn validate_computer_config(config: &Value) -> Result<(), String> {
    let Some(object) = config.as_object() else {
        return Err("La configuración de Computer no es válida.".to_string());
    };
    if object.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("La versión de Computer no es compatible.".to_string());
    }
    if !object.get("enabled").is_some_and(Value::is_boolean) {
        return Err("La configuración de Computer requiere enabled.".to_string());
    }
    for field in ["projects", "automations", "layouts"] {
        if object
            .get(field)
            .and_then(Value::as_array)
            .is_none_or(|items| items.len() > 80)
        {
            return Err("La configuración de Computer contiene demasiados elementos.".to_string());
        }
    }
    Ok(())
}

fn read_computer_config(app: &AppHandle) -> Result<Value, String> {
    let path = computer_config_path(app)?;
    match fs::read(path) {
        Ok(bytes) => {
            let config: Value =
                serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
            validate_computer_config(&config)?;
            Ok(config)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(default_computer_config()),
        Err(error) => Err(error.to_string()),
    }
}

static COMPUTER_CONFIG_WRITE: Mutex<()> = Mutex::new(());

fn write_computer_config(app: &AppHandle, config: &Value) -> Result<(), String> {
    let _guard = COMPUTER_CONFIG_WRITE.lock().map_err(|e| e.to_string())?;
    validate_computer_config(config)?;
    let previous = read_computer_config(app)?;
    let data = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    fs::write(computer_config_path(app)?, data).map_err(|error| error.to_string())?;
    if let Some(message) = mini::focus_announcement(&previous, config) {
        mini::announce_focus(app, message);
    }
    app.emit("faro://computer-config", config.clone())
        .map_err(|error| error.to_string())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComputerToolRequest {
    tool: String,
    arguments: Value,
    route: String,
    llm_used: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComputerToolResponse {
    success: bool,
    message: String,
    tool: String,
    safety_level: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    permission_hint: Option<String>,
}

/// Platform adapter behind the portable Computer Tool Registry. The web layer
/// submits only a named tool plus validated data; this adapter never receives
/// a shell command or model-produced executable text.
struct MacOSComputerAdapter;

impl MacOSComputerAdapter {
    fn execute(
        app: &AppHandle,
        request: &ComputerToolRequest,
    ) -> Result<ComputerToolResponse, String> {
        execute_macos_computer_tool(app, request)
    }
}

fn computer_safety_level(tool: &str) -> Result<u8, String> {
    match tool {
        "listRunningApps" | "isAppRunning" | "findFile" | "getDoNotDisturbStatus" => Ok(0),
        "openApp" | "focusApp" | "setVolume" | "volumeUp" | "volumeDown" | "mute" | "unmute"
        | "brightnessUp" | "brightnessDown" | "setBrightness" | "setNightShift"
        | "setDoNotDisturb" | "openFile" | "openUrl" | "revealInFinder" | "createFolder"
        | "focusWindow" | "arrangeWorkLayout" => Ok(1),
        "closeApp" | "lockComputer" => Ok(2),
        _ => Err("Computer Tool no permitido.".to_string()),
    }
}

fn computer_response(
    tool: &str,
    message: impl Into<String>,
    data: Option<Value>,
) -> Result<ComputerToolResponse, String> {
    Ok(ComputerToolResponse {
        success: true,
        message: message.into(),
        tool: tool.to_string(),
        safety_level: computer_safety_level(tool)?,
        data,
        permission_hint: None,
    })
}

fn allowed_app_name(value: &str) -> Result<String, String> {
    let value = value
        .trim()
        .trim_end_matches(['.', '!', '?', ',', ';', ':'])
        .trim();
    if value.is_empty()
        || value.chars().count() > 100
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ' ' | '-' | '_' | '.' | '+')
        })
    {
        return Err("El nombre de la aplicación no es válido.".to_string());
    }
    let normalized = value.to_ascii_lowercase();
    let canonical = match normalized.as_str() {
        "finder" | "el finder" => "Finder",
        "chrome" | "google chrome" | "el chrome" => "Google Chrome",
        "spotify" | "spoty" => "Spotify",
        "safari" => "Safari",
        "code" | "vs code" | "visual studio code" | "visual studio" => "Visual Studio Code",
        "terminal" => "Terminal",
        _ => value,
    };
    Ok(canonical.to_string())
}

fn safe_shortcut_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > 120
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ' ' | '-' | '_' | '.')
        })
    {
        return Err("El nombre del Shortcut de concentración no es válido.".to_string());
    }
    Ok(value.to_string())
}

fn args_object(value: &Value) -> Result<&serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| "Los argumentos de Computer no son válidos.".to_string())
}

fn argument_string(args: &serde_json::Map<String, Value>, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Falta {key} para Computer."))
}

fn run_process(program: &str, args: &[String]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        let reason = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if reason.is_empty() {
            format!("macOS no pudo completar la operación ({program}).")
        } else {
            reason
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_osascript(script: String) -> Result<String, String> {
    run_process("/usr/bin/osascript", &["-e".to_string(), script])
}

fn user_home() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| "No fue posible resolver el directorio de usuario de macOS.".to_string())
}

fn approved_existing_path(value: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(value);
    if !candidate.is_absolute()
        || candidate
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("La ruta debe ser absoluta y no puede salir de su carpeta.".to_string());
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "No encontramos esa ruta local.".to_string())?;
    let home = user_home()?;
    if !canonical.starts_with(&home) {
        return Err(
            "Por seguridad, FARO sólo abre archivos dentro de tu directorio de usuario."
                .to_string(),
        );
    }
    if canonical.starts_with(home.join(".ssh"))
        || canonical.starts_with(home.join(".aws"))
        || canonical.starts_with(home.join("Library/Keychains"))
    {
        return Err("FARO no abre rutas sensibles.".to_string());
    }
    Ok(canonical)
}

fn approved_folder_path(value: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(value);
    if !candidate.is_absolute()
        || candidate
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("La carpeta debe usar una ruta absoluta segura.".to_string());
    }
    let home = user_home()?;
    if !candidate.starts_with(&home)
        || candidate.starts_with(home.join(".ssh"))
        || candidate.starts_with(home.join(".aws"))
        || candidate.starts_with(home.join("Library"))
    {
        return Err(
            "FARO sólo puede crear carpetas no sensibles dentro de tu directorio de usuario."
                .to_string(),
        );
    }
    Ok(candidate)
}

fn dnd_shortcut(config: &Value, enabled: bool) -> Result<String, String> {
    let preferences = config
        .get("focusPreferences")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            "Configura los Shortcuts de concentración en Ajustes → Computer.".to_string()
        })?;
    let key = if enabled {
        "focusOnShortcut"
    } else {
        "focusOffShortcut"
    };
    let name = preferences.get(key).and_then(Value::as_str)
        .ok_or_else(|| "Configura un Shortcut local para activar y restaurar concentración antes de usar esta acción.".to_string())?;
    safe_shortcut_name(name)
}

fn night_shift_shortcut(config: &Value, enabled: bool) -> Result<String, String> {
    let preferences = config
        .get("displayPreferences")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            "Configura los Shortcuts de Night Shift en Ajustes → Computer → Pantalla.".to_string()
        })?;
    let key = if enabled {
        "nightShiftOnShortcut"
    } else {
        "nightShiftOffShortcut"
    };
    let name = preferences
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            "Configura el Shortcut local de Night Shift antes de usar esta acción.".to_string()
        })?;
    safe_shortcut_name(name)
}

fn press_display_brightness(key_code: u16, repetitions: u8) -> Result<(), String> {
    let script = format!(
        "tell application \"System Events\"\nrepeat {repetitions} times\nkey code {key_code}\ndelay 0.05\nend repeat\nend tell"
    );
    run_osascript(script).map(|_| ()).map_err(|_| {
        "FARO necesita permiso de Accesibilidad para ajustar el brillo. Actívalo en Configuración del Sistema → Privacidad y seguridad → Accesibilidad.".to_string()
    })
}

fn execute_macos_computer_tool(
    app: &AppHandle,
    request: &ComputerToolRequest,
) -> Result<ComputerToolResponse, String> {
    let tool = request.tool.as_str();
    computer_safety_level(tool)?;
    let args = args_object(&request.arguments)?;
    match tool {
        "openApp" => {
            let app_name = allowed_app_name(&argument_string(args, "app")?)?;
            run_process("/usr/bin/open", &["-a".to_string(), app_name.clone()])?;
            computer_response(tool, format!("Abrí {app_name}."), None)
        }
        "closeApp" => {
            let app_name = allowed_app_name(&argument_string(args, "app")?)?;
            run_osascript(format!("tell application \"{app_name}\" to quit"))?;
            computer_response(tool, format!("Cerré {app_name}."), None)
        }
        "focusApp" | "focusWindow" => {
            let app_name = allowed_app_name(&argument_string(args, "app")?)?;
            run_osascript(format!("tell application \"{app_name}\" to activate"))?;
            computer_response(tool, format!("Enfoqué {app_name}."), None)
        }
        "isAppRunning" => {
            let app_name = allowed_app_name(&argument_string(args, "app")?)?;
            let running = run_osascript(format!("tell application \"System Events\" to return (name of processes) contains \"{app_name}\""))?;
            computer_response(
                tool,
                format!("{app_name}: {running}"),
                Some(json!({ "running": running.eq_ignore_ascii_case("true") })),
            )
        }
        "listRunningApps" => {
            let apps = run_osascript("tell application \"System Events\" to get name of every process whose background only is false".to_string())?
                .split(", ").filter(|item| !item.trim().is_empty()).map(str::to_string).collect::<Vec<_>>();
            computer_response(
                tool,
                format!("Hay {} aplicaciones visibles.", apps.len()),
                Some(json!({ "apps": apps })),
            )
        }
        "setVolume" => {
            let percent = args
                .get("percent")
                .and_then(Value::as_u64)
                .filter(|value| *value <= 100)
                .ok_or_else(|| "El volumen debe estar entre 0 y 100.".to_string())?;
            run_osascript(format!("set volume output volume {percent}"))?;
            computer_response(
                tool,
                format!("Volumen al {percent}%."),
                Some(json!({ "percent": percent })),
            )
        }
        "volumeUp" | "volumeDown" => {
            let current = run_osascript("output volume of (get volume settings)".to_string())?
                .parse::<i32>()
                .map_err(|_| "No pude leer el volumen actual.".to_string())?;
            let next = (current + if tool == "volumeUp" { 10 } else { -10 }).clamp(0, 100);
            run_osascript(format!("set volume output volume {next}"))?;
            computer_response(
                tool,
                format!("Volumen al {next}%."),
                Some(json!({ "percent": next })),
            )
        }
        "mute" => {
            run_osascript("set volume with output muted".to_string())?;
            computer_response(tool, "Volumen silenciado.", None)
        }
        "unmute" => {
            run_osascript("set volume without output muted".to_string())?;
            computer_response(tool, "Volumen restaurado.", None)
        }
        "brightnessUp" => {
            press_display_brightness(145, 1)?;
            computer_response(tool, "Subí el brillo.", None)
        }
        "brightnessDown" => {
            press_display_brightness(144, 1)?;
            computer_response(tool, "Bajé el brillo.", None)
        }
        "setBrightness" => {
            let level = argument_string(args, "level")?;
            match level.as_str() {
                "max" => {
                    press_display_brightness(145, 20)?;
                    computer_response(tool, "Brillo al máximo.", Some(json!({ "level": "max" })))
                }
                "min" => {
                    press_display_brightness(144, 20)?;
                    computer_response(tool, "Brillo al mínimo.", Some(json!({ "level": "min" })))
                }
                _ => Err("El brillo sólo admite máximo o mínimo.".to_string()),
            }
        }
        "setNightShift" => {
            let enabled = args
                .get("enabled")
                .and_then(Value::as_bool)
                .ok_or_else(|| {
                    "Indica si Night Shift debe activarse o desactivarse.".to_string()
                })?;
            let mut config = read_computer_config(app)?;
            let shortcut = night_shift_shortcut(&config, enabled)?;
            run_process("/usr/bin/shortcuts", &["run".to_string(), shortcut])?;
            config["nightShift"] = json!({ "state": if enabled { "enabled" } else { "disabled" }, "managedAt": chrono_like_timestamp() });
            write_computer_config(app, &config)?;
            computer_response(
                tool,
                if enabled {
                    "Night Shift activado."
                } else {
                    "Night Shift desactivado."
                },
                Some(json!({ "state": if enabled { "enabled" } else { "disabled" } })),
            )
        }
        "lockComputer" => {
            run_process(
                "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession",
                &["-suspend".to_string()],
            )?;
            computer_response(tool, "Mac bloqueado.", None)
        }
        "setDoNotDisturb" => {
            let enabled = args
                .get("enabled")
                .and_then(Value::as_bool)
                .ok_or_else(|| {
                    "Indica si concentración debe activarse o desactivarse.".to_string()
                })?;
            let mut config = read_computer_config(app)?;
            let shortcut = dnd_shortcut(&config, enabled)?;
            run_process("/usr/bin/shortcuts", &["run".to_string(), shortcut])?;
            config["doNotDisturb"] = json!({ "state": if enabled { "enabled" } else { "disabled" }, "managedAt": chrono_like_timestamp() });
            write_computer_config(app, &config)?;
            computer_response(
                tool,
                if enabled {
                    "Concentración activada."
                } else {
                    "Concentración restaurada."
                },
                Some(json!({ "state": if enabled { "enabled" } else { "disabled" } })),
            )
        }
        "getDoNotDisturbStatus" => {
            let config = read_computer_config(app)?;
            let state = config
                .pointer("/doNotDisturb/state")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            computer_response(
                tool,
                if state == "unknown" {
                    "macOS no expone de forma pública el estado actual de Concentración; muestro el último estado gestionado por FARO."
                } else {
                    "Estado de concentración gestionado por FARO."
                },
                Some(json!({ "state": state })),
            )
        }
        "findFile" => {
            let query = argument_string(args, "query")?.trim().to_string();
            if query.is_empty()
                || query.chars().count() > 80
                || !query.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, ' ' | '-' | '_' | '.')
                })
            {
                return Err("La búsqueda de archivo no es válida.".to_string());
            }
            let expression = format!("kMDItemFSName == '*{}*'cd", query.replace('"', ""));
            let home = user_home()?;
            let results = run_process("/usr/bin/mdfind", &[expression])?
                .lines()
                .filter_map(|line| approved_existing_path(line).ok())
                .filter(|path| path.starts_with(&home))
                .take(25)
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>();
            computer_response(
                tool,
                if results.is_empty() {
                    "No encontré archivos con ese nombre.".to_string()
                } else {
                    format!("Encontré {} resultado(s).", results.len())
                },
                Some(json!({ "paths": results })),
            )
        }
        "openFile" | "revealInFinder" => {
            let path = approved_existing_path(&argument_string(args, "path")?)?;
            let command_args = if tool == "revealInFinder" {
                vec!["-R".to_string(), path.display().to_string()]
            } else if let Some(app) = args.get("app").and_then(Value::as_str) {
                vec![
                    "-a".to_string(),
                    allowed_app_name(app)?,
                    path.display().to_string(),
                ]
            } else {
                vec![path.display().to_string()]
            };
            run_process("/usr/bin/open", &command_args)?;
            computer_response(
                tool,
                if tool == "revealInFinder" {
                    "Mostré el archivo en Finder."
                } else {
                    "Abrí el archivo."
                },
                None,
            )
        }
        "openUrl" => {
            let url = argument_string(args, "url")?;
            if !url.starts_with("https://")
                || url.chars().count() > 1_500
                || url.chars().any(char::is_control)
            {
                return Err("FARO sólo abre URLs https configuradas localmente.".to_string());
            }
            run_process("/usr/bin/open", &[url])?;
            computer_response(tool, "Abrí la URL configurada.", None)
        }
        "createFolder" => {
            let path = approved_folder_path(&argument_string(args, "path")?)?;
            fs::create_dir_all(&path).map_err(|error| error.to_string())?;
            computer_response(
                tool,
                "Carpeta creada.",
                Some(json!({ "path": path.display().to_string() })),
            )
        }
        "arrangeWorkLayout" => {
            let windows = args
                .get("windows")
                .and_then(Value::as_array)
                .filter(|value| !value.is_empty() && value.len() <= 6)
                .ok_or_else(|| "La distribución de ventanas no es válida.".to_string())?;
            for window in windows {
                let item = window
                    .as_object()
                    .ok_or_else(|| "Una ventana no es válida.".to_string())?;
                let app_name = allowed_app_name(&argument_string(item, "app")?)?;
                let x = item
                    .get("x")
                    .and_then(Value::as_i64)
                    .filter(|value| (-10_000..=10_000).contains(value))
                    .ok_or_else(|| "Posición inválida.".to_string())?;
                let y = item
                    .get("y")
                    .and_then(Value::as_i64)
                    .filter(|value| (-10_000..=10_000).contains(value))
                    .ok_or_else(|| "Posición inválida.".to_string())?;
                let width = item
                    .get("width")
                    .and_then(Value::as_i64)
                    .filter(|value| (160..=10_000).contains(value))
                    .ok_or_else(|| "Ancho inválido.".to_string())?;
                let height = item
                    .get("height")
                    .and_then(Value::as_i64)
                    .filter(|value| (120..=10_000).contains(value))
                    .ok_or_else(|| "Alto inválido.".to_string())?;
                run_osascript(format!("tell application \"System Events\" to tell process \"{app_name}\" to tell window 1 to set {{position, size}} to {{{{{x}, {y}}}, {{{width}, {height}}}}}"))?;
            }
            computer_response(tool, "Distribución aplicada.", None)
        }
        _ => Err("Computer Tool no permitido.".to_string()),
    }
}

fn chrono_like_timestamp() -> String {
    // RFC3339 is represented by JavaScript at the domain layer too. Rust's
    // standard library intentionally keeps this dependency-free.
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    seconds.to_string()
}

fn append_computer_observation(
    app: &AppHandle,
    request: &ComputerToolRequest,
    success: bool,
    latency_ms: u128,
) {
    let record = json!({
        "at": chrono_like_timestamp(), "surface": "desktop", "skill": "computer",
        "route": request.route, "tool": request.tool, "success": success,
        "latencyMs": latency_ms, "llmUsed": request.llm_used,
    });
    if let Ok(path) = app_data_dir(app).map(|directory| directory.join(COMPUTER_OBSERVABILITY_FILE))
    {
        if let Ok(line) = serde_json::to_string(&record) {
            use std::io::Write;
            if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
                let _ = writeln!(file, "{line}");
            }
        }
    }
}

fn session_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SESSION_SERVICE, key).map_err(|error| error.to_string())
}

fn validated_run_id(run_id: &str) -> Result<(), String> {
    if run_id.len() < 8
        || run_id.len() > 80
        || !run_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Identificador de enrollment inválido.".to_string());
    }
    Ok(())
}

fn log_dev(message: impl AsRef<str>) {
    if cfg!(debug_assertions) {
        println!("[faro-desktop] {}", message.as_ref());
    }
}

fn log_dev_error(scope: &str, error: impl std::fmt::Display) {
    if cfg!(debug_assertions) {
        eprintln!("[faro-desktop] {scope}: {error}");
    }
}

fn build_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    log_dev("window:main:create");
    WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
        .title("FARO")
        .inner_size(1440.0, 920.0)
        .min_inner_size(1040.0, 720.0)
        .center()
        .visible(false)
        .build()
}

fn build_mini_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    log_dev("window:mini:create");
    let mini_url = if cfg!(debug_assertions) && env::var_os("FARO_MINI_DEBUG").is_some() { "index.html?window=mini&miniDebug=1" } else { "index.html?window=mini" };
    WebviewWindowBuilder::new(
        app,
        MINI_LABEL,
        WebviewUrl::App(mini_url.into()),
    )
    .title("FARO Mini")
    .on_menu_event(|window, event| mini::menu_action(window.app_handle(), event.id.as_ref()))
    .inner_size(80.0, 80.0)
    .focused(false)
    .focusable(false)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .skip_taskbar(true)
    .always_on_top(read_preferences(app).unwrap_or_default().mini_always_on_top)
    // A concentration HUD is useful while the user is in another macOS
    // Space. Without this, AppKit keeps this auxiliary window only in the
    // Space where FARO was launched (usually Desktop 1).
    .visible_on_all_workspaces(true)
    .visible(false)
    .build()
}

fn get_or_create_main(app: &AppHandle) -> Result<WebviewWindow, String> {
    match app.get_webview_window(MAIN_LABEL) {
        Some(window) => Ok(window),
        None => build_main_window(app).map_err(|error| error.to_string()),
    }
}

fn get_or_create_mini(app: &AppHandle) -> Result<WebviewWindow, String> {
    match app.get_webview_window(MINI_LABEL) {
        Some(window) => Ok(window),
        None => { mini::reset_presentation(app); build_mini_window(app).map_err(|error| error.to_string()) },
    }
}

fn show_main(app: &AppHandle) -> Result<(), String> {
    let window = get_or_create_main(app)?;
    log_dev("window:main:show");
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn hide_main(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        log_dev("window:main:hide");
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn toggle_main(app: &AppHandle) -> Result<(), String> {
    let window = get_or_create_main(app)?;
    if window.is_visible().map_err(|error| error.to_string())? {
        hide_main(app)
    } else {
        show_main(app)
    }
}

fn show_mini_with_focus(app: &AppHandle, _focus: bool) -> Result<(), String> {
    let window = get_or_create_mini(app)?;
    mini::place(app, &window, true)?;
    mini::show_passive(&window)
}

fn show_mini(app: &AppHandle) -> Result<(), String> {
    show_mini_with_focus(app, false)?;
    app.emit_to(MINI_LABEL, "faro://mini-action", "restore").map_err(|e|e.to_string())
}

fn hide_mini(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MINI_LABEL) {
        log_dev("window:mini:hide");
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn toggle_mini(app: &AppHandle) -> Result<(), String> {
    let window = get_or_create_mini(app)?;
    if window.is_visible().map_err(|error| error.to_string())? {
        hide_mini(app)
    } else {
        show_mini(app)
    }
}

fn toggle_mini_listening(app: &AppHandle) -> Result<(), String> {
    let window = get_or_create_mini(app)?;
    if !window.is_visible().map_err(|e|e.to_string())? {
        show_mini_with_focus(app, false)?;
        return app.emit_to(MINI_LABEL, "faro://mini-action", "restore").map_err(|e|e.to_string());
    }
    mini::place(app, &window, true)?;
    app.emit_to(MINI_LABEL, "faro://mini-action", "shortcut").map_err(|e|e.to_string())
}

fn open_main_route(app: &AppHandle, route: &str) -> Result<(), String> {
    if !matches!(route, "/finance" | "/calendar" | "/backlog" | "/settings") {
        return Err("Ruta de FARO no permitida.".to_string());
    }
    show_main(app)?;
    app.emit("faro://navigate", route)
        .map_err(|error| error.to_string())
}

fn request_voice_action(app: &AppHandle, action: &str) -> Result<(), String> {
    if !matches!(
        action,
        "open"
            | "open_and_listen"
            | "confirm"
            | "cancel"
            | "stop_listening"
            | "close_assistant"
            | "pause_focus"
            | "finish_focus"
    ) {
        return Err("Acción de voz no permitida.".to_string());
    }
    if action == "open" {
        show_main(app)?;
    }
    if action == "open_and_listen" {
        // Start negotiating the input channel before the Mini is painted.
        // The shortcut feels immediate because window creation/rendering no
        // longer sits in front of the microphone handshake.
        get_or_create_main(app)?;
        app.emit_to(MINI_LABEL, "faro://mini-action", "listening").map_err(|error|error.to_string())?;
        app.emit("faro://voice-action", action)
            .map_err(|error| error.to_string())?;
        show_mini_with_focus(app, false)?;
        return Ok(());
    }
    log_dev(format!("voice:action:{action}"));
    app.emit("faro://voice-action", action)
        .map_err(|error| error.to_string())
}

fn quit_faro(app: &AppHandle) {
    log_dev("desktop:quit");
    app.state::<DesktopLifecycle>()
        .quitting
        .store(true, Ordering::SeqCst);
    if let Err(error) = app.global_shortcut().unregister_all() {
        log_dev_error("shortcut:unregister", error);
    } else {
        log_dev("shortcut:unregister");
    }
    for label in [MINI_LABEL, MAIN_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.destroy();
        }
    }
    app.exit(0);
}

#[tauri::command]
fn show_main_command(app: AppHandle) -> Result<(), String> {
    show_main(&app)
}

#[tauri::command]
fn hide_main_command(app: AppHandle) -> Result<(), String> {
    hide_main(&app)
}

#[tauri::command]
fn toggle_main_command(app: AppHandle) -> Result<(), String> {
    toggle_main(&app)
}

#[tauri::command]
fn show_mini_command(app: AppHandle) -> Result<(), String> {
    show_mini(&app)
}

#[tauri::command]
fn announce_calendar_event_command(app: AppHandle, message: String) -> Result<(), String> {
    let message = message.trim();
    if message.is_empty() || message.len() > 500 {
        return Err("El aviso de calendario no es válido.".to_string());
    }
    mini::announce_calendar_event(&app, message);
    Ok(())
}

#[tauri::command]
fn hide_mini_command(app: AppHandle) -> Result<(), String> {
    hide_mini(&app)
}

#[tauri::command]
fn toggle_mini_command(app: AppHandle) -> Result<(), String> {
    toggle_mini(&app)
}

#[tauri::command]
fn focus_main_command(app: AppHandle) -> Result<(), String> {
    show_main(&app)
}

#[tauri::command]
fn set_mini_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
    get_or_create_mini(&app)?.set_always_on_top(always_on_top).map_err(|e|e.to_string())?;
    let mut preferences = read_preferences(&app)?;
    preferences.mini_always_on_top = always_on_top;
    write_preferences(&app, &preferences)
}

#[cfg(target_os = "macos")]
fn touch_id_preflight() -> Result<(), String> {
    let context = unsafe { LAContext::new() };
    unsafe {
        context
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
            .map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "macos")]
fn authenticate_with_touch_id(reason: &str) -> Result<(), String> {
    touch_id_preflight()?;

    let context = unsafe { LAContext::new() };
    let reason = NSString::from_str(reason);
    let (sender, receiver) = mpsc::sync_channel::<Result<(), String>>(1);
    let reply: RcBlock<dyn Fn(Bool, *mut NSError)> =
        RcBlock::new(move |success: Bool, error: *mut NSError| {
            let result = if success.as_bool() {
                Ok(())
            } else if error.is_null() {
                Err("Touch ID no pudo confirmar tu identidad. Inténtalo de nuevo.".to_string())
            } else {
                let message = unsafe { (&*error).to_string() };
                Err(if message.trim().is_empty() {
                    "Touch ID no pudo confirmar tu identidad. Inténtalo de nuevo.".to_string()
                } else {
                    message
                })
            };
            let _ = sender.send(result);
        });

    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &reason,
            &reply,
        );
    }

    receiver
        .recv_timeout(Duration::from_secs(65))
        .map_err(|_| "Touch ID tardó demasiado. Inténtalo de nuevo.".to_string())?
}

#[cfg(target_os = "macos")]
fn authenticate_with_device_owner(reason: &str) -> Result<(), String> {
    let context = unsafe { LAContext::new() };
    unsafe {
        context
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication)
            .map_err(|error| error.to_string())?;
    }

    let reason = NSString::from_str(reason);
    let (sender, receiver) = mpsc::sync_channel::<Result<(), String>>(1);
    let reply: RcBlock<dyn Fn(Bool, *mut NSError)> =
        RcBlock::new(move |success: Bool, error: *mut NSError| {
            let result = if success.as_bool() {
                Ok(())
            } else if error.is_null() {
                Err("macOS no pudo confirmar tu identidad. Inténtalo de nuevo.".to_string())
            } else {
                let message = unsafe { (&*error).to_string() };
                Err(if message.trim().is_empty() {
                    "macOS no pudo confirmar tu identidad. Inténtalo de nuevo.".to_string()
                } else {
                    message
                })
            };
            let _ = sender.send(result);
        });

    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthentication,
            &reason,
            &reply,
        );
    }
    receiver
        .recv_timeout(Duration::from_secs(65))
        .map_err(|_| "La autenticación de macOS tardó demasiado. Inténtalo de nuevo.")?
}

/// FARO Vault deliberately uses the device-owner policy instead of receiving
/// a Mac password itself. macOS chooses Touch ID when available and presents
/// its own password fallback only when it is needed.
pub async fn authenticate_device_owner(reason: &str) -> Result<(), String> {
    let reason = reason.trim().to_string();
    if reason.is_empty() || reason.chars().count() > 180 {
        return Err("La solicitud de autenticación de macOS no es válida.".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || authenticate_with_device_owner(&reason))
            .await
            .map_err(|error| format!("No fue posible iniciar la autenticación de macOS: {error}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = reason;
        Err("FARO Vault sólo está disponible en FARO Desktop para macOS.".to_string())
    }
}

#[tauri::command]
fn desktop_biometric_status_command() -> DesktopBiometricStatus {
    #[cfg(target_os = "macos")]
    {
        match touch_id_preflight() {
            Ok(()) => DesktopBiometricStatus {
                available: true,
                reason: None,
            },
            Err(reason) => DesktopBiometricStatus {
                available: false,
                reason: Some(reason),
            },
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        DesktopBiometricStatus {
            available: false,
            reason: Some("Touch ID sólo está disponible en FARO Desktop para macOS.".to_string()),
        }
    }
}

#[tauri::command]
async fn authenticate_desktop_biometrics_command(reason: String) -> Result<(), String> {
    let reason = reason.trim().to_string();
    if reason.is_empty() || reason.chars().count() > 180 {
        return Err("La solicitud de Touch ID no es válida.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || authenticate_with_touch_id(&reason))
            .await
            .map_err(|error| format!("No fue posible iniciar Touch ID: {error}"))?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = reason;
        Err("Touch ID sólo está disponible en FARO Desktop para macOS.".to_string())
    }
}

#[tauri::command]
fn desktop_session_get_command(key: String) -> Result<Option<String>, String> {
    match session_entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn desktop_session_set_command(key: String, value: String) -> Result<(), String> {
    session_entry(&key)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_session_remove_command(key: String) -> Result<(), String> {
    match session_entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn get_desktop_preferences_command(app: AppHandle) -> Result<DesktopPreferences, String> {
    read_preferences(&app)
}

#[tauri::command]
fn update_desktop_preferences_command(
    app: AppHandle,
    patch: DesktopPreferencesPatch,
) -> Result<DesktopPreferences, String> {
    let mut preferences = read_preferences(&app)?;
    preferences.apply(patch);
    write_preferences(&app, &preferences)?;
    Ok(preferences)
}

#[tauri::command]
fn get_computer_config_command(app: AppHandle) -> Result<Value, String> {
    read_computer_config(&app)
}

#[tauri::command]
fn update_computer_config_command(app: AppHandle, config: Value) -> Result<Value, String> {
    write_computer_config(&app, &config)?;
    Ok(config)
}

#[tauri::command]
fn computer_execute_command(
    app: AppHandle,
    request: ComputerToolRequest,
) -> Result<ComputerToolResponse, String> {
    if !matches!(
        request.route.as_str(),
        "deterministic" | "cheap_model" | "smart_model"
    ) {
        return Err("La ruta de Computer no es válida.".to_string());
    }
    let started_at = std::time::Instant::now();
    let result = MacOSComputerAdapter::execute(&app, &request);
    append_computer_observation(
        &app,
        &request,
        result.is_ok(),
        started_at.elapsed().as_millis(),
    );
    result
}

#[tauri::command]
fn set_launch_at_login_command(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        app.autolaunch()
            .enable()
            .map_err(|error| error.to_string())?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|error| error.to_string())?;
    }
    let mut preferences = read_preferences(&app)?;
    preferences.launch_at_login = enabled;
    write_preferences(&app, &preferences)?;
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_wake_model_command(app: AppHandle) -> Result<Option<Vec<u8>>, String> {
    let path = app_data_dir(&app)?.join(WAKE_MODEL_FILE);
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_wake_enrollment_sample_command(
    app: AppHandle,
    run_id: String,
    index: u8,
    bytes: Vec<u8>,
) -> Result<(), String> {
    validated_run_id(&run_id)?;
    if index >= 60 || bytes.len() < 1_000 || bytes.len() > 2_000_000 {
        return Err("Muestra de enrollment inválida.".to_string());
    }
    let directory = app_data_dir(&app)?
        .join("wake")
        .join("enrollment")
        .join(run_id);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    fs::write(directory.join(format!("{index:02}.wav")), bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_wake_enrollment_command(app: AppHandle, run_id: String) -> Result<(), String> {
    validated_run_id(&run_id)?;
    let directory = app_data_dir(&app)?
        .join("wake")
        .join("enrollment")
        .join(run_id);
    if directory.exists() {
        fs::remove_dir_all(directory).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn mini_voice_state(snapshot: &Value) -> &str {
    let state=snapshot.get("state").and_then(Value::as_str).unwrap_or("ready");
    if state=="listening" && snapshot.get("waitingForWake").and_then(Value::as_bool)==Some(true) {"ready"} else {state}
}

#[tauri::command]
fn set_voice_audio_level(app: AppHandle, level: f64) -> Result<(),String> {
    if !level.is_finite() { return Ok(()) }
    app.emit_to(MINI_LABEL, "faro://mini-audio-level", level.clamp(0.0,1.0)).map_err(|e|e.to_string())
}

#[tauri::command]
fn set_voice_snapshot(app: AppHandle, snapshot: Value) -> Result<(), String> {
    let previous = app.state::<VoiceSnapshotState>().snapshot.lock().map_err(|e|e.to_string())?.clone();
    let state = mini_voice_state(&snapshot);
    let previous_state = previous.as_ref().map(mini_voice_state).unwrap_or("ready");
    *app.state::<VoiceSnapshotState>().snapshot.lock().map_err(|e|e.to_string())? = Some(snapshot.clone());
    if state != previous_state { log_dev(format!("voice:state:{state}")); }
    // Audio/transcript updates no longer resize, reposition, or focus Mini.
    if state != previous_state && (state == "listening" || state == "awaiting_confirmation") {
        let window = get_or_create_mini(&app)?;
        if state == "listening" { mini::place(&app, &window, true)?; }
        mini::show_passive(&window)?;
    }
    app.emit("faro://voice-snapshot", snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_voice_snapshot(app: AppHandle) -> Result<Option<Value>, String> {
    app.state::<VoiceSnapshotState>()
        .snapshot
        .lock()
        .map(|snapshot| snapshot.clone())
        .map_err(|_| "No fue posible leer el estado de FARO Voice.".to_string())
}

#[tauri::command]
fn request_voice_action_command(app: AppHandle, action: String) -> Result<(), String> {
    request_voice_action(&app, &action)
}

#[tauri::command]
fn submit_voice_transcript_command(app: AppHandle, transcript: String) -> Result<(), String> {
    let transcript = transcript.trim();
    if transcript.is_empty() || transcript.chars().count() > 1_000 {
        return Err("Transcripción de voz no válida.".to_string());
    }
    app.emit("faro://voice-transcript", transcript)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_main_route_command(app: AppHandle, route: String) -> Result<(), String> {
    open_main_route(&app, &route)
}

#[tauri::command]
fn quit_faro_command(app: AppHandle) {
    quit_faro(&app)
}

fn main() {
    tauri::Builder::default()
        .manage(DesktopLifecycle::default())
        .manage(VoiceSnapshotState::default())
        .manage(mini::MiniWindowController::default())
        .manage(storage::StorageScanState::default())
        .manage(archive::ArchiveOauthState::default())
        .manage(vault::VaultSessionState::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--faro-autostart"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log_dev("desktop:single-instance");
            if let Err(error) = show_main(app) {
                log_dev_error("desktop:single-instance:show-main", error);
            }
        }))
        .invoke_handler(tauri::generate_handler![
            show_main_command,
            hide_main_command,
            toggle_main_command,
            show_mini_command,
            announce_calendar_event_command,
            hide_mini_command,
            toggle_mini_command,
            focus_main_command,
            set_mini_always_on_top,
            mini::mini_present,
            mini::mini_activate_control,
            mini::mini_preferences,
            mini::mini_window_info,
            mini::mini_update_preferences,
            mini::mini_start_drag,
            mini::mini_context_menu,
            desktop_biometric_status_command,
            authenticate_desktop_biometrics_command,
            desktop_session_get_command,
            desktop_session_set_command,
            desktop_session_remove_command,
            get_desktop_preferences_command,
            update_desktop_preferences_command,
            get_computer_config_command,
            update_computer_config_command,
            computer_execute_command,
            storage::storage_capacity_command,
            storage::scan_storage_command,
            storage::storage_browse_folder_command,
            storage::storage_reveal_folder_command,
            storage::storage_reveal_item_command,
            storage::storage_move_to_trash_command,
            archive::archive_overview_command,
            archive::archive_acknowledge_monthly_review_command,
            archive::archive_update_settings_command,
            archive::archive_configure_google_drive_command,
            archive::archive_start_google_drive_oauth_command,
            archive::archive_process_storage_candidate_command,
            archive::archive_process_storage_candidates_command,
            archive::archive_run_safe_upload_test_command,
            archive::archive_open_remote_item_command,
            archive::archive_open_root_folder_command,
            archive::archive_restore_item_command,
            archive::archive_purge_faro_trash_command,
            vault::vault_status_command,
            vault::vault_create_command,
            vault::vault_unlock_command,
            vault::vault_lock_command,
            vault::vault_list_command,
            vault::vault_get_command,
            vault::vault_create_credential_command,
            vault::vault_update_credential_command,
            vault::vault_delete_credential_command,
            vault::vault_generate_password_command,
            vault::vault_update_settings_command,
            vault::vault_copy_username_command,
            vault::vault_copy_password_command,
            vault::vault_open_url_command,
            set_launch_at_login_command,
            get_wake_model_command,
            save_wake_enrollment_sample_command,
            clear_wake_enrollment_command,
            set_voice_snapshot,
            set_voice_audio_level,
            get_voice_snapshot,
            request_voice_action_command,
            submit_voice_transcript_command,
            open_main_route_command,
            quit_faro_command
        ])
        .setup(|app| {
            log_dev("desktop:start");
            get_or_create_main(&app.handle()).map_err(std::io::Error::other)?;
            let mini_window = get_or_create_mini(&app.handle()).map_err(std::io::Error::other)?;
            mini::start(app.handle());
            mini::place(app.handle(), &mini_window, false).map_err(std::io::Error::other)?;
            mini::show_passive(&mini_window).map_err(std::io::Error::other)?;

            match app
                .global_shortcut()
                .on_shortcut(MINI_SHORTCUT, |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        log_dev("shortcut:toggle-mini-listening");
                        if let Err(error) = toggle_mini_listening(app) {
                            log_dev_error("shortcut:toggle-mini-listening", error);
                        }
                    }
                }) {
                Ok(()) => log_dev("shortcut:register"),
                Err(error) => log_dev_error("shortcut:register; use tray fallback", error),
            }

            let open = MenuItem::with_id(app, "open-main", "Abrir FARO", true, None::<&str>)?;
            let talk = MenuItem::with_id(app, "talk", "Hablar con FARO", true, None::<&str>)?;
            let mini =
                MenuItem::with_id(app, "toggle-mini", "Mostrar FARO Mini", true, None::<&str>)?;
            let finance = MenuItem::with_id(app, "finance", "Finanzas", true, None::<&str>)?;
            let calendar = MenuItem::with_id(app, "calendar", "Calendario", true, None::<&str>)?;
            let backlog = MenuItem::with_id(app, "backlog", "Backlog", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Salir de FARO", true, None::<&str>)?;
            let first_separator = PredefinedMenuItem::separator(app)?;
            let second_separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[
                    &open,
                    &talk,
                    &mini,
                    &first_separator,
                    &finance,
                    &calendar,
                    &backlog,
                    &second_separator,
                    &quit,
                ],
            )?;

            let _tray = TrayIconBuilder::with_id("faro-tray")
                .icon(Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
                .tooltip("FARO")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    log_dev(format!("tray:action:{}", event.id.as_ref()));
                    match event.id.as_ref() {
                        "open-main" => {
                            let _ = show_main(app);
                        }
                        "talk" => {
                            let _ = request_voice_action(app, "open_and_listen");
                        }
                        "toggle-mini" => {
                            let _ = toggle_mini(app);
                        }
                        "finance" => {
                            let _ = open_main_route(app, "/finance");
                        }
                        "calendar" => {
                            let _ = open_main_route(app, "/calendar");
                        }
                        "backlog" => {
                            let _ = open_main_route(app, "/backlog");
                        }
                        "quit" => quit_faro(app),
                        _ => {}
                    }
                })
                .build(app)?;

            if !std::env::args().any(|argument| argument == "--faro-autostart") {
                show_main(&app.handle()).map_err(std::io::Error::other)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MINI_LABEL {
                match event {
                    WindowEvent::Focused(false) => { let _ = window.emit("faro://mini-blur", ()); },
                    WindowEvent::ScaleFactorChanged { .. } => { if let Some(w) = window.app_handle().get_webview_window(MINI_LABEL) { let _=mini::place(window.app_handle(), &w, false); } },
                    _ => {}
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if matches!(window.label(), MAIN_LABEL | MINI_LABEL)
                    && !window
                        .app_handle()
                        .state::<DesktopLifecycle>()
                        .quitting
                        .load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    log_dev(format!("window:{}:hide", window.label()));
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("FARO Desktop no pudo iniciar");
}
