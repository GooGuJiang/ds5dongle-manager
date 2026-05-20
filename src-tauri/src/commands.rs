use crate::hid::{collect_supported_devices, devices_snapshot, error_to_string, open_device_by_path, HidDeviceInfoDto};
use crate::state::{DeviceMonitorState, TrayState};
use hidapi::HidApi;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const SOFTWARE_SETTINGS_FILE_NAME: &str = "software-settings.json";

#[derive(Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoftwareSettings {
    close_to_tray: bool,
    close_to_tray_asked: bool,
    low_battery_notification_enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareSettingsDto {
    pub close_to_tray: bool,
    pub close_to_tray_asked: bool,
    pub low_battery_notification_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoDto {
    os: String,
    arch: String,
}

#[tauri::command]
pub fn ds5_get_system_info() -> SystemInfoDto {
    SystemInfoDto {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[tauri::command]
pub fn ds5_list_devices() -> Result<Vec<HidDeviceInfoDto>, String> {
    let api = HidApi::new().map_err(error_to_string)?;
    Ok(collect_supported_devices(&api))
}

#[tauri::command]
pub fn ds5_start_device_monitor(app: AppHandle, state: State<'_, DeviceMonitorState>) -> Result<(), String> {
    if state
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let running = Arc::clone(&state.running);
    thread::spawn(move || {
        let mut previous_snapshot = String::new();

        while running.load(Ordering::SeqCst) {
            if let Ok(api) = HidApi::new() {
                let devices = collect_supported_devices(&api);
                let snapshot = devices_snapshot(&devices);

                if snapshot != previous_snapshot {
                    previous_snapshot = snapshot;
                    let _ = app.emit("ds5-devices-changed", devices);
                }
            }

            thread::sleep(Duration::from_millis(1_500));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn ds5_read_feature_report(path: String, report_id: u8, length: usize) -> Result<Vec<u8>, String> {
    let api = HidApi::new().map_err(error_to_string)?;
    let device = open_device_by_path(&api, &path)?;
    let mut buffer = vec![0_u8; length.max(1)];
    buffer[0] = report_id;
    let count = device.get_feature_report(&mut buffer).map_err(error_to_string)?;
    buffer.truncate(count);
    Ok(buffer)
}

#[tauri::command]
pub fn ds5_send_feature_report(path: String, report_id: u8, data: Vec<u8>) -> Result<(), String> {
    let api = HidApi::new().map_err(error_to_string)?;
    let device = open_device_by_path(&api, &path)?;
    let mut buffer = Vec::with_capacity(data.len() + 1);
    buffer.push(report_id);
    buffer.extend_from_slice(&data);
    device.send_feature_report(&buffer).map_err(error_to_string)?;
    Ok(())
}

#[tauri::command]
pub fn ds5_read_input_report(path: String, timeout_ms: i32, length: usize) -> Result<Option<Vec<u8>>, String> {
    let api = HidApi::new().map_err(error_to_string)?;
    let device = open_device_by_path(&api, &path)?;
    let mut buffer = vec![0_u8; length.max(1)];
    let count = device
        .read_timeout(&mut buffer, timeout_ms.max(0))
        .map_err(error_to_string)?;

    if count == 0 {
        return Ok(None);
    }

    buffer.truncate(count);
    Ok(Some(buffer))
}

#[tauri::command]
pub fn ds5_update_tray_batteries(
    app: AppHandle,
    state: State<'_, TrayState>,
    batteries: Vec<crate::state::TrayBatteryStatus>,
) -> Result<(), String> {
    let labels = if let Ok(labels) = state.labels.lock() {
        labels.clone()
    } else {
        crate::state::TrayLabels::fallback()
    };

    let battery_lines = normalize_tray_battery_values(batteries);
    let menu_text = format_tray_menu_battery_text(&labels, &battery_lines);
    let tooltip_text = format!("DS5 Dongle Manager\n{}", battery_lines.join("\n"));

    if let Ok(mut current_values) = state.battery_values.lock() {
        *current_values = battery_lines;
    }

    if let Ok(battery_item) = state.battery_item.lock() {
        if let Some(item) = battery_item.as_ref() {
            item.set_text(&menu_text).map_err(|error| error.to_string())?;
        }
    }

    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(tooltip_text)).map_err(|error| error.to_string())?;

        #[cfg(any(target_os = "macos", target_os = "linux"))]
        tray.set_title(Some(menu_text)).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn normalize_tray_battery_values(batteries: Vec<crate::state::TrayBatteryStatus>) -> Vec<String> {
    let values: Vec<String> = batteries
        .into_iter()
        .filter_map(|status| {
            let battery_text = status.battery_text.trim();
            let display_value = if battery_text.is_empty() || battery_text == "--" {
                "--"
            } else {
                battery_text
            };
            let label = status.label.trim();
            if label.is_empty() {
                Some(display_value.to_string())
            } else {
                Some(format!("{label}：{display_value}"))
            }
        })
        .collect();

    values
}

fn format_tray_menu_battery_text(labels: &crate::state::TrayLabels, battery_lines: &[String]) -> String {
    if battery_lines.is_empty() {
        return labels.battery_prefix.to_string();
    }

    if battery_lines.len() <= 1 {
        return format!("{}：{}", labels.battery_prefix, battery_lines.first().map(String::as_str).unwrap_or("--"));
    }

    format!("{}：{}", labels.battery_prefix, battery_lines.join("  |  "))
}

#[allow(dead_code)]
fn _legacy_single_battery_text(battery_text: String) -> String {
    let normalized_text = battery_text.trim();
    let display_value = if normalized_text.is_empty() || normalized_text == "--" {
        "--"
    } else {
        normalized_text
    };
    display_value.to_string()
}

#[tauri::command]
pub fn ds5_update_tray_labels(app: AppHandle, state: State<'_, TrayState>, labels: crate::state::TrayLabels) -> Result<(), String> {
    if let Ok(mut current_labels) = state.labels.lock() {
        *current_labels = labels.clone();
    }

    if let Ok(open_window_item) = state.open_window_item.lock() {
        if let Some(item) = open_window_item.as_ref() {
            item.set_text(&labels.open_window).map_err(|error| error.to_string())?;
        }
    }

    if let Ok(quit_item) = state.quit_item.lock() {
        if let Some(item) = quit_item.as_ref() {
            item.set_text(&labels.quit).map_err(|error| error.to_string())?;
        }
    }

    let battery_values = if let Ok(current_values) = state.battery_values.lock() {
        current_values.clone()
    } else {
        vec!["--".to_string()]
    };
    let menu_text = format_tray_menu_battery_text(&labels, &battery_values);

    if let Ok(battery_item) = state.battery_item.lock() {
        if let Some(item) = battery_item.as_ref() {
            item.set_text(&menu_text).map_err(|error| error.to_string())?;
        }
    }

    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(format!("DS5 Dongle Manager\n{}", battery_values.join("\n"))))
            .map_err(|error| error.to_string())?;

        #[cfg(any(target_os = "macos", target_os = "linux"))]
        tray.set_title(Some(menu_text)).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn ds5_set_close_to_tray(app: AppHandle, state: State<'_, TrayState>, close_to_tray: bool) -> Result<(), String> {
    update_close_to_tray_state(&state, close_to_tray, true)?;
    let mut settings = load_software_settings(&app)?;
    settings.close_to_tray = close_to_tray;
    settings.close_to_tray_asked = true;
    save_software_settings(&app, settings.clone())?;
    emit_software_settings_changed(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn ds5_get_close_to_tray(app: AppHandle, state: State<'_, TrayState>) -> Result<bool, String> {
    let settings = sync_software_settings_state(&app, &state)?;
    let close_to_tray = settings.close_to_tray;
    Ok(close_to_tray)
}

#[tauri::command]
pub fn ds5_get_software_settings(app: AppHandle, state: State<'_, TrayState>) -> Result<SoftwareSettingsDto, String> {
    let settings = sync_software_settings_state(&app, &state)?;
    Ok(settings.into())
}

#[tauri::command]
pub fn ds5_set_low_battery_notification_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load_software_settings(&app)?;
    settings.low_battery_notification_enabled = enabled;
    save_software_settings(&app, settings.clone())?;
    emit_software_settings_changed(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn ds5_get_low_battery_notification_enabled(app: AppHandle) -> Result<bool, String> {
    Ok(load_software_settings(&app)?.low_battery_notification_enabled)
}

fn software_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(SOFTWARE_SETTINGS_FILE_NAME))
        .map_err(|error| error.to_string())
}

fn load_software_settings(app: &AppHandle) -> Result<SoftwareSettings, String> {
    let path = software_settings_path(app)?;
    if !path.exists() {
        return Ok(SoftwareSettings::default());
    }

    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

fn save_software_settings(app: &AppHandle, settings: SoftwareSettings) -> Result<(), String> {
    let path = software_settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let contents = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

pub fn sync_close_to_tray_state(app: &AppHandle, state: &State<'_, TrayState>) -> Result<(), String> {
    sync_software_settings_state(app, state).map(|_| ())
}

fn sync_software_settings_state(app: &AppHandle, state: &State<'_, TrayState>) -> Result<SoftwareSettings, String> {
    let settings = load_software_settings(app)?;
    update_close_to_tray_state(state, settings.close_to_tray, settings.close_to_tray_asked)?;
    Ok(settings)
}

fn update_close_to_tray_state(state: &State<'_, TrayState>, close_to_tray: bool, close_to_tray_asked: bool) -> Result<(), String> {
    *state.close_to_tray.lock().map_err(|error| error.to_string())? = close_to_tray;
    *state.close_to_tray_asked.lock().map_err(|error| error.to_string())? = close_to_tray_asked;
    Ok(())
}

fn emit_software_settings_changed(app: &AppHandle, settings: SoftwareSettings) {
    let _ = app.emit("ds5-software-settings-changed", SoftwareSettingsDto::from(settings));
}

impl From<SoftwareSettings> for SoftwareSettingsDto {
    fn from(settings: SoftwareSettings) -> Self {
        Self {
            close_to_tray: settings.close_to_tray,
            close_to_tray_asked: settings.close_to_tray_asked,
            low_battery_notification_enabled: settings.low_battery_notification_enabled,
        }
    }
}
