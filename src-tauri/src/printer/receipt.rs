use crate::printer::promptpay::{self, AccountType};
use crate::printer::thai::{self, Alignment};
use serde::{Deserialize, Serialize};

/// Shop logo, embedded at compile time.
const LOGO_PNG: &[u8] = include_bytes!("../../assets/logo.png");

/// ESC E 1 — enable bold.
const ESC_BOLD_ON: [u8; 3] = [0x1B, 0x45, 0x01];
/// ESC E 0 — disable bold.
const ESC_BOLD_OFF: [u8; 3] = [0x1B, 0x45, 0x00];

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
    let font_size = if config.paper_width == 58 { 30.0 } else { 36.0 };
    let separator = "------------------------------------------------";

    let mut cmds: Vec<u8> = Vec::new();

    // === Initialize printer ===
    cmds.extend_from_slice(&[0x1B, 0x40]);

    // === Logo (center) ===
    append_logo(&mut cmds, width_px);

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

        append_split_line(&mut cmds, &item.name, &price_str, font_size, width_px);

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
        append_split_line(&mut cmds, &discount_label, &discount_val, font_size, width_px);
    }

    // === Delivery fee ===
    if receipt.delivery_fee > 0.0 {
        total += receipt.delivery_fee;
        let fee_str = format!("฿{:.2}", receipt.delivery_fee);
        append_split_line(&mut cmds, "Delivery fee", &fee_str, font_size, width_px);
    }

    // === Amount due (bold/larger) ===
    let total_str = format!("฿{:.2}", total);
    cmds.extend_from_slice(&ESC_BOLD_ON);
    append_split_line(&mut cmds, "Amount due", &total_str, font_size * 1.2, width_px);
    cmds.extend_from_slice(&ESC_BOLD_OFF);

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

    // === Thank you ===
    append_thai_line(
        &mut cmds,
        &config.thank_you_message,
        font_size,
        width_px,
        Alignment::Center,
    );

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
        let align_byte = match align {
            Alignment::Center => 0x01,
            Alignment::Right => 0x02,
            _ => 0x00,
        };
        cmds.extend_from_slice(&[0x1B, 0x61, align_byte]);
        cmds.extend_from_slice(ascii_fallback(text).as_bytes());
        cmds.push(b'\n');
    } else {
        cmds.extend_from_slice(&raster);
    }
}

/// Append a left/right split line. If the Thai font is available the line is
/// rendered as a raster image; otherwise an ASCII fallback line is emitted so
/// items, discounts, fees, and totals never silently disappear from the receipt.
fn append_split_line(
    cmds: &mut Vec<u8>,
    left: &str,
    right: &str,
    font_size: f32,
    width_px: u32,
) {
    let raster = thai::render_text_line_split(left, right, font_size, width_px, Alignment::LeftRight);
    if !raster.is_empty() {
        cmds.extend_from_slice(&raster);
        return;
    }

    // ASCII fallback — pad with spaces to RECEIPT_COLS (matches legacy Python layout).
    const RECEIPT_COLS: usize = 48;
    let l = ascii_fallback(left);
    let r = ascii_fallback(right);
    let l_w = l.chars().count();
    let r_w = r.chars().count();
    let pad = RECEIPT_COLS.saturating_sub(l_w + r_w).max(1);

    cmds.extend_from_slice(&[0x1B, 0x61, 0x00]); // left align
    cmds.extend_from_slice(l.as_bytes());
    for _ in 0..pad {
        cmds.push(b' ');
    }
    cmds.extend_from_slice(r.as_bytes());
    cmds.push(b'\n');
}

/// Replace non-ASCII glyphs we can transliterate (e.g. ฿ → "THB") and drop
/// the rest, so a missing font doesn't emit raw UTF-8 bytes the printer
/// would render as garbage.
fn ascii_fallback(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '฿' => out.push_str("THB"),
            c if c.is_ascii() => out.push(c),
            _ => out.push('?'),
        }
    }
    out
}

