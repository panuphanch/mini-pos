use crate::printer::promptpay::{self, AccountType};
use crate::printer::thai::{self, Alignment};
use serde::{Deserialize, Serialize};

/// Configuration for connecting to and formatting for the printer.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrinterConfig {
    pub ip: String,
    /// Paper width in mm (58 or 80)
    pub paper_width: u32,
    pub shop_name: String,
    pub shop_phone: String,
    pub shop_line: String,
    pub qr_text: String,
    /// "phone" or "id_card"
    pub qr_code_type: String,
    pub qr_code_value: String,
    pub thank_you_message: String,
}

/// A single item on the receipt.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptItem {
    pub name: String,
    pub quantity: f64,
    pub price: f64,
}

/// Full receipt data passed from the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptData {
    pub customer_name: String,
    pub items: Vec<ReceiptItem>,
    /// "none", "percentage", or "fixed"
    pub discount_type: String,
    pub discount: f64,
    pub delivery_fee: f64,
}

/// Width in pixels for the given paper width in mm.
fn paper_width_px(paper_mm: u32) -> u32 {
    match paper_mm {
        58 => 384,
        _ => 576, // 80mm default
    }
}

/// Build the complete ESC/POS command byte sequence for a receipt.
pub fn build_receipt(receipt: &ReceiptData, config: &PrinterConfig) -> Result<Vec<u8>, String> {
    let width_px = paper_width_px(config.paper_width);
    let font_size = if config.paper_width == 58 { 20.0 } else { 24.0 };
    let separator = "------------------------------------------------";

    let mut cmds: Vec<u8> = Vec::new();

    // === Initialize printer ===
    cmds.extend_from_slice(&[0x1B, 0x40]);

    // === Shop header (center) ===
    append_thai_line(&mut cmds, &config.shop_name, font_size, width_px, Alignment::Center);
    append_thai_line(&mut cmds, &config.shop_phone, font_size, width_px, Alignment::Center);
    append_thai_line(
        &mut cmds,
        &format!("Line {}", config.shop_line),
        font_size,
        width_px,
        Alignment::Center,
    );

    // Separator (ASCII is fine)
    append_ascii_center(&mut cmds, separator);

    // === Customer name ===
    append_thai_line(
        &mut cmds,
        &format!("Customer: {}", receipt.customer_name),
        font_size,
        width_px,
        Alignment::Left,
    );
    append_ascii_center(&mut cmds, separator);

    // === Items ===
    let mut subtotal = 0.0f64;
    for item in &receipt.items {
        let line_total = item.quantity * item.price;
        subtotal += line_total;
        let price_str = format!("฿{:.2}", line_total);

        // Item name left, price right
        let raster = thai::render_text_line_split(
            &item.name,
            &price_str,
            font_size,
            width_px,
            Alignment::LeftRight,
        );
        cmds.extend_from_slice(&raster);

        // Quantity x unit price detail line
        let detail = format!("{} x ฿{:.2}", item.quantity, item.price);
        append_thai_line(&mut cmds, &detail, font_size * 0.8, width_px, Alignment::Left);
    }

    append_ascii_center(&mut cmds, separator);

    // === Discount ===
    let mut total = subtotal;
    if receipt.discount_type != "none" && receipt.discount > 0.0 {
        let (discount_label, discount_amount) = if receipt.discount_type == "percentage" {
            let amt = receipt.discount * subtotal / 100.0;
            (format!("Discount ({:.2}%)", receipt.discount), amt)
        } else {
            (
                format!("Discount (฿{:.2})", receipt.discount),
                receipt.discount,
            )
        };
        total -= discount_amount;
        let discount_val = format!("฿{:.2}", discount_amount);
        let raster = thai::render_text_line_split(
            &discount_label,
            &discount_val,
            font_size,
            width_px,
            Alignment::LeftRight,
        );
        cmds.extend_from_slice(&raster);
    }

    // === Delivery fee ===
    if receipt.delivery_fee > 0.0 {
        total += receipt.delivery_fee;
        let fee_str = format!("฿{:.2}", receipt.delivery_fee);
        let raster = thai::render_text_line_split(
            "Delivery fee",
            &fee_str,
            font_size,
            width_px,
            Alignment::LeftRight,
        );
        cmds.extend_from_slice(&raster);
    }

    // === Amount due (bold/larger) ===
    let total_str = format!("฿{:.2}", total);
    let raster = thai::render_text_line_split(
        "Amount due",
        &total_str,
        font_size * 1.2,
        width_px,
        Alignment::LeftRight,
    );
    cmds.extend_from_slice(&raster);

    append_ascii_center(&mut cmds, separator);

    // === PromptPay QR ===
    let account_type = match config.qr_code_type.as_str() {
        "phone" => AccountType::Phone,
        "id_card" => AccountType::IdCard,
        other => return Err(format!("Invalid QR code type: '{}'", other)),
    };
    let qr_payload =
        promptpay::generate_promptpay_qr(account_type, &config.qr_code_value, total, false);

    // QR label
    append_thai_line(&mut cmds, &config.qr_text, font_size, width_px, Alignment::Center);

    // QR code via ESC/POS QR commands
    append_qr_code(&mut cmds, &qr_payload, 7);

    append_ascii_center(&mut cmds, separator);

    // === Thank you + timestamp ===
    append_thai_line(
        &mut cmds,
        &config.thank_you_message,
        font_size,
        width_px,
        Alignment::Center,
    );

    let now = chrono_timestamp();
    append_thai_line(&mut cmds, &now, font_size * 0.8, width_px, Alignment::Center);

    // === Feed and cut ===
    cmds.extend_from_slice(&[0x1B, 0x64, 0x04]); // Feed 4 lines
    cmds.extend_from_slice(&[0x1D, 0x56, 0x00]); // Full cut (GS V)

    Ok(cmds)
}

