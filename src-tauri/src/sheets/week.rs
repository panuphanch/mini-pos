use chrono::{NaiveDate, Weekday};

/// Parse "Order_30" → Monday of ISO week 30 in `for_year`.
pub fn parse_tab_week_start(tab: &str, for_year: i32) -> Option<NaiveDate> {
    let rest = tab.strip_prefix("Order_")?;
    let week: u32 = rest.parse().ok()?;
    if !(1..=53).contains(&week) { return None; }
    NaiveDate::from_isoywd_opt(for_year, week, Weekday::Mon)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    #[test]
    fn parses_known_week() {
        let d = parse_tab_week_start("Order_30", 2026).unwrap();
        assert_eq!(d.iso_week().week(), 30);
        assert_eq!(d.weekday(), Weekday::Mon);
    }
    #[test]
    fn rejects_garbage() {
        assert!(parse_tab_week_start("Foo", 2026).is_none());
        assert!(parse_tab_week_start("Order_99", 2026).is_none());
    }
}
