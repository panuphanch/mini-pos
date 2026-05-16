use chrono::Utc;

pub fn new_id() -> String {
    cuid2::create_id()
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
