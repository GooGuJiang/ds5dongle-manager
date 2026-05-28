use crate::app_config::{
    CONTROLLER_CONNECTED_SOUND, CONTROLLER_DISCONNECTED_SOUND, CONTROLLER_LOW_BATTERY_SOUND,
    LOW_BATTERY_THRESHOLD_PERCENT, SOFTWARE_SETTINGS_FILE_NAME,
};
use crate::hid::{
    collect_supported_devices, devices_snapshot, error_to_string, open_device_by_path,
    HidDeviceInfoDto,
};
use crate::state::{DeviceMonitorState, TrayState};
use hidapi::HidApi;
use rodio::{Decoder, OutputStream, Sink};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct SoftwareSettings {
    autostart_enabled: bool,
    start_minimized: bool,
    close_to_tray: bool,
    close_to_tray_asked: bool,
    low_battery_notification_enabled: bool,
    controller_connection_popup_enabled: bool,
    controller_low_battery_popup_enabled: bool,
    controller_notification_popup_duration_ms: u64,
    controller_notification_sound_enabled: bool,
    controller_notification_sound_volumes: ControllerNotificationSoundVolumes,
}

impl Default for SoftwareSettings {
    fn default() -> Self {
        Self {
            autostart_enabled: false,
            start_minimized: false,
            close_to_tray: false,
            close_to_tray_asked: false,
            low_battery_notification_enabled: true,
            controller_connection_popup_enabled: true,
            controller_low_battery_popup_enabled: true,
            controller_notification_popup_duration_ms: 4_000,
            controller_notification_sound_enabled: true,
            controller_notification_sound_volumes: ControllerNotificationSoundVolumes::default(),
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerNotificationSoundVolumes {
    connected: f32,
    disconnected: f32,
    low_battery: f32,
}

impl Default for ControllerNotificationSoundVolumes {
    fn default() -> Self {
        Self {
            connected: 0.65,
            disconnected: 0.65,
            low_battery: 0.75,
        }
    }
}

impl ControllerNotificationSoundVolumes {
    fn normalized(self) -> Self {
        Self {
            connected: normalize_volume(self.connected),
            disconnected: normalize_volume(self.disconnected),
            low_battery: normalize_volume(self.low_battery),
        }
    }

    fn volume_for(&self, sound: &ControllerNotificationSound) -> f32 {
        match sound {
            ControllerNotificationSound::Connected => self.connected,
            ControllerNotificationSound::Disconnected => self.disconnected,
            ControllerNotificationSound::LowBattery => self.low_battery,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareSettingsDto {
    pub autostart_enabled: bool,
    pub start_minimized: bool,
    pub close_to_tray: bool,
    pub close_to_tray_asked: bool,
    pub low_battery_notification_enabled: bool,
    pub controller_connection_popup_enabled: bool,
    pub controller_low_battery_popup_enabled: bool,
    pub controller_notification_popup_duration_ms: u64,
    pub controller_notification_sound_enabled: bool,
    pub controller_notification_sound_volumes: ControllerNotificationSoundVolumes,
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
pub fn ds5_open_main_window(app: AppHandle) {
    crate::open_main_window_from_tray(&app);
}

#[tauri::command]
pub fn ds5_hide_tray_popup(app: AppHandle) {
    crate::hide_tray_popup(&app);
}

#[tauri::command]
pub fn ds5_show_controller_notification(
    app: AppHandle,
    kind: Option<String>,
    device_label: String,
    icon_src: Option<String>,
    battery_text: String,
    battery_texts: Option<Vec<String>>,
) {
    let normalized_battery_texts =
        normalize_controller_notification_batteries(&battery_text, battery_texts);
    crate::show_controller_notification(
        &app,
        crate::ControllerNotificationPayload {
            kind: kind
                .map(|value| value.trim().to_string())
                .filter(|value| {
                    matches!(value.as_str(), "connected" | "disconnected" | "lowBattery")
                })
                .unwrap_or_else(|| "connected".to_string()),
            device_label,
            icon_src: icon_src
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "/svg/ps5-controller-gamepad-seeklogo.svg".to_string()),
            battery_text,
            battery_texts: normalized_battery_texts,
            duration_ms: None,
        },
    );
}

fn normalize_controller_notification_batteries(
    battery_text: &str,
    battery_texts: Option<Vec<String>>,
) -> Vec<String> {
    let values = battery_texts.unwrap_or_default();
    let normalized: Vec<String> = values
        .into_iter()
        .flat_map(|value| split_battery_text(&value))
        .filter(|value| !value.is_empty() && value != "--")
        .collect();

    if !normalized.is_empty() {
        return normalized;
    }

    split_battery_text(battery_text)
        .into_iter()
        .filter(|value| !value.is_empty() && value != "--")
        .collect()
}

fn split_battery_text(value: &str) -> Vec<String> {
    value
        .split(|character| matches!(character, '/' | '|' | '\n' | '\r'))
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

#[tauri::command]
pub fn ds5_hide_controller_notification(app: AppHandle) {
    crate::hide_controller_notification(&app);
}

#[tauri::command]
pub fn ds5_make_controller_notification_input_safe(app: AppHandle) -> Result<(), String> {
    crate::make_controller_notification_input_safe(&app)
}

#[tauri::command]
pub fn ds5_get_tray_batteries(state: State<'_, TrayState>) -> Vec<String> {
    state
        .battery_values
        .lock()
        .map(|values| values.clone())
        .unwrap_or_else(|_| Vec::new())
}

#[tauri::command]
pub fn ds5_quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub async fn ds5_set_autostart_enabled(
    app: AppHandle,
    enabled: bool,
    start_minimized: bool,
) -> Result<SoftwareSettingsDto, String> {
    let autostart_manager = app.autolaunch();

    if enabled {
        autostart_manager
            .enable()
            .map_err(|error| error.to_string())?;
    } else {
        autostart_manager
            .disable()
            .map_err(|error| error.to_string())?;
    }

    let mut settings = load_software_settings_async(app.clone()).await?;
    settings.autostart_enabled = autostart_manager
        .is_enabled()
        .map_err(|error| error.to_string())?;
    settings.start_minimized = if settings.autostart_enabled {
        start_minimized
    } else {
        false
    };
    save_software_settings_async(app.clone(), settings.clone()).await?;
    emit_software_settings_changed(&app, settings.clone());
    Ok(settings.into())
}

#[tauri::command]
pub async fn ds5_get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ds5_list_devices() -> Result<Vec<HidDeviceInfoDto>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let api = HidApi::new().map_err(error_to_string)?;
        Ok(collect_supported_devices(&api))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn ds5_start_device_monitor(
    app: AppHandle,
    state: State<'_, DeviceMonitorState>,
) -> Result<(), String> {
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
pub async fn ds5_read_feature_report(
    path: String,
    report_id: u8,
    length: usize,
) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let api = HidApi::new().map_err(error_to_string)?;
        let device = open_device_by_path(&api, &path)?;
        let mut buffer = vec![0_u8; length.max(1)];
        buffer[0] = report_id;
        let count = device
            .get_feature_report(&mut buffer)
            .map_err(error_to_string)?;
        buffer.truncate(count);
        Ok(buffer)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn ds5_send_feature_report(
    path: String,
    report_id: u8,
    data: Vec<u8>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let api = HidApi::new().map_err(error_to_string)?;
        let device = open_device_by_path(&api, &path)?;
        let mut buffer = Vec::with_capacity(data.len() + 1);
        buffer.push(report_id);
        buffer.extend_from_slice(&data);
        device
            .send_feature_report(&buffer)
            .map_err(error_to_string)?;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn ds5_read_input_report(
    path: String,
    timeout_ms: i32,
    length: usize,
) -> Result<Option<Vec<u8>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn ds5_update_tray_batteries(
    app: AppHandle,
    state: State<'_, TrayState>,
    batteries: Vec<crate::state::TrayBatteryStatus>,
) -> Result<(), String> {
    let battery_lines = normalize_tray_battery_values(batteries.clone());
    let changed = if let Ok(mut current_values) = state.battery_values.lock() {
        if *current_values == battery_lines {
            false
        } else {
            *current_values = battery_lines.clone();
            true
        }
    } else {
        true
    };

    if !changed {
        return Ok(());
    }

    let settings = load_software_settings_async(app.clone()).await?;
    process_low_battery_notifications(&app, &state, &settings, &batteries);

    let labels = if let Ok(labels) = state.labels.lock() {
        labels.clone()
    } else {
        crate::state::TrayLabels::fallback()
    };
    crate::resize_tray_popup(&app);
    let _ = app.emit("ds5-tray-batteries-changed", battery_lines.clone());
    let menu_text = format_tray_menu_battery_text(&labels, &battery_lines);
    let tooltip_text = format!("DS5 Dongle Manager\n{}", battery_lines.join("\n"));

    let battery_item = state.battery_item.lock().ok().and_then(|item| item.clone());
    if let Some(item) = battery_item.as_ref() {
        item.set_text(&menu_text)
            .map_err(|error| error.to_string())?;
    }

    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(tooltip_text))
            .map_err(|error| error.to_string())?;

        #[cfg(any(target_os = "macos", target_os = "linux"))]
        tray.set_title(Some(menu_text))
            .map_err(|error| error.to_string())?;
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

fn process_low_battery_notifications(
    app: &AppHandle,
    state: &State<'_, TrayState>,
    settings: &SoftwareSettings,
    batteries: &[crate::state::TrayBatteryStatus],
) {
    if !settings.low_battery_notification_enabled {
        if let Ok(mut notified_keys) = state.low_battery_notified_keys.lock() {
            notified_keys.clear();
        }
        return;
    }

    let Ok(mut notified_keys) = state.low_battery_notified_keys.lock() else {
        return;
    };
    for status in batteries {
        let device_key = status.device_key.trim();
        if device_key.is_empty() {
            continue;
        }

        let percent = parse_battery_percent(&status.battery_text);
        if percent.map_or(true, |value| value > LOW_BATTERY_THRESHOLD_PERCENT) {
            notified_keys.remove(device_key);
            continue;
        }

        if !notified_keys.insert(device_key.to_string()) {
            continue;
        }

        let _ = play_controller_notification_sound_with_settings(
            app,
            ControllerNotificationSound::LowBattery,
            settings,
        );
    }
}

fn parse_battery_percent(battery_text: &str) -> Option<u8> {
    let percent_text = battery_text.trim().split('%').next()?.trim();
    percent_text.parse::<u8>().ok()
}

fn format_tray_menu_battery_text(
    labels: &crate::state::TrayLabels,
    battery_lines: &[String],
) -> String {
    if battery_lines.is_empty() {
        return labels.battery_prefix.to_string();
    }

    if battery_lines.len() <= 1 {
        return format!(
            "{}：{}",
            labels.battery_prefix,
            battery_lines.first().map(String::as_str).unwrap_or("--")
        );
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
pub fn ds5_update_tray_labels(
    app: AppHandle,
    state: State<'_, TrayState>,
    labels: crate::state::TrayLabels,
) -> Result<(), String> {
    if let Ok(mut current_labels) = state.labels.lock() {
        *current_labels = labels.clone();
    }

    let open_window_item = state
        .open_window_item
        .lock()
        .ok()
        .and_then(|item| item.clone());
    if let Some(item) = open_window_item.as_ref() {
        item.set_text(&labels.open_window)
            .map_err(|error| error.to_string())?;
    }

    let quit_item = state.quit_item.lock().ok().and_then(|item| item.clone());
    if let Some(item) = quit_item.as_ref() {
        item.set_text(&labels.quit)
            .map_err(|error| error.to_string())?;
    }

    let battery_values = if let Ok(current_values) = state.battery_values.lock() {
        current_values.clone()
    } else {
        vec!["--".to_string()]
    };
    let menu_text = format_tray_menu_battery_text(&labels, &battery_values);

    let battery_item = state.battery_item.lock().ok().and_then(|item| item.clone());
    if let Some(item) = battery_item.as_ref() {
        item.set_text(&menu_text)
            .map_err(|error| error.to_string())?;
    }

    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(format!(
            "DS5 Dongle Manager\n{}",
            battery_values.join("\n")
        )))
        .map_err(|error| error.to_string())?;

        #[cfg(any(target_os = "macos", target_os = "linux"))]
        tray.set_title(Some(menu_text))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn ds5_set_close_to_tray(
    app: AppHandle,
    state: State<'_, TrayState>,
    close_to_tray: bool,
) -> Result<(), String> {
    update_close_to_tray_state(&state, close_to_tray, true)?;
    let mut settings = load_software_settings_async(app.clone()).await?;
    settings.close_to_tray = close_to_tray;
    settings.close_to_tray_asked = true;
    save_software_settings_async(app.clone(), settings.clone()).await?;
    emit_software_settings_changed(&app, settings);
    Ok(())
}

#[tauri::command]
pub async fn ds5_get_close_to_tray(
    app: AppHandle,
    state: State<'_, TrayState>,
) -> Result<bool, String> {
    let settings = sync_software_settings_state_async(app, &state).await?;
    let close_to_tray = settings.close_to_tray;
    Ok(close_to_tray)
}

#[tauri::command]
pub async fn ds5_get_software_settings(
    app: AppHandle,
    state: State<'_, TrayState>,
) -> Result<SoftwareSettingsDto, String> {
    let settings = sync_software_settings_state_async(app, &state).await?;
    Ok(settings.into())
}

#[tauri::command]
pub async fn ds5_set_low_battery_notification_enabled(
    app: AppHandle,
    state: State<'_, TrayState>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = load_software_settings_async(app.clone()).await?;
    settings.low_battery_notification_enabled = enabled;
    if !enabled {
        if let Ok(mut notified_keys) = state.low_battery_notified_keys.lock() {
            notified_keys.clear();
        }
    }
    save_software_settings_async(app.clone(), settings.clone()).await?;
    emit_software_settings_changed(&app, settings);
    Ok(())
}

#[tauri::command]
pub async fn ds5_get_low_battery_notification_enabled(app: AppHandle) -> Result<bool, String> {
    Ok(load_software_settings_async(app)
        .await?
        .low_battery_notification_enabled)
}

#[tauri::command]
pub async fn ds5_set_controller_connection_popup_enabled(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = load_software_settings_async(app.clone()).await?;
    settings.controller_connection_popup_enabled = enabled;
    save_software_settings_async(app.clone(), settings.clone()).await?;
    emit_software_settings_changed(&app, settings);
    Ok(())
}

#[tauri::command]
pub async fn ds5_get_controller_connection_popup_enabled(app: AppHandle) -> Result<bool, String> {
    Ok(load_software_settings_async(app)
        .await?
        .controller_connection_popup_enabled)
}

#[tauri::command]
pub async fn ds5_set_controller_low_battery_popup_enabled(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = load_software_settings_async(app.clone()).await?;
    settings.controller_low_battery_popup_enabled = enabled;
    save_software_settings_async(app.clone(), settings.clone()).await?;
    emit_software_settings_changed(&app, settings);
    Ok(())
}

#[tauri::command]
pub async fn ds5_get_controller_low_battery_popup_enabled(app: AppHandle) -> Result<bool, String> {
    Ok(load_software_settings_async(app)
        .await?
        .controller_low_battery_popup_enabled)
}

#[tauri::command]
pub async fn ds5_set_controller_notification_popup_duration_ms(
    app: AppHandle,
    duration_ms: u64,
) -> Result<u64, String> {
    let mut settings = load_software_settings_async(app.clone()).await?;
    settings.controller_notification_popup_duration_ms = normalize_popup_duration_ms(duration_ms);
    save_software_settings_async(app.clone(), settings.clone()).await?;
    emit_software_settings_changed(&app, settings.clone());
    Ok(settings.controller_notification_popup_duration_ms)
}

#[tauri::command]
pub async fn ds5_get_controller_notification_popup_duration_ms(
    app: AppHandle,
) -> Result<u64, String> {
    Ok(normalize_popup_duration_ms(
        load_software_settings_async(app)
            .await?
            .controller_notification_popup_duration_ms,
    ))
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControllerNotificationSound {
    Connected,
    Disconnected,
    LowBattery,
}

#[tauri::command]
pub async fn ds5_set_controller_notification_sound_enabled(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = load_software_settings_async(app.clone()).await?;
    settings.controller_notification_sound_enabled = enabled;
    save_software_settings_async(app.clone(), settings.clone()).await?;
    emit_software_settings_changed(&app, settings);
    Ok(())
}

#[tauri::command]
pub async fn ds5_get_controller_notification_sound_enabled(app: AppHandle) -> Result<bool, String> {
    Ok(load_software_settings_async(app)
        .await?
        .controller_notification_sound_enabled)
}

#[tauri::command]
pub async fn ds5_get_controller_notification_sound_volumes(
    app: AppHandle,
) -> Result<ControllerNotificationSoundVolumes, String> {
    Ok(load_software_settings_async(app)
        .await?
        .controller_notification_sound_volumes
        .normalized())
}

#[tauri::command]
pub async fn ds5_set_controller_notification_sound_volume(
    app: AppHandle,
    sound: ControllerNotificationSound,
    volume: f32,
) -> Result<ControllerNotificationSoundVolumes, String> {
    let mut settings = load_software_settings_async(app.clone()).await?;
    let normalized_volume = normalize_volume(volume);
    match sound {
        ControllerNotificationSound::Connected => {
            settings.controller_notification_sound_volumes.connected = normalized_volume
        }
        ControllerNotificationSound::Disconnected => {
            settings.controller_notification_sound_volumes.disconnected = normalized_volume
        }
        ControllerNotificationSound::LowBattery => {
            settings.controller_notification_sound_volumes.low_battery = normalized_volume
        }
    }
    settings.controller_notification_sound_volumes =
        settings.controller_notification_sound_volumes.normalized();
    save_software_settings_async(app.clone(), settings.clone()).await?;
    emit_software_settings_changed(&app, settings.clone());
    Ok(settings.controller_notification_sound_volumes)
}

#[tauri::command]
pub async fn ds5_reset_controller_notification_sound_volumes(
    app: AppHandle,
) -> Result<ControllerNotificationSoundVolumes, String> {
    let mut settings = load_software_settings_async(app.clone()).await?;
    settings.controller_notification_sound_volumes = ControllerNotificationSoundVolumes::default();
    save_software_settings_async(app.clone(), settings.clone()).await?;
    emit_software_settings_changed(&app, settings.clone());
    Ok(settings.controller_notification_sound_volumes)
}

#[tauri::command]
pub async fn ds5_play_controller_notification_sound(
    app: AppHandle,
    sound: ControllerNotificationSound,
) -> Result<(), String> {
    let settings = load_software_settings_async(app.clone()).await?;
    play_controller_notification_sound_with_settings(&app, sound, &settings)
}

fn play_controller_notification_sound_with_settings(
    app: &AppHandle,
    sound: ControllerNotificationSound,
    settings: &SoftwareSettings,
) -> Result<(), String> {
    if !settings.controller_notification_sound_enabled {
        return Ok(());
    }

    let volume = settings
        .clone()
        .controller_notification_sound_volumes
        .normalized()
        .volume_for(&sound);
    if volume <= 0.0 {
        return Ok(());
    }

    let resource = match sound {
        ControllerNotificationSound::Connected => CONTROLLER_CONNECTED_SOUND,
        ControllerNotificationSound::Disconnected => CONTROLLER_DISCONNECTED_SOUND,
        ControllerNotificationSound::LowBattery => CONTROLLER_LOW_BATTERY_SOUND,
    };
    let sound_path = app
        .path()
        .resolve(resource, BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;

    thread::spawn(move || {
        if let Ok(file) = fs::File::open(sound_path) {
            if let Ok((_stream, stream_handle)) = OutputStream::try_default() {
                if let Ok(sink) = Sink::try_new(&stream_handle) {
                    sink.set_volume(volume);
                    if let Ok(source) = Decoder::new(BufReader::new(file)) {
                        sink.append(source);
                        sink.sleep_until_end();
                    }
                }
            }
        }
    });

    Ok(())
}

fn normalize_volume(volume: f32) -> f32 {
    if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn normalize_popup_duration_ms(duration_ms: u64) -> u64 {
    duration_ms.clamp(2_000, 15_000)
}

fn software_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(SOFTWARE_SETTINGS_FILE_NAME))
        .map_err(|error| error.to_string())
}

fn load_software_settings(app: &AppHandle) -> Result<SoftwareSettings, String> {
    load_software_settings_from_path(software_settings_path(app)?)
}

pub fn load_start_minimized_setting(app: &AppHandle) -> Result<bool, String> {
    Ok(load_software_settings(app)?.start_minimized)
}

fn load_software_settings_from_path(path: PathBuf) -> Result<SoftwareSettings, String> {
    if !path.exists() {
        return Ok(SoftwareSettings::default());
    }

    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

async fn load_software_settings_async(app: AppHandle) -> Result<SoftwareSettings, String> {
    let path = software_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || load_software_settings_from_path(path))
        .await
        .map_err(|error| error.to_string())?
}

fn save_software_settings_to_path(path: PathBuf, settings: SoftwareSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let contents = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

async fn save_software_settings_async(
    app: AppHandle,
    settings: SoftwareSettings,
) -> Result<(), String> {
    let path = software_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || save_software_settings_to_path(path, settings))
        .await
        .map_err(|error| error.to_string())?
}

pub fn sync_close_to_tray_state(
    app: &AppHandle,
    state: &State<'_, TrayState>,
) -> Result<(), String> {
    sync_software_settings_state(app, state).map(|_| ())
}

fn sync_software_settings_state(
    app: &AppHandle,
    state: &State<'_, TrayState>,
) -> Result<SoftwareSettings, String> {
    let mut settings = load_software_settings(app)?;
    settings.autostart_enabled = app
        .autolaunch()
        .is_enabled()
        .unwrap_or(settings.autostart_enabled);
    update_close_to_tray_state(state, settings.close_to_tray, settings.close_to_tray_asked)?;
    Ok(settings)
}

async fn sync_software_settings_state_async(
    app: AppHandle,
    state: &State<'_, TrayState>,
) -> Result<SoftwareSettings, String> {
    let mut settings = load_software_settings_async(app.clone()).await?;
    settings.autostart_enabled = app
        .autolaunch()
        .is_enabled()
        .unwrap_or(settings.autostart_enabled);
    update_close_to_tray_state(state, settings.close_to_tray, settings.close_to_tray_asked)?;
    Ok(settings)
}

fn update_close_to_tray_state(
    state: &State<'_, TrayState>,
    close_to_tray: bool,
    close_to_tray_asked: bool,
) -> Result<(), String> {
    *state
        .close_to_tray
        .lock()
        .map_err(|error| error.to_string())? = close_to_tray;
    *state
        .close_to_tray_asked
        .lock()
        .map_err(|error| error.to_string())? = close_to_tray_asked;
    Ok(())
}

fn emit_software_settings_changed(app: &AppHandle, settings: SoftwareSettings) {
    let _ = app.emit(
        "ds5-software-settings-changed",
        SoftwareSettingsDto::from(settings),
    );
}

impl From<SoftwareSettings> for SoftwareSettingsDto {
    fn from(settings: SoftwareSettings) -> Self {
        Self {
            autostart_enabled: settings.autostart_enabled,
            start_minimized: settings.start_minimized,
            close_to_tray: settings.close_to_tray,
            close_to_tray_asked: settings.close_to_tray_asked,
            low_battery_notification_enabled: settings.low_battery_notification_enabled,
            controller_connection_popup_enabled: settings.controller_connection_popup_enabled,
            controller_low_battery_popup_enabled: settings.controller_low_battery_popup_enabled,
            controller_notification_popup_duration_ms: normalize_popup_duration_ms(
                settings.controller_notification_popup_duration_ms,
            ),
            controller_notification_sound_enabled: settings.controller_notification_sound_enabled,
            controller_notification_sound_volumes: settings
                .controller_notification_sound_volumes
                .normalized(),
        }
    }
}
