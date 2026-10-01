use crate::{get_or_create_mini, MINI_LABEL};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
pub fn clamp_to_visible_bounds(rect: Rect, work: Rect) -> Rect {
    let width = rect.width.min(work.width).max(1.0);
    let height = rect.height.min(work.height).max(1.0);
    Rect {
        x: rect.x.clamp(work.x, work.x + work.width - width),
        y: rect.y.clamp(work.y, work.y + work.height - height),
        width,
        height,
    }
}
pub fn relative_rect(work: Rect, width: f64, height: f64, x: f64, y: f64, scale: f64) -> Rect {
    let safe = Rect {
        x: work.x + 24.0 * scale,
        y: work.y + 16.0 * scale,
        width: (work.width - 48.0 * scale).max(1.0),
        height: (work.height - 32.0 * scale).max(1.0),
    };
    clamp_to_visible_bounds(
        Rect {
            x: safe.x + (safe.width - width).max(0.0) * x.clamp(0.0, 1.0),
            y: safe.y + (safe.height - height).max(0.0) * y.clamp(0.0, 1.0),
            width,
            height,
        },
        work,
    )
}
pub fn cursor_zone(rect: Rect, x: f64, y: f64, scale: f64, ambient: bool) -> &'static str {
    let core = if ambient {
        ((x - rect.x - rect.width / 2.0).powi(2) + (y - rect.y - rect.height / 2.0).powi(2)).sqrt()
            <= 36.0 * scale
    } else {
        x >= rect.x + 5.0 * scale
            && x <= rect.x + rect.width - 5.0 * scale
            && y >= rect.y + 5.0 * scale
            && y <= rect.y + rect.height - 5.0 * scale
    };
    if core {
        "core"
    } else if x >= rect.x - 24.0 * scale
        && x <= rect.x + rect.width + 24.0 * scale
        && y >= rect.y - 24.0 * scale
        && y <= rect.y + rect.height + 24.0 * scale
    {
        "near"
    } else {
        "far"
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub monitor: Option<String>,
    pub relative_x: f64,
    pub relative_y: f64,
    pub auto_collapse: bool,
    pub reduced_motion: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            monitor: None,
            relative_x: 1.0,
            relative_y: 0.0,
            auto_collapse: true,
            reduced_motion: false,
        }
    }
}
#[derive(Default)]
pub struct MiniWindowController {
    preferences: Mutex<Preferences>,
    presentation: Mutex<String>,
    pub dragging: AtomicBool,
    pub menu_open: AtomicBool,
    started: AtomicBool,
}
fn work_rect(m: &tauri::Monitor) -> Rect {
    let w = m.work_area();
    Rect {
        x: w.position.x as f64,
        y: w.position.y as f64,
        width: w.size.width as f64,
        height: w.size.height as f64,
    }
}
fn window_rect(w: &WebviewWindow) -> Result<Rect, String> {
    let p = w.outer_position().map_err(|e| e.to_string())?;
    let s = w.outer_size().map_err(|e| e.to_string())?;
    Ok(Rect {
        x: p.x as f64,
        y: p.y as f64,
        width: s.width as f64,
        height: s.height as f64,
    })
}
fn save(app: &AppHandle) -> Result<(), String> {
    let prefs = app
        .state::<MiniWindowController>()
        .preferences
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let path = crate::app_data_dir(app)?.join("mini-preferences.json");
    fs::write(path, serde_json::to_vec(&prefs).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
pub fn place(app: &AppHandle, w: &WebviewWindow, invoked: bool) -> Result<(), String> {
    place_with_size(app, w, invoked, None)
}
fn place_with_size(
    app: &AppHandle,
    w: &WebviewWindow,
    invoked: bool,
    target: Option<tauri::PhysicalSize<u32>>,
) -> Result<(), String> {
    let monitors = w.available_monitors().map_err(|e| e.to_string())?;
    let state = app.state::<MiniWindowController>();
    let mut prefs = state.preferences.lock().map_err(|e| e.to_string())?;
    let pointed = if invoked {
        w.cursor_position()
            .ok()
            .and_then(|p| w.monitor_from_point(p.x, p.y).ok().flatten())
    } else {
        None
    };
    let monitor = pointed
        .or_else(|| {
            monitors
                .iter()
                .find(|m| m.name().cloned() == prefs.monitor)
                .cloned()
        })
        .or(w.current_monitor().ok().flatten())
        .or(w.primary_monitor().ok().flatten());
    let Some(m) = monitor else { return Ok(()) };
    let name = m.name().cloned();
    let monitor_changed = prefs.monitor != name;
    if monitor_changed {
        prefs.monitor = name;
        prefs.relative_x = 1.0;
        prefs.relative_y = 0.0;
    }
    let s = match target {
        Some(size) => size,
        None => w.outer_size().map_err(|e| e.to_string())?,
    };
    let rect = relative_rect(
        work_rect(&m),
        s.width as f64,
        s.height as f64,
        prefs.relative_x,
        prefs.relative_y,
        m.scale_factor(),
    );
    drop(prefs);
    if rect.width < s.width as f64 || rect.height < s.height as f64 {
        w.set_size(tauri::PhysicalSize::new(
            rect.width as u32,
            rect.height as u32,
        ))
        .map_err(|e| e.to_string())?;
    }
    let current = w.outer_position().map_err(|e| e.to_string())?;
    if current.x != rect.x.round() as i32 || current.y != rect.y.round() as i32 {
        w.set_position(PhysicalPosition::new(
            rect.x.round() as i32,
            rect.y.round() as i32,
        ))
        .map_err(|e| e.to_string())?;
    }
    if invoked && monitor_changed {
        save(app)?;
    }
    Ok(())
}
pub fn show_passive(w: &WebviewWindow) -> Result<(), String> {
    w.set_focusable(false).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let window = w.clone();
        w.run_on_main_thread(move || {
            if let Ok(handle) = window.ns_window() {
                unsafe {
                    faro_mini_show_passive(handle);
                }
            }
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    w.show().map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(target_os = "macos")]
extern "C" {
    fn faro_mini_show_passive(handle: *mut std::ffi::c_void);
    fn faro_mini_pointer_pressed() -> bool;
}
fn pressed() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { faro_mini_pointer_pressed() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

pub fn preset(state: &str, long: bool) -> Option<(f64, f64)> {
    Some(match state {
        "ambient" => (80.0, 80.0),
        "peek" => (260.0, 152.0),
        "listening" => (300.0, 190.0),
        "understanding" | "consulting" | "executing" => (240.0, 120.0),
        "speaking" => {
            if long {
                (320.0, 156.0)
            } else {
                (240.0, 120.0)
            }
        }
        "success" => (220.0, 110.0),
        "focus_compact" => (112.0, 138.0),
        "focus_expanded" => (320.0, 238.0),
        "awaiting_confirmation" => (340.0, 224.0),
        "error" => (300.0, 150.0),
        _ => return None,
    })
}
#[tauri::command]
pub fn mini_present(app: AppHandle, state: String, long: bool) -> Result<(), String> {
    let (width, height) = preset(&state, long).ok_or("Estado de Mini inválido")?;
    let w = get_or_create_mini(&app)?;
    let key = format!("{state}:{width}:{height}");
    let controller = app.state::<MiniWindowController>();
    let mut presentation = controller.presentation.lock().map_err(|e| e.to_string())?;
    if *presentation == key {
        return Ok(());
    }
    let previous_size = presentation
        .split_once(':')
        .map(|(_, size)| size.to_owned());
    *presentation = key;
    drop(presentation);
    let start = Instant::now();
    let scale = w.scale_factor().map_err(|e| e.to_string())?;
    // set_size is queued by Tauri: a getter immediately afterwards can still
    // contain the previous size. Compare requested sizes and position using
    // the target dimensions, including rapid expand/collapse sequences.
    if previous_size.as_deref() != Some(format!("{width}:{height}").as_str()) {
        w.set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        place_with_size(
            &app,
            &w,
            false,
            Some(tauri::PhysicalSize::new(
                (width * scale).round() as u32,
                (height * scale).round() as u32,
            )),
        )?;
        let _ = w.emit(
            "faro://mini-resize-metric",
            start.elapsed().as_secs_f64() * 1000.0,
        );
    }
    if matches!(state.as_str(), "ambient" | "focus_compact") {
        let _ = w.set_focusable(false);
    }
    Ok(())
}
#[tauri::command]
pub fn mini_activate_control(app: AppHandle) -> Result<(), String> {
    let w = get_or_create_mini(&app)?;
    w.set_focusable(true).map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn mini_preferences(app: AppHandle) -> Result<Preferences, String> {
    app.state::<MiniWindowController>()
        .preferences
        .lock()
        .map(|p| p.clone())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn mini_update_preferences(
    app: AppHandle,
    auto_collapse: bool,
    reduced_motion: bool,
) -> Result<(), String> {
    {
        let state = app.state::<MiniWindowController>();
        let mut prefs = state.preferences.lock().map_err(|e| e.to_string())?;
        prefs.auto_collapse = auto_collapse;
        prefs.reduced_motion = reduced_motion;
    }
    save(&app)?;
    let _ = app.emit("faro://mini-preferences", mini_preferences(app.clone())?);
    Ok(())
}
fn save_drag(app: &AppHandle, w: &WebviewWindow) -> Result<(), String> {
    let Some(m) = w.current_monitor().map_err(|e| e.to_string())? else {
        return Ok(());
    };
    let rect = window_rect(w)?;
    let work = work_rect(&m);
    let scale = m.scale_factor();
    let x = ((rect.x - work.x - 24.0 * scale) / (work.width - 48.0 * scale - rect.width).max(1.0))
        .clamp(0.0, 1.0);
    let y = ((rect.y - work.y - 16.0 * scale)
        / (work.height - 32.0 * scale - rect.height).max(1.0))
    .clamp(0.0, 1.0);
    let snap = |n: f64| {
        if n < 0.06 {
            0.0
        } else if n > 0.94 {
            1.0
        } else {
            n
        }
    };
    {
        let state = app.state::<MiniWindowController>();
        let mut prefs = state.preferences.lock().map_err(|e| e.to_string())?;
        prefs.monitor = m.name().cloned();
        prefs.relative_x = snap(x);
        prefs.relative_y = snap(y);
    }
    place(app, w, false)?;
    save(app)
}
#[tauri::command]
pub async fn mini_start_drag(app: AppHandle) -> Result<(), String> {
    let w = get_or_create_mini(&app)?;
    app.state::<MiniWindowController>()
        .dragging
        .store(true, Ordering::SeqCst);
    let result = w.start_dragging().map_err(|e| e.to_string());
    if result.is_err() {
        app.state::<MiniWindowController>()
            .dragging
            .store(false, Ordering::SeqCst);
    }
    result
}
#[tauri::command]
pub async fn mini_context_menu(app: AppHandle) -> Result<(), String> {
    let owner = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let w = get_or_create_mini(&owner)?;
        owner
            .state::<MiniWindowController>()
            .menu_open
            .store(true, Ordering::SeqCst);
        let result = (|| -> Result<(), String> {
            let prefs = crate::read_preferences(&owner)?;
            let keep_label = if prefs.mini_always_on_top {
                "✓ Mantener visible"
            } else {
                "Mantener visible"
            };
            let mini_prefs = mini_preferences(owner.clone())?;
            let collapse_label = if mini_prefs.auto_collapse {
                "✓ Contraer automáticamente"
            } else {
                "Contraer automáticamente"
            };
            let motion_label = if mini_prefs.reduced_motion {
                "✓ Reducir movimiento"
            } else {
                "Reducir movimiento"
            };
            let names = [
                ("mini-talk", "Hablar con FARO"),
                ("mini-focus", "Concentración"),
                ("mini-focus-test", "Probar concentración · 10 s / 5 s"),
                ("mini-main", "Abrir FARO"),
                ("mini-finance", "Finanzas"),
                ("mini-calendar", "Calendario"),
                ("mini-backlog", "Backlog"),
                ("mini-top", keep_label),
                ("mini-auto-collapse", collapse_label),
                ("mini-reduced-motion", motion_label),
                ("mini-settings", "Ajustes"),
                ("mini-hide", "Ocultar Mini"),
                ("mini-quit", "Salir de FARO"),
            ];
            let items = names
                .iter()
                .map(|(id, label)| MenuItem::with_id(&owner, *id, *label, true, None::<&str>))
                .collect::<tauri::Result<Vec<_>>>()
                .map_err(|e| e.to_string())?;
            let menu = Menu::new(&owner).map_err(|e| e.to_string())?;
            for (index, item) in items.iter().enumerate() {
                if index == 3 || index == 6 {
                    menu.append(&PredefinedMenuItem::separator(&owner).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                }
                menu.append(item).map_err(|e| e.to_string())?;
            }
            w.popup_menu(&menu).map_err(|e| e.to_string())
        })();
        owner
            .state::<MiniWindowController>()
            .menu_open
            .store(false, Ordering::SeqCst);
        let _ = owner.emit_to(MINI_LABEL, "faro://mini-menu", false);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn menu_action(app: &AppHandle, id: &str) {
    match id {
        "mini-talk" => {
            let _ = crate::request_voice_action(app, "open_and_listen");
        }
        "mini-focus" => {
            let _ = app.emit_to(MINI_LABEL, "faro://mini-action", "focus");
        }
        "mini-focus-test" => { let _ = app.emit_to(MINI_LABEL, "faro://mini-action", "test_focus"); }
        "mini-main" => {
            let _ = crate::show_main(app);
        }
        "mini-finance" => {
            let _ = crate::open_main_route(app, "/finance");
        }
        "mini-calendar" => {
            let _ = crate::open_main_route(app, "/calendar");
        }
        "mini-backlog" => {
            let _ = crate::open_main_route(app, "/backlog");
        }
        "mini-settings" => {
            let _ = crate::open_main_route(app, "/settings");
        }
        "mini-hide" => {
            let _ = crate::hide_mini(app);
        }
        "mini-quit" => crate::quit_faro(app),
        "mini-auto-collapse" => {
            if let Ok(p) = mini_preferences(app.clone()) {
                let _ = mini_update_preferences(app.clone(), !p.auto_collapse, p.reduced_motion);
            }
        }
        "mini-reduced-motion" => {
            if let Ok(p) = mini_preferences(app.clone()) {
                let _ = mini_update_preferences(app.clone(), p.auto_collapse, !p.reduced_motion);
            }
        }
        "mini-top" => {
            if let Ok(p) = crate::read_preferences(app) {
                let _ = crate::set_mini_always_on_top(app.clone(), !p.mini_always_on_top);
            }
        }
        _ => {}
    }
}
pub fn start(app: &AppHandle) {
    let controller = app.state::<MiniWindowController>();
    if controller.started.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(dir) = crate::app_data_dir(app) {
        if let Ok(raw) = fs::read(dir.join("mini-preferences.json")) {
            if let Ok(mut prefs) = serde_json::from_slice::<Preferences>(&raw) {
                if !prefs.relative_x.is_finite() || !prefs.relative_y.is_finite() {
                    prefs = Preferences::default();
                }
                *controller.preferences.lock().unwrap() = prefs;
            }
        }
    }
    let owner = app.clone();
    std::thread::spawn(move || {
        let mut last = String::new();
        let mut ignored = false;
        let mut topology = String::new();
        let mut checked = Instant::now() - Duration::from_secs(3);
        loop {
            std::thread::sleep(Duration::from_millis(80));
            if owner
                .state::<crate::DesktopLifecycle>()
                .quitting
                .load(Ordering::SeqCst)
            {
                break;
            }
            let Some(w) = owner.get_webview_window(MINI_LABEL) else {
                if let Ok(w) = get_or_create_mini(&owner) {
                    let _ = place(&owner, &w, false);
                    let _ = show_passive(&w);
                }
                std::thread::sleep(Duration::from_millis(500));
                continue;
            };
            if !w.is_visible().unwrap_or(false) {
                continue;
            }
            let state = owner.state::<MiniWindowController>();
            let down = pressed();
            if state.dragging.load(Ordering::SeqCst) && !down {
                state.dragging.store(false, Ordering::SeqCst);
                let _ = save_drag(&owner, &w);
            }
            let (Ok(rect), Ok(cursor), Ok(scale)) =
                (window_rect(&w), w.cursor_position(), w.scale_factor())
            else {
                continue;
            };
            let ambient = state
                .presentation
                .lock()
                .map(|p| p.starts_with("ambient"))
                .unwrap_or(true);
            let zone = cursor_zone(rect, cursor.x, cursor.y, scale, ambient);
            let dragging = state.dragging.load(Ordering::SeqCst);
            let menu = state.menu_open.load(Ordering::SeqCst);
            let click_through = ambient && zone != "core" && !down && !dragging && !menu;
            if ignored != click_through {
                let _ = w.set_ignore_cursor_events(click_through);
                ignored = click_through;
            }
            let key = format!(
                "{zone}:{down}:{dragging}:{menu}:{}:{}:{}:{}",
                rect.x, rect.y, rect.width, rect.height
            );
            if key != last {
                last = key;
                let _=w.emit("faro://mini-pointer",serde_json::json!({"zone":zone,"pressed":down,"dragging":dragging,"menuOpen":menu,"bounds":{"x":rect.x,"y":rect.y,"width":rect.width,"height":rect.height},"scale":scale}));
            }
            if checked.elapsed() > Duration::from_secs(2) && !dragging && !menu {
                checked = Instant::now();
                if let Ok(monitors) = w.available_monitors() {
                    let signature = format!(
                        "{:?}",
                        monitors
                            .iter()
                            .map(|m| (m.name(), m.work_area(), m.scale_factor()))
                            .collect::<Vec<_>>()
                    );
                    if signature != topology {
                        topology = signature;
                        let _ = place(&owner, &w, false);
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clamp_offscreen_and_oversized() {
        let work = Rect {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 875.0,
        };
        let r = clamp_to_visible_bounds(
            Rect {
                x: 1600.0,
                y: -100.0,
                width: 80.0,
                height: 80.0,
            },
            work,
        );
        assert_eq!(
            r,
            Rect {
                x: 1360.0,
                y: 25.0,
                width: 80.0,
                height: 80.0
            }
        );
        let r = clamp_to_visible_bounds(
            Rect {
                x: 0.0,
                y: 0.0,
                width: 1800.0,
                height: 1000.0,
            },
            work,
        );
        assert_eq!(r, work);
    }
    #[test]
    fn negative_monitor_coordinates_and_retina_margins() {
        let work = Rect {
            x: -2560.0,
            y: 46.0,
            width: 2560.0,
            height: 1394.0,
        };
        let r = relative_rect(work, 160.0, 160.0, 1.0, 0.0, 2.0);
        assert_eq!(r.x, -208.0);
        assert_eq!(r.y, 78.0);
    }
    #[test]
    fn monitor_disconnect_and_resolution_change_keep_anchor_visible() {
        let laptop = Rect {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 875.0,
        };
        let saved = relative_rect(laptop, 340.0, 224.0, 1.0, 1.0, 1.0);
        assert!(saved.x + saved.width <= 1440.0);
        assert!(saved.y + saved.height <= 900.0);
        let smaller = Rect {
            x: 0.0,
            y: 25.0,
            width: 1024.0,
            height: 700.0,
        };
        let restored = relative_rect(smaller, 340.0, 224.0, 1.0, 1.0, 1.0);
        assert!(restored.x + restored.width <= 1024.0);
        assert!(restored.y + restored.height <= 725.0);
    }
    #[test]
    fn global_zones_include_near_outside_native_window() {
        let r = Rect {
            x: 100.0,
            y: 100.0,
            width: 80.0,
            height: 80.0,
        };
        assert_eq!(cursor_zone(r, 140.0, 140.0, 1.0, true), "core");
        assert_eq!(cursor_zone(r, 190.0, 140.0, 1.0, true), "near");
        assert_eq!(cursor_zone(r, 400.0, 140.0, 1.0, true), "far");
        assert_eq!(cursor_zone(r, 101.0, 101.0, 1.0, true), "near");
    }
    #[test]
    fn preferences_restore_relative_anchor_not_ephemeral_state() {
        let p = Preferences {
            monitor: Some("External".into()),
            relative_x: 0.3,
            relative_y: 0.6,
            ..Preferences::default()
        };
        let encoded = serde_json::to_string(&p).unwrap();
        assert!(!encoded.contains("listening"));
        assert!(!encoded.contains("transcript"));
        let decoded: Preferences = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.relative_x, 0.3);
    }
    #[test]
    fn every_state_uses_one_existing_window_label_and_bounded_presets() {
        assert_eq!(MINI_LABEL, "mini");
        for state in [
            "ambient",
            "peek",
            "listening",
            "understanding",
            "consulting",
            "awaiting_confirmation",
            "executing",
            "speaking",
            "success",
            "focus_compact",
            "focus_expanded",
            "error",
        ] {
            let (w, h) = preset(state, true).unwrap();
            assert!(w <= 360.0 && h <= 240.0);
        }
        assert_eq!(preset("unknown", false), None);
    }
}

#[tauri::command]
pub fn mini_window_info(app: AppHandle) -> Result<serde_json::Value, String> {
    let w = get_or_create_mini(&app)?;
    let r = window_rect(&w)?;
    let p = w.cursor_position().map_err(|e| e.to_string())?;
    let scale = w.scale_factor().map_err(|e| e.to_string())?;
    let state = app.state::<MiniWindowController>();
    let presentation = state
        .presentation
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    Ok(
        serde_json::json!({"zone":cursor_zone(r,p.x,p.y,scale,presentation.starts_with("ambient")),"pressed":pressed(),"dragging":state.dragging.load(Ordering::SeqCst),"menuOpen":state.menu_open.load(Ordering::SeqCst),"bounds":{"x":r.x,"y":r.y,"width":r.width,"height":r.height},"monitor":w.current_monitor().ok().flatten().and_then(|m|m.name().cloned()),"scale":scale}),
    )
}

pub fn reset_presentation(app: &AppHandle) {
    if let Ok(mut p) = app.state::<MiniWindowController>().presentation.lock() {
        p.clear();
    }
}


pub fn focus_announcement(previous: &serde_json::Value, next: &serde_json::Value) -> Option<&'static str> {
    let before = &previous["focusSession"];
    let after = &next["focusSession"];
    if after["kind"] != "concentration" || before["id"].as_str().is_none()
        || before["id"] != after["id"] { return None; }
    if before["phase"] != "break" && after["phase"] == "break" && after["status"] == "break" {
        Some("Terminó el tiempo de concentración.")
    } else if before["status"] == "break" && after["status"] == "completed" {
        Some("Terminó el tiempo de descanso.")
    } else if before["status"] == "active" && after["status"] == "completed" {
        Some("Terminó el tiempo de concentración.")
    } else { None }
}

pub fn announce_focus(app: &AppHandle, message: &str) {
    announce(app, "FARO · Concentración", message);
}

pub fn announce_calendar_event(app: &AppHandle, message: &str) {
    announce(app, "FARO · Próximo evento", message);
}

fn announce(app: &AppHandle, title: &str, message: &str) {
    use tauri_plugin_notification::NotificationExt;
    if let Err(error) = app.notification().builder().title(title).body(message).show() {
        eprintln!("FARO native notification: {error}");
    }
    #[cfg(target_os = "macos")]
    if let Ok(text) = std::ffi::CString::new(message) {
        unsafe { faro_focus_speak(text.as_ptr()); }
    }
}

#[cfg(target_os = "macos")]
extern "C" { fn faro_focus_speak(text: *const std::ffi::c_char); }

#[cfg(test)]
mod announcement_tests {
    use super::focus_announcement;
    use serde_json::json;
    #[test]
    fn announces_each_phase_once_and_ignores_pause_cancel_and_other_sessions() {
        let active = json!({"focusSession":{"id":"a","kind":"concentration","phase":"focus","status":"active"}});
        let resting = json!({"focusSession":{"id":"a","kind":"concentration","phase":"break","status":"break"}});
        let done = json!({"focusSession":{"id":"a","kind":"concentration","phase":"break","status":"completed"}});
        assert_eq!(focus_announcement(&active, &resting), Some("Terminó el tiempo de concentración."));
        assert_eq!(focus_announcement(&resting, &done), Some("Terminó el tiempo de descanso."));
        assert_eq!(focus_announcement(&resting, &resting), None);
        assert_eq!(focus_announcement(&done, &done), None);
        for status in ["paused", "cancelled"] {
            let mut changed = active.clone(); changed["focusSession"]["status"] = json!(status);
            assert_eq!(focus_announcement(&active, &changed), None);
        }
        let mut other = resting.clone(); other["focusSession"]["id"] = json!("b");
        assert_eq!(focus_announcement(&active, &other), None);
    }
}
