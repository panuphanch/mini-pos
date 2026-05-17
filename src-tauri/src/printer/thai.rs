use ab_glyph::{Font, FontRef, PxScale, ScaleFont};

/// Noto Sans Thai font, embedded into the binary at compile time.
/// Sourced from google/fonts (OFL). The variable font's default axes render as Regular weight.
const FONT_BYTES: &[u8] = include_bytes!("../../fonts/NotoSansThai-Regular.ttf");

/// Text alignment for rendered lines.
#[derive(Debug, Clone, Copy)]
pub enum Alignment {
    Left,
    Center,
    /// Reserved — match arms exist in `thai.rs` and `receipt.rs` so any future
    /// caller wanting right-aligned output works without touching this module.
    #[allow(dead_code)]
    Right,
    /// Left text on the left, right text on the right (split layout for receipts)
    LeftRight,
}

/// Parsed font handle, cached for the process lifetime.
fn load_font() -> Option<FontRef<'static>> {
    use std::sync::OnceLock;
    static FONT: OnceLock<Option<FontRef<'static>>> = OnceLock::new();
    FONT.get_or_init(|| match FontRef::try_from_slice(FONT_BYTES) {
        Ok(f) => Some(f),
        Err(e) => {
            eprintln!("WARNING: Failed to parse embedded Thai font: {}", e);
            None
        }
    })
    .clone()
}

/// Render a single line of text to a monochrome bitmap suitable for ESC/POS raster printing.
///
/// Returns the raw bitmap bytes in ESC/POS GS v 0 raster format, or an empty Vec if font
/// is unavailable.
///
/// - `text`: The text to render (can include Thai characters)
/// - `font_size`: Font size in pixels
/// - `width_px`: Width of the output bitmap in pixels (must be multiple of 8)
/// - `align`: Text alignment
pub fn render_text_line(text: &str, font_size: f32, width_px: u32, align: Alignment) -> Vec<u8> {
    render_text_line_split(text, "", font_size, width_px, align)
}

/// Render text with optional split (left/right) layout.
/// `right_text` is only used when align is LeftRight.
pub fn render_text_line_split(
    left_text: &str,
    right_text: &str,
    font_size: f32,
    width_px: u32,
    align: Alignment,
) -> Vec<u8> {
    let font = match load_font() {
        Some(f) => f,
        None => return Vec::new(),
    };

    let scale = PxScale::from(font_size);
    let scaled_font = font.as_scaled(scale);

    let height_px = (scaled_font.ascent() - scaled_font.descent()).ceil() as u32 + 4;

    // Ensure width is multiple of 8
    let width_px = (width_px + 7) & !7;

    // Create bitmap (1 bit per pixel, packed into bytes row by row)
    let bytes_per_row = (width_px / 8) as usize;
    let mut bitmap = vec![0u8; bytes_per_row * height_px as usize];

    let baseline_y = scaled_font.ascent() + 2.0;

    match align {
        Alignment::Left => {
            draw_text_on_bitmap(
                &font,
                scale,
                left_text,
                0.0,
                baseline_y,
                &mut bitmap,
                width_px,
                height_px,
            );
        }
        Alignment::Center => {
            let text_width = measure_text_width(&scaled_font, left_text);
            let x = ((width_px as f32 - text_width) / 2.0).max(0.0);
            draw_text_on_bitmap(
                &font,
                scale,
                left_text,
                x,
                baseline_y,
                &mut bitmap,
                width_px,
                height_px,
            );
        }
        Alignment::Right => {
            let text_width = measure_text_width(&scaled_font, left_text);
            let x = (width_px as f32 - text_width).max(0.0);
            draw_text_on_bitmap(
                &font,
                scale,
                left_text,
                x,
                baseline_y,
                &mut bitmap,
                width_px,
                height_px,
            );
        }
        Alignment::LeftRight => {
            // Left-aligned text
            draw_text_on_bitmap(
                &font,
                scale,
                left_text,
                0.0,
                baseline_y,
                &mut bitmap,
                width_px,
                height_px,
            );
            // Right-aligned text
            let right_width = measure_text_width(&scaled_font, right_text);
            let rx = (width_px as f32 - right_width).max(0.0);
            draw_text_on_bitmap(
                &font,
                scale,
                right_text,
                rx,
                baseline_y,
                &mut bitmap,
                width_px,
                height_px,
            );
        }
    }

    // Convert bitmap to ESC/POS GS v 0 raster command
    build_raster_command(&bitmap, width_px, height_px)
}

