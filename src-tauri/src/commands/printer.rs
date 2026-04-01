use crate::printer::network;
use crate::printer::receipt::{PrinterConfig, ReceiptData};

/// Print a full receipt to the thermal printer.
#[tauri::command]
pub fn print_receipt(receipt: ReceiptData, config: PrinterConfig) -> Result<String, String> {
    let commands = crate::printer::receipt::build_receipt(&receipt, &config)
        .map_err(|e| format!("Failed to build receipt: {}", e))?;

    network::send_to_printer(&config.ip, &commands)
        .map_err(|e| format!("Failed to print: {}", e))?;

    Ok("Receipt printed successfully".to_string())
}

/// Send a test page to the printer to verify connectivity and printing.
#[tauri::command]
pub fn test_printer(ip: String) -> Result<String, String> {
    let mut commands: Vec<u8> = Vec::new();

    // ESC @ — initialize printer
    commands.extend_from_slice(&[0x1B, 0x40]);

    // Center align
    commands.extend_from_slice(&[0x1B, 0x61, 0x01]);

    // Print test text (ASCII only for test)
    commands.extend_from_slice(b"=== PRINTER TEST ===\n");
    commands.extend_from_slice(b"Connection OK!\n");
    commands.extend_from_slice(b"Granny's POS System\n");
    commands.extend_from_slice(b"====================\n");

    // Feed and cut
    commands.extend_from_slice(&[0x1B, 0x64, 0x04]); // Feed 4 lines
    commands.extend_from_slice(&[0x1D, 0x56, 0x00]); // Full cut

    network::send_to_printer(&ip, &commands)
        .map_err(|e| format!("Printer test failed: {}", e))?;

    Ok("Test page printed successfully".to_string())
}

/// Check if the printer is reachable via TCP on port 9100.
#[tauri::command]
pub fn check_printer_status(ip: String) -> Result<bool, String> {
    match network::check_connection(&ip, std::time::Duration::from_secs(2)) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}