/// Append a Thai-rendered line to the command buffer.
/// Falls back to ASCII if font rendering returns empty.
fn append_thai_line(
    cmds: &mut Vec<u8>,
    text: &str,
    font_size: f32,
    width_px: u32,
    align: Alignment,
) {
    let raster = thai::render_text_line(text, font_size, width_px, align);
    if raster.is_empty() {
        // Fallback: send as raw ASCII text
        let align_byte = match align {
            Alignment::Center => 0x01,
            Alignment::Right => 0x02,
            _ => 0x00,
        };
        cmds.extend_from_slice(&[0x1B, 0x61, align_byte]);
        cmds.extend_from_slice(text.as_bytes());
        cmds.push(b'\n');
    } else {
        cmds.extend_from_slice(&raster);
    }
}

/// Append a centered ASCII text line.
fn append_ascii_center(cmds: &mut Vec<u8>, text: &str) {
    cmds.extend_from_slice(&[0x1B, 0x61, 0x01]); // Center
    cmds.extend_from_slice(text.as_bytes());
    cmds.push(b'\n');
    cmds.extend_from_slice(&[0x1B, 0x61, 0x00]); // Reset to left
}

/// Append ESC/POS QR code commands.
///
/// Uses the GS ( k function for QR code:
/// 1. Model select: GS ( k pL pH cn fn n1 n2
/// 2. Size: GS ( k pL pH cn fn n
/// 3. Error correction: GS ( k pL pH cn fn n
/// 4. Store data: GS ( k pL pH cn fn m d1...dk
/// 5. Print: GS ( k pL pH cn fn m
fn append_qr_code(cmds: &mut Vec<u8>, data: &str, size: u8) {
    // Center align for QR
    cmds.extend_from_slice(&[0x1B, 0x61, 0x01]);

    // 1. Select QR model 2
    cmds.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);

    // 2. Set QR size (1-16)
    cmds.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size]);

    // 3. Set error correction level L
    cmds.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30]);

    // 4. Store QR data
    let data_bytes = data.as_bytes();
    let store_len = data_bytes.len() + 3; // +3 for cn, fn, m
    let pl = (store_len & 0xFF) as u8;
    let ph = ((store_len >> 8) & 0xFF) as u8;
    cmds.extend_from_slice(&[0x1D, 0x28, 0x6B, pl, ph, 0x31, 0x50, 0x30]);
    cmds.extend_from_slice(data_bytes);

    // 5. Print QR
    cmds.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);

    // Reset to left
    cmds.extend_from_slice(&[0x1B, 0x61, 0x00]);
}

/// Get current timestamp as formatted string (DD/MM/YYYY, HH:MM).
fn chrono_timestamp() -> String {
    // Use std time since we don't want to add chrono as a dependency
    // Format: epoch-based simple approach
    let now = std::time::SystemTime::now();
    let duration = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Simple UTC date/time calculation (sufficient for receipt timestamps)
    // For proper timezone support, the frontend can pass the timestamp instead
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = (time_of_day / 3600) + 7; // +7 for Bangkok time (ICT)
    let minutes = (time_of_day % 3600) / 60;

    // Days since epoch to date (simplified Gregorian)
    let (year, month, day) = days_to_ymd(days + if hours >= 24 { 1 } else { 0 });
    let hours = hours % 24;

    format!(
        "{:02}/{:02}/{:04}, {:02}:{:02}",
        day, month, year, hours, minutes
    )
}

/// Convert days since Unix epoch to (year, month, day).
fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
    days += 719468;
    let era = days / 146097;
    let doe = days - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}
