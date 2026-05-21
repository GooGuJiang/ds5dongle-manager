mod app_config;
mod commands;
mod hid;
mod state;

use app_config::{
    CONTROLLER_NOTIFICATION_HEIGHT, CONTROLLER_NOTIFICATION_LABEL, CONTROLLER_NOTIFICATION_MARGIN,
    CONTROLLER_NOTIFICATION_WIDTH, CONTROLLER_NOTIFICATION_COLLAPSED_WIDTH, TRAY_POPUP_BATTERY_HEIGHT,
    TRAY_POPUP_LABEL, TRAY_POPUP_MIN_HEIGHT, TRAY_POPUP_WIDTH,
};
use commands::{
    ds5_get_software_settings,
    ds5_get_system_info, ds5_list_devices, ds5_read_feature_report, ds5_read_input_report, ds5_send_feature_report,
    ds5_get_close_to_tray, ds5_set_close_to_tray, ds5_start_device_monitor,
    ds5_get_tray_batteries, ds5_hide_controller_notification, ds5_hide_tray_popup, ds5_open_main_window, ds5_quit_app,
    ds5_get_controller_notification_sound_enabled, ds5_get_controller_notification_sound_volumes,
    ds5_get_controller_connection_popup_enabled, ds5_get_controller_low_battery_popup_enabled,
    ds5_get_controller_notification_popup_duration_ms,
    ds5_get_low_battery_notification_enabled, ds5_make_controller_notification_input_safe, ds5_play_controller_notification_sound,
    ds5_set_controller_connection_popup_enabled, ds5_set_controller_low_battery_popup_enabled,
    ds5_set_controller_notification_popup_duration_ms,
    ds5_reset_controller_notification_sound_volumes, ds5_set_controller_notification_sound_enabled,
    ds5_set_controller_notification_sound_volume, ds5_set_low_battery_notification_enabled, ds5_show_controller_notification,
    ds5_update_tray_batteries, ds5_update_tray_labels,
};
use state::{DeviceMonitorState, TrayLabels, TrayState};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{
    Emitter,
    image::Image,
    PhysicalPosition, PhysicalSize,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::Color,
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerNotificationPayload {
    pub kind: String,
    pub device_label: String,
    pub icon_src: String,
    pub battery_text: String,
    pub battery_texts: Vec<String>,
    pub duration_ms: Option<u64>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .manage(DeviceMonitorState {
            running: Arc::new(AtomicBool::new(false)),
        })
        .manage(build_tray_state())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Err(error) = commands::sync_close_to_tray_state(&app.handle(), &app.state::<TrayState>()) {
                eprintln!("failed to load software settings: {error}");
            }

            let tray_popup_builder = WebviewWindowBuilder::new(app, TRAY_POPUP_LABEL, WebviewUrl::App("/?tray=1".into()))
                .title("DS5 Dongle Manager Tray")
                .inner_size(TRAY_POPUP_WIDTH, TRAY_POPUP_MIN_HEIGHT)
                .min_inner_size(TRAY_POPUP_WIDTH, TRAY_POPUP_MIN_HEIGHT)
                .max_inner_size(TRAY_POPUP_WIDTH, TRAY_POPUP_BATTERY_HEIGHT)
                .decorations(false);

            #[cfg(not(target_os = "macos"))]
            let tray_popup_builder = tray_popup_builder.transparent(true);

            tray_popup_builder
                .resizable(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .visible(false)
                .build()?;

            let controller_notification_builder = WebviewWindowBuilder::new(
                app,
                CONTROLLER_NOTIFICATION_LABEL,
                WebviewUrl::App("/?controllerNotification=1".into()),
            )
                .title("DS5 Dongle Manager Controller Notification")
                .inner_size(CONTROLLER_NOTIFICATION_COLLAPSED_WIDTH, CONTROLLER_NOTIFICATION_HEIGHT)
                .min_inner_size(CONTROLLER_NOTIFICATION_COLLAPSED_WIDTH, CONTROLLER_NOTIFICATION_HEIGHT)
                .max_inner_size(CONTROLLER_NOTIFICATION_WIDTH, CONTROLLER_NOTIFICATION_HEIGHT)
                .decorations(false);

            #[cfg(not(target_os = "macos"))]
            let controller_notification_builder = controller_notification_builder.transparent(true);

            controller_notification_builder
                .background_color(Color(0, 0, 0, 0))
                .shadow(false)
                .resizable(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .visible(false)
                .build()?;

            let labels = app
                .state::<TrayState>()
                .labels
                .lock()
                .map(|labels| labels.clone())
                .unwrap_or_else(|_| TrayLabels::fallback());
            let battery_text = format_tray_battery_text(&labels, &[]);
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

            let tray_state = app.state::<TrayState>();
            if let Ok(mut battery_values) = tray_state.battery_values.lock() {
                *battery_values = Vec::new();
            }

            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .tooltip(format!("DS5 Dongle Manager\n{battery_text}"))
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        match button {
                            MouseButton::Left => show_main_window(tray.app_handle()),
                            MouseButton::Right => show_tray_popup(tray.app_handle(), position),
                            _ => {}
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == TRAY_POPUP_LABEL {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
                return;
            }

            if window.label() == CONTROLLER_NOTIFICATION_LABEL {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<TrayState>();
                let close_to_tray = state.close_to_tray.lock().map(|value| *value).unwrap_or(false);

                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ds5_get_system_info,
            ds5_list_devices,
            ds5_start_device_monitor,
            ds5_read_feature_report,
            ds5_send_feature_report,
            ds5_read_input_report,
            ds5_update_tray_batteries,
            ds5_update_tray_labels,
            ds5_get_software_settings,
            ds5_set_close_to_tray,
            ds5_get_close_to_tray,
            ds5_set_low_battery_notification_enabled,
            ds5_get_low_battery_notification_enabled,
            ds5_set_controller_connection_popup_enabled,
            ds5_get_controller_connection_popup_enabled,
            ds5_set_controller_low_battery_popup_enabled,
            ds5_get_controller_low_battery_popup_enabled,
            ds5_set_controller_notification_popup_duration_ms,
            ds5_get_controller_notification_popup_duration_ms,
            ds5_set_controller_notification_sound_enabled,
            ds5_get_controller_notification_sound_enabled,
            ds5_get_controller_notification_sound_volumes,
            ds5_set_controller_notification_sound_volume,
            ds5_reset_controller_notification_sound_volumes,
            ds5_play_controller_notification_sound,
            ds5_show_controller_notification,
            ds5_hide_controller_notification,
            ds5_make_controller_notification_input_safe,
            ds5_open_main_window,
            ds5_hide_tray_popup,
            ds5_get_tray_batteries,
            ds5_quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_tray_state() -> TrayState {
    let labels = TrayLabels::fallback();
    TrayState {
        battery_values: std::sync::Mutex::new(vec!["--".to_string()]),
        labels: std::sync::Mutex::new(labels),
        close_to_tray: std::sync::Mutex::new(false),
        close_to_tray_asked: std::sync::Mutex::new(false),
        low_battery_notified_keys: std::sync::Mutex::new(std::collections::HashSet::new()),
        open_window_item: std::sync::Mutex::new(None),
        battery_item: std::sync::Mutex::new(None),
        quit_item: std::sync::Mutex::new(None),
    }
}

fn format_tray_battery_text(labels: &TrayLabels, battery_values: &[String]) -> String {
    if battery_values.is_empty() {
        return labels.battery_prefix.to_string();
    }

    format!("{}：{}", labels.battery_prefix, battery_values.join(" / "))
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_tray_popup(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(TRAY_POPUP_LABEL) {
        let _ = window.hide();
    }
}

pub fn open_main_window_from_tray(app: &tauri::AppHandle) {
    hide_tray_popup(app);
    show_main_window(app);
}

pub fn hide_controller_notification(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(CONTROLLER_NOTIFICATION_LABEL) {
        let _ = window.hide();
    }
}

pub fn make_controller_notification_input_safe(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(CONTROLLER_NOTIFICATION_LABEL) else {
        return Ok(());
    };

    let _ = window.set_focusable(false);
    let _ = window.set_ignore_cursor_events(true);

    #[cfg(target_os = "windows")]
    apply_windows_no_input_styles(&window).map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_windows_no_input_styles(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMNCRP_DISABLED, DWMWA_NCRENDERING_POLICY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TRANSPARENT,
    };

    let hwnd = window.hwnd()?;

    unsafe {
        let current_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_style = current_style
            | WS_EX_NOACTIVATE.0 as isize
            | WS_EX_TRANSPARENT.0 as isize
            | WS_EX_LAYERED.0 as isize
            | WS_EX_TOOLWINDOW.0 as isize;

        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);

        let policy = DWMNCRP_DISABLED;
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY,
            &policy as *const _ as *const _,
            std::mem::size_of_val(&policy) as u32,
        )?;

        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )?;
    }

    Ok(())
}

pub fn show_controller_notification(app: &tauri::AppHandle, payload: ControllerNotificationPayload) {
    let Some(window) = app.get_webview_window(CONTROLLER_NOTIFICATION_LABEL) else {
        return;
    };

    let _ = make_controller_notification_input_safe(app);

    let monitor_rect = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            (
                position.x as f64,
                position.y as f64,
                position.x as f64 + size.width as f64,
                position.y as f64 + size.height as f64,
                monitor.scale_factor(),
            )
        });

    let (left, top, right, _bottom, scale_factor) = monitor_rect.unwrap_or((0.0, 0.0, 1920.0, 1080.0, 1.0));
    let notification_height = CONTROLLER_NOTIFICATION_HEIGHT * scale_factor;
    let collapsed_width = CONTROLLER_NOTIFICATION_COLLAPSED_WIDTH * scale_factor;
    let margin = CONTROLLER_NOTIFICATION_MARGIN * scale_factor;
    let x = (right - collapsed_width - margin).max(left + margin);
    let y = top + margin;

    let _ = window.set_size(PhysicalSize::new(
        collapsed_width.round().max(1.0) as u32,
        notification_height.round().max(1.0) as u32,
    ));
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    let _ = window.show();
    let _ = window.emit("ds5-controller-notification", payload);
}

pub fn resize_tray_popup(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(TRAY_POPUP_LABEL) else {
        return;
    };

    if !window.is_visible().unwrap_or(false) {
        return;
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let popup_width = (TRAY_POPUP_WIDTH * scale_factor).round().max(1.0) as u32;
    let popup_height = (tray_popup_height(app) * scale_factor).round().max(1.0) as u32;
    let _ = window.set_size(PhysicalSize::new(popup_width, popup_height));
}

fn show_tray_popup(app: &tauri::AppHandle, tray_position: PhysicalPosition<f64>) {
    let Some(window) = app.get_webview_window(TRAY_POPUP_LABEL) else {
        return;
    };

    let tray_x = tray_position.x;
    let tray_y = tray_position.y;
    let monitor_rect = app
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find_map(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                let left = position.x as f64;
                let top = position.y as f64;
                let right = left + size.width as f64;
                let bottom = top + size.height as f64;

                if tray_x >= left && tray_x <= right && tray_y >= top && tray_y <= bottom {
                    Some((left, top, right, bottom, monitor.scale_factor()))
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            window
                .current_monitor()
                .ok()
                .flatten()
                .map(|monitor| {
                    let position = monitor.position();
                    let size = monitor.size();
                    let left = position.x as f64;
                    let top = position.y as f64;
                    let right = left + size.width as f64;
                    let bottom = top + size.height as f64;
                    (left, top, right, bottom, monitor.scale_factor())
                })
        });

    let (left, top, right, bottom, scale_factor) = monitor_rect.unwrap_or((0.0, 0.0, 1920.0, 1080.0, 1.0));
    let popup_height_base = tray_popup_height(app);
    let popup_width = TRAY_POPUP_WIDTH * scale_factor;
    let popup_height = popup_height_base * scale_factor;
    let margin = 2.0 * scale_factor;
    let mut x = tray_x;
    let mut y = tray_y - popup_height;

    if x + popup_width > right - margin {
        x = right - popup_width - margin;
    }
    if x < left + margin {
        x = left + margin;
    }

    if y < top + margin {
        y = tray_y + margin;
    }
    if y + popup_height > bottom - margin {
        y = bottom - popup_height - margin;
    }

    let _ = window.set_size(PhysicalSize::new(popup_width.round().max(1.0) as u32, popup_height.round().max(1.0) as u32));
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    let _ = window.show();
    let _ = window.set_focus();
}

fn tray_popup_height(app: &tauri::AppHandle) -> f64 {
    let has_batteries = app
        .try_state::<TrayState>()
        .and_then(|state| {
            state.battery_values.lock().ok().map(|values| {
                values
                    .iter()
                    .any(|value| !value.trim().is_empty() && value.trim() != "--")
            })
        })
        .unwrap_or(false);

    if has_batteries {
        TRAY_POPUP_BATTERY_HEIGHT
    } else {
        TRAY_POPUP_MIN_HEIGHT
    }
}
