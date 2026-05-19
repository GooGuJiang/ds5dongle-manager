mod commands;
mod hid;
mod state;

use commands::{
    ds5_list_devices, ds5_read_feature_report, ds5_read_input_report, ds5_send_feature_report,
    ds5_get_close_to_tray, ds5_set_close_to_tray, ds5_start_device_monitor,
    ds5_update_tray_batteries, ds5_update_tray_labels,
};
use state::{DeviceMonitorState, TrayLabels, TrayState};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DeviceMonitorState {
            running: Arc::new(AtomicBool::new(false)),
        })
        .manage(build_tray_state())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let labels = app
                .state::<TrayState>()
                .labels
                .lock()
                .map(|labels| labels.clone())
                .unwrap_or_else(|_| TrayLabels::fallback());
            let battery_text = format_tray_battery_text(&labels, &["--".to_string()]);
            let open_window = MenuItem::with_id(app, "open_window", &labels.open_window, true, None::<&str>)?;
            let battery = MenuItem::with_id(app, "battery", &battery_text, false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", &labels.quit, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_window, &battery, &quit])?;
            let tray_icon_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/pwa-icon.png");
            let tray_icon = Image::from_path(tray_icon_path)?;

            let tray_state = app.state::<TrayState>();
            if let Ok(mut battery_values) = tray_state.battery_values.lock() {
                *battery_values = vec!["--".to_string()];
            }
            if let Ok(mut open_window_item) = tray_state.open_window_item.lock() {
                *open_window_item = Some(open_window.clone());
            }
            if let Ok(mut battery_item) = tray_state.battery_item.lock() {
                *battery_item = Some(battery.clone());
            }
            if let Ok(mut quit_item) = tray_state.quit_item.lock() {
                *quit_item = Some(quit.clone());
            }

            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip(format!("DS5 Dongle Manager\n{battery_text}"))
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open_window" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .app_handle()
                    .state::<TrayState>()
                    .close_to_tray
                    .lock()
                    .map(|value| *value)
                    .unwrap_or(false);

                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ds5_list_devices,
            ds5_start_device_monitor,
            ds5_read_feature_report,
            ds5_send_feature_report,
            ds5_read_input_report,
            ds5_update_tray_batteries,
            ds5_update_tray_labels,
            ds5_set_close_to_tray,
            ds5_get_close_to_tray
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
        open_window_item: std::sync::Mutex::new(None),
        battery_item: std::sync::Mutex::new(None),
        quit_item: std::sync::Mutex::new(None),
    }
}

fn format_tray_battery_text(labels: &TrayLabels, battery_values: &[String]) -> String {
    format!("{}：{}", labels.battery_prefix, battery_values.join(" / "))
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
