use crc::{Crc, CRC_16_IBM_3740};

// Thai PromptPay QR uses CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no
// reflect, no xorout). The `crc` crate exposes this algorithm as
// `CRC_16_IBM_3740`. Matches the EMVCo TR-1 spec and the reference
// implementations dtinth/promptpay-qr (via `crc.crc16ccitt`) and
// ptwptwz/promptpay. Scanned and verified against a real Thai bank app.
const CRC16: Crc<u16> = Crc::<u16>::new(&CRC_16_IBM_3740);

/// Account type for PromptPay QR generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountType {
    Phone,
    IdCard,
}

/// Generate a PromptPay EMVCo QR payload string.
///
/// - `account_type`: Phone or ID card
/// - `account_id`: Phone number (format: 0898350889) or 13-digit national ID
/// - `amount`: Transaction amount in THB (0 = no amount field)
/// - `multiple_use`: true for reusable QR, false for one-time
pub fn generate_promptpay_qr(
    account_type: AccountType,
    account_id: &str,
    amount: f64,
    multiple_use: bool,
) -> String {
    let mut payload = String::from("000201");

    // Point of initiation
    if multiple_use {
        payload.push_str("010212");
    } else {
        payload.push_str("010211");
    }

    // Merchant Account Information (field 29)
    // AID: A000000677010111
    match account_type {
        AccountType::Phone => {
            // Strip leading 0, prefix with 0066 (Thailand country code)
            let phone_suffix = &account_id[1..];
            let phone_with_country = format!("0066{}", phone_suffix);
            // Sub-field 00 (AID): 16 chars, sub-field 01 (phone): 13 chars
            // "0016" + AID(16) + "0113" + phone(13) = 4+16+4+13 = 37
            payload.push_str("2937");
            payload.push_str("0016A000000677010111");
            payload.push_str(&format!("0113{}", phone_with_country));
        }
        AccountType::IdCard => {
            // Sub-field 00 (AID): 16 chars, sub-field 02 (ID card): 13 chars
            // "0016" + AID(16) + "0213" + id(13) = 4+16+4+13 = 37
            payload.push_str("2937");
            payload.push_str("0016A000000677010111");
            payload.push_str(&format!("0213{}", account_id));
        }
    }

    // Country code
    payload.push_str("5802TH");

    // Currency code (THB = 764)
    payload.push_str("5303764");

    // Amount (optional, only if > 0)
    if amount > 0.0 {
        let amount_str = format!("{:.2}", amount);
        let len = amount_str.len();
        payload.push_str(&format!("54{:02}{}", len, amount_str));
    }

    // CRC placeholder — field 63, length 04
    payload.push_str("6304");

    // Calculate CRC-16 XMODEM over the entire payload so far
    let mut digest = CRC16.digest();
    digest.update(payload.as_bytes());
    let crc_value = digest.finalize();
    payload.push_str(&format!("{:04X}", crc_value));

    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_phone_no_amount() {
        let result = generate_promptpay_qr(AccountType::Phone, "0898350889", 0.0, false);
        // Should start with header + one-time
        assert!(result.starts_with("000201010211"));
        // Should contain country and currency
        assert!(result.contains("5802TH"));
        assert!(result.contains("5303764"));
        // Should NOT contain amount field (54xx)
        assert!(!result.contains("5402") && !result.contains("5403") && !result.contains("5404") && !result.contains("5405") && !result.contains("5406") && !result.contains("5407"));
        // Should end with 4-char hex CRC
        assert_eq!(result.len() % 2, 0);
        // Verify CRC: recalculate on everything before last 4 chars
        let (payload_part, crc_part) = result.split_at(result.len() - 4);
        let mut digest = CRC16.digest();
        digest.update(payload_part.as_bytes());
        let expected_crc = format!("{:04X}", digest.finalize());
        assert_eq!(crc_part, expected_crc);
    }

    #[test]
    fn test_phone_with_amount() {
        let result = generate_promptpay_qr(AccountType::Phone, "0898350889", 150.50, false);
        assert!(result.contains("5406150.50"));
    }

    #[test]
    fn test_id_card() {
        let result = generate_promptpay_qr(AccountType::IdCard, "1234567890123", 0.0, true);
        // Multiple use
        assert!(result.starts_with("000201010212"));
        // Should contain ID card sub-field
        assert!(result.contains("02131234567890123"));
    }

    /// Regression test for the CRC bug: PromptPay rejected payloads built with
    /// CRC-16/XMODEM (init 0x0000). With the correct CRC-16/CCITT-FALSE
    /// (init 0xFFFF) we produce a payload accepted by Thai bank apps —
    /// verified by scanning the rendered QR with a real bank app.
    #[test]
    fn test_known_good_id_card_payload() {
        let result =
            generate_promptpay_qr(AccountType::IdCard, "1100700546038", 415.00, false);
        assert_eq!(
            result,
            "00020101021129370016A000000677010111021311007005460385802TH53037645406415.006304FFC4"
        );
    }
}
