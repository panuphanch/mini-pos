use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const PRINTER_PORT: u16 = 9100;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

/// Send raw ESC/POS bytes to the printer over TCP.
pub fn send_to_printer(ip: &str, data: &[u8]) -> Result<(), String> {
    let addr = format!("{}:{}", ip, PRINTER_PORT);
    let socket_addr = addr
        .to_socket_addrs()
        .map_err(|e| format!("Invalid address '{}': {}", addr, e))?
        .next()
        .ok_or_else(|| format!("Could not resolve address '{}'", addr))?;

    let mut stream = TcpStream::connect_timeout(&socket_addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("Connection to {} failed: {}", addr, e))?;

    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| format!("Failed to set write timeout: {}", e))?;

    stream
        .write_all(data)
        .map_err(|e| format!("Failed to send data to printer: {}", e))?;

    stream
        .flush()
        .map_err(|e| format!("Failed to flush printer data: {}", e))?;

    Ok(())
}

/// Check if the printer is reachable by attempting a TCP connection.
pub fn check_connection(ip: &str, timeout: Duration) -> Result<(), String> {
    let addr = format!("{}:{}", ip, PRINTER_PORT);
    let socket_addr = addr
        .to_socket_addrs()
        .map_err(|e| format!("Invalid address '{}': {}", addr, e))?
        .next()
        .ok_or_else(|| format!("Could not resolve address '{}'", addr))?;

    TcpStream::connect_timeout(&socket_addr, timeout)
        .map_err(|e| format!("Printer at {} unreachable: {}", addr, e))?;

    Ok(())
}
