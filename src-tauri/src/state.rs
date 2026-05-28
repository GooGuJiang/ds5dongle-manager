use serde::Deserialize;
use std::collections::HashSet;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{menu::MenuItem, Wry};

pub struct DeviceMonitorState {
    pub running: Arc<AtomicBool>,
}

pub struct TrayState {
    pub battery_values: Mutex<Vec<String>>,
    pub labels: Mutex<TrayLabels>,
    pub close_to_tray: Mutex<bool>,
    pub close_to_tray_asked: Mutex<bool>,
    pub low_battery_notified_keys: Mutex<HashSet<String>>,
    pub open_window_item: Mutex<Option<MenuItem<Wry>>>,
    pub battery_item: Mutex<Option<MenuItem<Wry>>>,
    pub quit_item: Mutex<Option<MenuItem<Wry>>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayBatteryStatus {
    pub device_key: String,
    pub label: String,
    pub battery_text: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub open_window: String,
    pub quit: String,
    pub battery_prefix: String,
}

impl TrayLabels {
    pub fn fallback() -> Self {
        Self {
            open_window: "Open Window".to_string(),
            quit: "Quit".to_string(),
            battery_prefix: "Controller Battery".to_string(),
        }
    }
}
