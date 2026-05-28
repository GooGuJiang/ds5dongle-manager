use hidapi::{HidApi, HidDevice};
use serde::Serialize;
use std::ffi::CString;

const SONY_VENDOR_ID: u16 = 0x054c;
const DUALSENSE_PRODUCT_ID: u16 = 0x0ce6;
const DUALSENSE_EDGE_PRODUCT_ID: u16 = 0x0df2;
const SUPPORTED_PRODUCT_IDS: [u16; 2] = [DUALSENSE_PRODUCT_ID, DUALSENSE_EDGE_PRODUCT_ID];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDeviceInfoDto {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub serial_number: Option<String>,
    pub manufacturer_string: Option<String>,
    pub product_name: Option<String>,
    pub release_number: u16,
    pub interface_number: i32,
    pub usage_page: u16,
    pub usage: u16,
}

pub fn collect_supported_devices(api: &HidApi) -> Vec<HidDeviceInfoDto> {
    let mut devices = Vec::new();

    for device in api.device_list() {
        if device.vendor_id() != SONY_VENDOR_ID
            || !SUPPORTED_PRODUCT_IDS.contains(&device.product_id())
        {
            continue;
        }

        devices.push(HidDeviceInfoDto {
            path: device.path().to_string_lossy().to_string(),
            vendor_id: device.vendor_id(),
            product_id: device.product_id(),
            serial_number: device.serial_number().map(ToOwned::to_owned),
            manufacturer_string: device.manufacturer_string().map(ToOwned::to_owned),
            product_name: device.product_string().map(ToOwned::to_owned),
            release_number: device.release_number(),
            interface_number: device.interface_number(),
            usage_page: device.usage_page(),
            usage: device.usage(),
        });
    }

    devices
}

pub fn devices_snapshot(devices: &[HidDeviceInfoDto]) -> String {
    let mut entries = devices
        .iter()
        .map(|device| {
            format!(
                "{}:{}:{}:{}",
                device.path,
                device.vendor_id,
                device.product_id,
                device.serial_number.as_deref().unwrap_or_default()
            )
        })
        .collect::<Vec<_>>();
    entries.sort_unstable();
    entries.join("|")
}

pub fn open_device_by_path(api: &HidApi, path: &str) -> Result<HidDevice, String> {
    let path = CString::new(path).map_err(error_to_string)?;
    api.open_path(&path).map_err(error_to_string)
}

pub fn error_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
