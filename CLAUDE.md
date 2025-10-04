# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Point of Sale (POS) system built with Python that prints receipts to thermal printers. The application uses Eel framework to create a desktop app with a web-based UI for managing products, orders, and printing receipts with PromptPay QR codes.

## Development Setup

### Prerequisites
- Python 3.8 (required for compatibility)
- Virtual environment recommended

### Installation Commands
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment (Windows)
venv\Scripts\activate

# Activate virtual environment (Unix/Linux/macOS)
source venv/bin/activate

# Install dependencies
pip install -r requirement.txt
```

### Running the Application
```bash
# Development mode
python mini-pos.py

# Create executable
python -m eel mini-pos.py web --add-data "_internal/*;."
```

## Architecture

### Core Components

**Main Application (`mini-pos.py`)**
- Eel-based desktop application with web UI
- Exposes Python functions to JavaScript via `@eel.expose` decorator
- Manages CSV data files for products and orders
- Handles thermal printer communication via escpos library
- Integrates with Google Sheets for data synchronization

**Data Storage**
- Products: CSV file with columns [id, name, price]
- Orders: CSV file with columns [date, customer_name, items, quantities, prices]
- Config: JSON file for printer settings, shop details, and QR code configuration
- All data files stored in `~/.mini-pos/` directory (persistent storage)

**Web UI (`web/` directory)**
- Bootstrap-based responsive interface
- Three main tabs: Receipt, Products, Configuration
- JavaScript files handle UI interactions and communicate with Python backend

**Printer Integration**
- Network thermal printer support via escpos library
- Receipt printing with logo, items, discounts, delivery fees
- PromptPay QR code generation for payments
- Printer connectivity testing functionality

**PromptPay Integration (`_internal/promptpay.py`)**
- Generates Thai PromptPay QR codes for phone numbers or ID cards
- Includes CRC-16 checksum calculation for QR code validation

### Key Features
- Product management (add, edit, delete)
- Order processing with discounts and delivery fees
- Thermal receipt printing with PromptPay QR codes
- Google Sheets synchronization for data backup
- Network printer connectivity testing
- Configurable shop information and printer settings

## Build and Deployment

### GitHub Actions Workflow
The project includes automated building for Windows and macOS:
```bash
# Manually trigger build workflow
# Uses Python 3.8 on both Windows and macOS runners
# Creates single executable files for distribution
```

### Manual Build
```bash
python -m eel mini-pos.py web --add-data "_internal:_internal" --add-data "static:static" --onefile
```

## File Structure Notes

- `static/`: Default configuration and CSV files (copied to user directory on first run)
- `_internal/`: PromptPay QR code generation and CRC utilities
- `web/`: Complete web interface with Bootstrap styling
- Build outputs to `dist/` directory

## Development Notes

- Application automatically hides console window on Windows
- Uses persistent user directory (`~/.mini-pos/`) for data storage
- Thai language support in thermal printer output
- Supports both percentage and fixed amount discounts
- Delivery fee handling in order calculations
- Real-time printer connectivity checking via ping