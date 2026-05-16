use crate::sheets::client::ValueRange;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MenuRow {
    pub menu_name: String,
    pub price: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedOrderItem {
    pub menu_name: String,
    pub quantity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedOrder {
    pub source_row: i64,
    pub channel: Option<String>,
    pub customer: String,
    pub delivery_location: Option<String>,
    pub notes: Option<String>,
    pub items: Vec<ParsedOrderItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTab {
    pub menu: Vec<MenuRow>,
    pub orders: Vec<ParsedOrder>,
    pub parse_errors: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Header row 'ช่องทาง' not found in tab")]
    HeaderNotFound,
    #[error("Menu table appears empty")]
    EmptyMenu,
}

const CHANNEL_HEADER: &str = "ช่องทาง";
const DELIVERY_HEADER: &str = "สถานที่ส่ง";
const NOTE_HEADER: &str = "Note";

fn cell<'a>(row: &'a [String], idx: usize) -> &'a str {
    row.get(idx).map(String::as_str).unwrap_or("").trim()
}

pub fn parse_tab(vr: &ValueRange) -> Result<ParsedTab, ParseError> {
    let rows = &vr.values;

    // --- Menu table: rows starting at index 0, stop when col A blank ---
    let mut menu: Vec<MenuRow> = Vec::new();
    let mut i = 0;
    while i < rows.len() {
        let a = cell(&rows[i], 0);
        if a.is_empty() { break; }
        if a == "Menu" { i += 1; continue; }
        let price_str = cell(&rows[i], 4);
        let price: i64 = price_str.parse().unwrap_or(0);
        if price > 0 {
            menu.push(MenuRow { menu_name: a.to_string(), price });
        }
        i += 1;
    }
    if menu.is_empty() { return Err(ParseError::EmptyMenu); }

    // --- Find header row of order table ---
    let header_idx = rows.iter().position(|r| cell(r, 0) == CHANNEL_HEADER)
        .ok_or(ParseError::HeaderNotFound)?;
    let header = &rows[header_idx];

    // Columns C..N are menu names. Identify delivery + note columns by header name.
    let mut menu_cols: Vec<(usize, String)> = Vec::new();
    let mut delivery_col: Option<usize> = None;
    let mut note_col: Option<usize> = None;
    for (idx, h) in header.iter().enumerate() {
        let h_trim = h.trim();
        if idx < 2 { continue; }
        if h_trim == DELIVERY_HEADER { delivery_col = Some(idx); continue; }
        if h_trim == NOTE_HEADER { note_col = Some(idx); continue; }
        if !h_trim.is_empty() {
            menu_cols.push((idx, h_trim.to_string()));
        }
    }

    // --- Parse order rows ---
    let mut orders: Vec<ParsedOrder> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for r in (header_idx + 1)..rows.len() {
        let row = &rows[r];
        let channel = cell(row, 0);
        let customer = cell(row, 1);
        let all_qty_empty = menu_cols.iter().all(|(c, _)| cell(row, *c).is_empty());
        // Channel column has data-validation defaults that stick around on otherwise-empty
        // rows, so an empty customer + empty qtys is treated as blank regardless of channel.
        if customer.is_empty() && all_qty_empty {
            continue;
        }
        if customer.is_empty() {
            errors.push(format!("Row {}: missing customer", r + 1));
            continue;
        }

        let mut items = Vec::new();
        for (col_idx, name) in &menu_cols {
            let s = cell(row, *col_idx);
            if s.is_empty() { continue; }
            match s.parse::<i64>() {
                Ok(q) if q > 0 => items.push(ParsedOrderItem { menu_name: name.clone(), quantity: q }),
                Ok(_) => {}
                Err(_) => errors.push(format!("Row {} col '{}': non-numeric qty '{}'", r + 1, name, s)),
            }
        }
        let delivery = delivery_col.and_then(|c| {
            let v = cell(row, c);
            if v.is_empty() { None } else { Some(v.to_string()) }
        });
        let notes = note_col.and_then(|c| {
            let v = cell(row, c);
            if v.is_empty() { None } else { Some(v.to_string()) }
        });
        let chan = if channel.is_empty() { None } else { Some(channel.to_string()) };
        orders.push(ParsedOrder {
            source_row: (r + 1) as i64,
            channel: chan,
            customer: customer.to_string(),
            delivery_location: delivery,
            notes,
            items,
        });
    }

    Ok(ParsedTab { menu, orders, parse_errors: errors })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vr(rows: Vec<Vec<&str>>) -> ValueRange {
        ValueRange {
            values: rows.into_iter()
                .map(|r| r.into_iter().map(String::from).collect()).collect(),
        }
    }

    #[test]
    fn parses_screenshot_shape() {
        let vr = vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["เค้กโคตรเผือกมะพร้าว", "", "10", "0", "129"],
            vec!["เค้กช็อคฟัดจ์", "", "16", "3", "85"],
            vec!["ทาร์ตลูกตาล", "", "10", "3", "110"],
            vec!["มัทฉะเลเยอร์", "", "10", "2", "165"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "เค้กโคตรเผือกมะพร้าว", "เค้กช็อคฟัดจ์",
                 "ทาร์ตลูกตาล", "มัทฉะเลเยอร์", "สถานที่ส่ง", "Note"],
            vec!["Page", "K.Parin", "1", "1", "1", "1", "บ้านรัตนรักษ์ SAT", "Packed"],
            vec!["Linea", "P'Mink", "", "", "", "2", "Pilates Timetable", "Packed"],
            vec![""],
        ]);
        let p = parse_tab(&vr).unwrap();
        assert_eq!(p.menu.len(), 4);
        assert_eq!(p.menu[1], MenuRow { menu_name: "เค้กช็อคฟัดจ์".into(), price: 85 });
        assert_eq!(p.orders.len(), 2);
        assert_eq!(p.orders[0].customer, "K.Parin");
        assert_eq!(p.orders[0].items.len(), 4);
        assert_eq!(p.orders[1].items, vec![
            ParsedOrderItem { menu_name: "มัทฉะเลเยอร์".into(), quantity: 2 }
        ]);
        assert_eq!(p.orders[1].delivery_location.as_deref(), Some("Pilates Timetable"));
    }

    #[test]
    fn missing_header_errors() {
        let vr = vr(vec![
            vec!["Menu"],
            vec!["X", "", "1", "1", "10"],
        ]);
        let err = parse_tab(&vr).unwrap_err();
        assert!(matches!(err, ParseError::HeaderNotFound));
    }

    #[test]
    fn empty_menu_errors() {
        let vr = vr(vec![
            vec!["Menu"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "สถานที่ส่ง", "Note"],
        ]);
        let err = parse_tab(&vr).unwrap_err();
        assert!(matches!(err, ParseError::EmptyMenu));
    }

    #[test]
    fn non_numeric_qty_recorded_as_parse_error() {
        let vr = vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["A", "", "1", "1", "100"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "A", "สถานที่ส่ง", "Note"],
            vec!["Page", "X", "ดู", "Y", ""],
        ]);
        let p = parse_tab(&vr).unwrap();
        assert_eq!(p.orders.len(), 1);
        assert!(p.orders[0].items.is_empty());
        assert_eq!(p.parse_errors.len(), 1);
    }

    #[test]
    fn trailing_blank_rows_are_skipped() {
        let vr = vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["A", "", "1", "1", "100"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "A", "สถานที่ส่ง", "Note"],
            vec!["Page", "X", "1", "Y", ""],
            vec![""],
            vec!["", "", "", "", ""],
        ]);
        let p = parse_tab(&vr).unwrap();
        assert_eq!(p.orders.len(), 1);
    }

    #[test]
    fn channel_only_rows_from_dropdown_are_not_warnings() {
        let vr = vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["A", "", "1", "1", "100"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "A", "สถานที่ส่ง", "Note"],
            vec!["Page", "Real", "1", "Home", ""],
            vec!["Page", "", "", "", ""],   // dropdown leftover, no real order
            vec!["Linea", "", "", "", ""],  // same
            vec!["DM", "", "", "", ""],     // same
        ]);
        let p = parse_tab(&vr).unwrap();
        assert_eq!(p.orders.len(), 1);
        assert!(p.parse_errors.is_empty(),
            "channel-only rows should be silently skipped, not warned about: {:?}",
            p.parse_errors);
    }
}