fn measure_text_width<SF: ab_glyph::ScaleFont<F>, F: ab_glyph::Font>(
    scaled_font: &SF,
    text: &str,
) -> f32 {
    let mut width = 0.0f32;
    let mut prev_glyph: Option<ab_glyph::GlyphId> = None;
    for ch in text.chars() {
        let glyph_id = scaled_font.glyph_id(ch);
        if let Some(prev) = prev_glyph {
            width += scaled_font.kern(prev, glyph_id);
        }
        width += scaled_font.h_advance(glyph_id);
        prev_glyph = Some(glyph_id);
    }
    width
}

#[allow(clippy::too_many_arguments)]
fn draw_text_on_bitmap(
    font: &FontRef,
    scale: PxScale,
    text: &str,
    start_x: f32,
    baseline_y: f32,
    bitmap: &mut [u8],
    width_px: u32,
    height_px: u32,
) {
    use ab_glyph::Font as _;

    let scaled = font.as_scaled(scale);
    let mut x = start_x;
    let mut prev_glyph: Option<ab_glyph::GlyphId> = None;
    let bytes_per_row = (width_px / 8) as usize;

    for ch in text.chars() {
        let glyph_id = scaled.glyph_id(ch);
        if let Some(prev) = prev_glyph {
            x += scaled.kern(prev, glyph_id);
        }

        let glyph = glyph_id.with_scale_and_position(scale, ab_glyph::point(x, baseline_y));

        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|px, py, coverage| {
                if coverage > 0.5 {
                    let gx = bounds.min.x as i32 + px as i32;
                    let gy = bounds.min.y as i32 + py as i32;
                    if gx >= 0
                        && (gx as u32) < width_px
                        && gy >= 0
                        && (gy as u32) < height_px
                    {
                        let byte_idx = gy as usize * bytes_per_row + (gx as usize / 8);
                        let bit_idx = 7 - (gx as usize % 8);
                        if byte_idx < bitmap.len() {
                            bitmap[byte_idx] |= 1 << bit_idx;
                        }
                    }
                }
            });
        }

        x += scaled.h_advance(glyph_id);
        prev_glyph = Some(glyph_id);
    }
}

/// Build ESC/POS GS v 0 raster command from a monochrome bitmap.
///
/// Format: GS v 0 m xL xH yL yH [bitmap data]
/// m=0 (normal), xL/xH = bytes per row, yL/yH = number of rows
fn build_raster_command(bitmap: &[u8], width_px: u32, height_px: u32) -> Vec<u8> {
    let bytes_per_row = width_px / 8;
    let mut cmd = Vec::new();

    // GS v 0 — print raster bit image
    cmd.push(0x1D); // GS
    cmd.push(0x76); // v
    cmd.push(0x30); // 0
    cmd.push(0x00); // m = 0 (normal)

    // xL, xH — bytes per row (little-endian)
    cmd.push((bytes_per_row & 0xFF) as u8);
    cmd.push(((bytes_per_row >> 8) & 0xFF) as u8);

    // yL, yH — number of rows (little-endian)
    cmd.push((height_px & 0xFF) as u8);
    cmd.push(((height_px >> 8) & 0xFF) as u8);

    cmd.extend_from_slice(bitmap);

    cmd
}