/// Decode the embedded logo PNG and emit it as an ESC/POS raster image,
/// centered to the paper width. Logs and skips if decoding fails — receipt
/// should still print.
fn append_logo(cmds: &mut Vec<u8>, width_px: u32) {
    let rgba = match image::load_from_memory(LOGO_PNG) {
        Ok(i) => i.to_rgba8(),
        Err(e) => {
            eprintln!("WARNING: Failed to decode embedded logo PNG: {}", e);
            return;
        }
    };

    // Composite RGBA over white so transparent regions don't print as black ink.
    // Then convert to a single luma channel for thresholding.
    let mut luma = image::GrayImage::new(rgba.width(), rgba.height());
    for (x, y, p) in rgba.enumerate_pixels() {
        let [r, g, b, a] = p.0;
        let af = a as f32 / 255.0;
        let mix = |c: u8| -> u8 {
            (c as f32 * af + 255.0 * (1.0 - af)).round().clamp(0.0, 255.0) as u8
        };
        // Rec. 601 luma after compositing over white.
        let lum = (0.299 * mix(r) as f32 + 0.587 * mix(g) as f32 + 0.114 * mix(b) as f32)
            .round() as u8;
        luma.put_pixel(x, y, image::Luma([lum]));
    }

    // Scale logo to ~60% of paper width — balances legibility of the line-art
    // logo with not dominating the top of the receipt.
    let target_w = ((width_px * 60) / 100).max(8) & !7; // multiple of 8
    let scale = target_w as f32 / luma.width() as f32;
    let target_h = ((luma.height() as f32) * scale).round().max(1.0) as u32;
    let resized = image::imageops::resize(&luma, target_w, target_h, image::imageops::FilterType::Lanczos3);

    // Floyd-Steinberg dither the grayscale image to 1-bpp before packing.
    // Hard thresholding loses thin strokes (the original line-art logo); diffusion
    // preserves them by spreading quantization error to neighboring pixels.
    let w = target_w as usize;
    let h = target_h as usize;
    let mut buf: Vec<f32> = resized.pixels().map(|p| p.0[0] as f32).collect();
    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            let old = buf[idx];
            let new = if old < 128.0 { 0.0 } else { 255.0 };
            buf[idx] = new;
            let err = old - new;
            if x + 1 < w {
                buf[idx + 1] += err * 7.0 / 16.0;
            }
            if y + 1 < h {
                if x > 0 {
                    buf[idx + w - 1] += err * 3.0 / 16.0;
                }
                buf[idx + w] += err * 5.0 / 16.0;
                if x + 1 < w {
                    buf[idx + w + 1] += err * 1.0 / 16.0;
                }
            }
        }
    }

    // Pack into a centered 1-bpp bitmap of `width_px` wide rows.
    let bytes_per_row = (width_px / 8) as usize;
    let mut bitmap = vec![0u8; bytes_per_row * h];
    let x_offset = ((width_px - target_w) / 2) as usize;

    for y in 0..h {
        for x in 0..w {
            if buf[y * w + x] < 128.0 {
                let gx = x + x_offset;
                let byte_idx = y * bytes_per_row + (gx / 8);
                let bit_idx = 7 - (gx % 8);
                if byte_idx < bitmap.len() {
                    bitmap[byte_idx] |= 1 << bit_idx;
                }
            }
        }
    }
    let target_h = h as u32;

    // GS v 0 raster command
    cmds.extend_from_slice(&[0x1B, 0x61, 0x01]); // center align (no-op for full-width raster, but harmless)
    cmds.push(0x1D);
    cmds.push(0x76);
    cmds.push(0x30);
    cmds.push(0x00);
    cmds.push((bytes_per_row & 0xFF) as u8);
    cmds.push(((bytes_per_row >> 8) & 0xFF) as u8);
    cmds.push((target_h & 0xFF) as u8);
    cmds.push(((target_h >> 8) & 0xFF) as u8);
    cmds.extend_from_slice(&bitmap);
    cmds.extend_from_slice(&[0x1B, 0x61, 0x00]); // reset to left
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

