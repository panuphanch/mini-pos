import eel, csv, os, gspread, io, json, base64, shutil, sys, ctypes
from escpos.printer import Network
from datetime import datetime
from _internal.promptpay import generate_promptpay_qr
from oauth2client.service_account import ServiceAccountCredentials
from PIL import Image
from collections import defaultdict
import pandas as pd

PERSISTENT_DIR = os.path.expanduser('~/.mini-pos')
os.makedirs(PERSISTENT_DIR, exist_ok=True)

def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, relative_path)

PRODUCT_COLUMNS = ['id', 'name', 'price']
ORDER_COLUMNS = ['date', 'customer_name', 'items', 'quantities', 'prices', 'total']

PRODUCTS_FILE = os.path.join(PERSISTENT_DIR, 'products.csv')
ORDERS_FILE = os.path.join(PERSISTENT_DIR, 'orders.csv')
CONFIG_FILE = os.path.join(PERSISTENT_DIR, 'config.json')
SHEETS_CREDS = os.path.join(PERSISTENT_DIR, 'sheetsCreds.json')

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')

if not os.path.exists(PRODUCTS_FILE):
    shutil.copy2(os.path.join(STATIC_DIR, 'products.csv'), PRODUCTS_FILE)
if not os.path.exists(ORDERS_FILE):
    shutil.copy2(os.path.join(STATIC_DIR, 'orders.csv'), ORDERS_FILE)
if not os.path.exists(CONFIG_FILE):
    shutil.copy2(os.path.join(STATIC_DIR, 'config.json'), CONFIG_FILE)

def hideConsole():
  whnd = ctypes.windll.kernel32.GetConsoleWindow()
  if whnd != 0:
     ctypes.windll.user32.ShowWindow(whnd, 0)

eel.init('web')
hideConsole()

@eel.expose
def load_products():
    products = []
    with open(PRODUCTS_FILE, 'r', encoding='UTF-8') as csv_file:
        csv_reader = csv.reader(csv_file)
        header = next(csv_reader)
        for row in csv_reader:
            products.append(row)
    return products

def get_last_id():
    with open(PRODUCTS_FILE, 'r', newline='', encoding='utf-8') as file:
        reader = csv.reader(file)
        last_row = None
        for row in reader:
            last_row = row
        return int(last_row[0]) if last_row else 0

@eel.expose
def add_product(product_name, product_price):
    with open(PRODUCTS_FILE, 'a', newline='', encoding='utf-8') as file:
        writer = csv.writer(file)
        last_id = get_last_id()
        new_id = last_id + 1
        writer.writerow([new_id, product_name, product_price])

@eel.expose
def test_sheets(sheet_name):
    try:
        get_google_sheet(0, sheet_name)
        return f"Successfully connected to {sheet_name}!"
    except Exception as e:
        return f"Failed to connect to {sheet_name}: {str(e)}"

def get_google_sheet(worksheet_index, sheet_name=None):
    scope = ['https://spreadsheets.google.com/feeds',
             'https://www.googleapis.com/auth/drive']

    credentials = ServiceAccountCredentials.from_json_keyfile_name(SHEETS_CREDS, scope)
    gc = gspread.authorize(credentials)

    # change to retrieve the sheet name from config.json
    if sheet_name is None:
        print("Reading sheet name from config.json")
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)
            sheet_name = config['sheetName']
        
        if not sheet_name:
            sh = gc.open("GrannySaidso Database")
        else:
            sh = gc.open(sheet_name)
        worksheet = sh.get_worksheet(worksheet_index)
    else:
        print(f"Reading sheet name from parameter: {sheet_name}")
        sh = gc.open(sheet_name)
        worksheet = sh.get_worksheet(worksheet_index)

    return worksheet

@eel.expose
def sync_products_to_google_sheet():
    print("Syncing products to Google Sheets...")

    worksheet = get_google_sheet(0)

    # Get data from the Google Sheet
    google_sheet_data = worksheet.get_all_values()
    google_sheet_df = pd.DataFrame(google_sheet_data[1:])
    if not google_sheet_df.empty:
        google_sheet_df.columns = PRODUCT_COLUMNS
    else:
        google_sheet_df = pd.DataFrame(columns=PRODUCT_COLUMNS)
    google_sheet_df['id'] = google_sheet_df['id'].astype('int64')
    google_sheet_df['name'] = google_sheet_df['name'].astype('str')
    google_sheet_df['price'] = google_sheet_df['price'].astype('int64')

    # Get data from the local CSV file
    try:
        local_csv_df = pd.read_csv(PRODUCTS_FILE)
    except pd.errors.EmptyDataError:
        print("No data in local CSV file")
        with open(PRODUCTS_FILE, 'w', newline='', encoding='utf-8') as file:
            writer = csv.writer(file)
            writer.writerow(PRODUCT_COLUMNS)
        local_csv_df = pd.DataFrame()
    if not local_csv_df.empty:
        local_csv_df.columns = PRODUCT_COLUMNS
    else:
        local_csv_df = pd.DataFrame(columns=PRODUCT_COLUMNS)
    local_csv_df['id'] = local_csv_df['id'].astype('int64')
    local_csv_df['name'] = local_csv_df['name'].astype('str')
    local_csv_df['price'] = local_csv_df['price'].astype('int64')

    # If both data sources are empty, write PRODUCT_COLUMNS to the local CSV file
    if google_sheet_df.empty and local_csv_df.empty:
        with open(PRODUCTS_FILE, 'w', newline='', encoding='utf-8') as file:
            writer = csv.writer(file)
            writer.writerow(PRODUCT_COLUMNS)
    
    merged_df = pd.merge(local_csv_df, google_sheet_df, how='outer', on=['id', 'name', 'price'], indicator=True)

    only_in_local = merged_df[merged_df['_merge'] == 'left_only']
    only_in_local = only_in_local.drop(columns=['_merge'])
    only_in_google_sheet = merged_df[merged_df['_merge'] == 'right_only']
    only_in_google_sheet = only_in_google_sheet.drop(columns=['_merge'])

    # Append the new data to the Google Sheet
    google_sheet_df = pd.concat([google_sheet_df, only_in_local], ignore_index=True)
    google_sheet_df = google_sheet_df.sort_values('id')

    # Append the new data to the local CSV file
    local_csv_df = pd.concat([local_csv_df, only_in_google_sheet], ignore_index=True)
    local_csv_df = local_csv_df.sort_values('id')

    ## Write the new data to the googe sheet
    # Clean the Google Sheet before appending the new data
    if not google_sheet_df.empty:
        worksheet.clear()
        worksheet.append_row(PRODUCT_COLUMNS)
        for index, row in google_sheet_df.iterrows():
            worksheet.append_row(row.tolist())

    ## Write the new data to the local CSV file
    # Clean the local CSV file before appending the new data
    if not local_csv_df.empty:
        with open(PRODUCTS_FILE, 'w', newline='', encoding='utf-8') as file:
            writer = csv.writer(file)
            writer.writerow(PRODUCT_COLUMNS)
            for index, row in local_csv_df.iterrows():
                writer.writerow(row.tolist())

    print("Syncing products to Google Sheets... Done!")

@eel.expose
def sync_orders_to_google_sheet():
    print("Syncing orders to Google Sheets...")

    worksheet = get_google_sheet(1)

    # Get data from the Google Sheet
    google_sheet_data = worksheet.get_all_values()
    google_sheet_df = pd.DataFrame(google_sheet_data[1:])
    if not google_sheet_df.empty:
        google_sheet_df.columns = ORDER_COLUMNS

    # Get data from the local CSV file
    try:
        local_csv_df = pd.read_csv(ORDERS_FILE)
    except pd.errors.EmptyDataError:
        print("No data in local CSV file")
        with open(ORDERS_FILE, 'w', newline='', encoding='utf-8') as file:
            writer = csv.writer(file)
            writer.writerow(ORDER_COLUMNS)
        local_csv_df = pd.DataFrame()
    if not local_csv_df.empty:
        local_csv_df.columns = ORDER_COLUMNS

    # If both data sources are empty, exit the function
    if google_sheet_df.empty and local_csv_df.empty:
        print("Both data sources are empty.")
        return

    # Find the data that's in the local CSV file but not in the Google Sheet
    if google_sheet_df.empty:
        new_data_for_google_sheet = local_csv_df
    elif google_sheet_df.empty and not local_csv_df.empty:
        new_data_for_google_sheet = local_csv_df[~local_csv_df[['date', 'customer_name']]
                                                .apply(tuple, 1)
                                                .isin(google_sheet_df[['date', 'customer_name']]
                                                    .apply(tuple, 1))]
    else:
        new_data_for_google_sheet = pd.DataFrame()

    # Append the new data to the Google Sheet
    for index, row in new_data_for_google_sheet.iterrows():
        worksheet.append_row(row.tolist())

    # Find the data that's in the Google Sheet but not in the local CSV file
    if local_csv_df.empty and not google_sheet_df.empty:
        new_data_for_local_csv = google_sheet_df
    elif google_sheet_df.empty:
        new_data_for_local_csv = pd.DataFrame()
    else:
        new_data_for_local_csv = google_sheet_df[~google_sheet_df[['date', 'customer_name']]
                                            .apply(tuple, 1).isin(local_csv_df[['date', 'customer_name']]
                                                                .apply(tuple, 1))]

    # Append the new data to the local CSV file
    new_data_for_local_csv.to_csv(ORDERS_FILE, mode='a', header=False, index=False)

@eel.expose
def edit_product(product_id, new_name, new_price):
    products = []
    with open(PRODUCTS_FILE, 'r', newline='', encoding='utf-8') as file:
        reader = csv.reader(file)
        for row in reader:
            products.append(row)

    with open(PRODUCTS_FILE, 'w', newline='', encoding='utf-8') as file:
        writer = csv.writer(file)
        for row in products:
            if row[0] == product_id:
                row[1] = new_name
                row[2] = new_price
            writer.writerow(row)

@eel.expose
def delete_product(product_id):
    products = []
    with open(PRODUCTS_FILE, 'r', newline='', encoding='utf-8') as file:
        reader = csv.reader(file)
        for row in reader:
            if row[0] != product_id:  # Keep rows that don't match the ID
                products.append(row)

    with open(PRODUCTS_FILE, 'w', newline='', encoding='utf-8') as file:
        writer = csv.writer(file)
        for i, row in enumerate(products, start=1):
            row[0] = str(i)
            writer.writerow(row)

@eel.expose
def load_orders():
    orders_dict = defaultdict(list)
    if os.path.exists(ORDERS_FILE):
        with open(ORDERS_FILE, 'r', encoding='UTF-8') as csv_file:
            csv_reader = csv.reader(csv_file)
            header = next(csv_reader)
            for row in csv_reader:
                date, customer_name, item, quantity, price = row
                orders_dict[(date, customer_name)].append([item, quantity, price])
    
    orders = []
    for key, values in orders_dict.items():
        date, customer_name = key
        items = "|".join(value[0] for value in values)
        quantities = "|".join(value[1] for value in values)
        prices = "|".join(value[2] for value in values)
        total = calculated_total(prices.split('|'), quantities.split('|'))
        orders.append([date, customer_name, items, quantities, prices, f"{total:.2f}"])
    
    orders.sort(key=lambda x: datetime.strptime(x[0], "%d/%m/%Y %H:%M"), reverse=True)
    return orders

@eel.expose
def save_order(items, quantities, prices, customer_name):
    total_price = calculated_total(prices, quantities)
    
    with open(ORDERS_FILE, 'a', newline='', encoding='UTF-8') as csv_file:
        writer = csv.writer(csv_file)

        if not os.path.exists(ORDERS_FILE):
            writer.writerow(['date', 'customer', 'items', 'amounts', 'prices', 'total'])
        
        date_now = datetime.now().strftime("%d/%m/%Y %H:%M")
        for item, quantity, price in zip(items, quantities, prices):
            order_data = [
                date_now,
                customer_name,
                item,
                quantity,
                price
            ]
            writer.writerow(order_data)

@eel.expose
def delete_order(date, customer_name):
    try:
        # Read the CSV file into a DataFrame
        df = pd.read_csv(ORDERS_FILE)

        # Remove the row with the matching date and customer_name
        df = df[(df['date'] != date) | (df['customer_name'] != customer_name)]

        # Write the DataFrame back to the CSV file
        df.to_csv(ORDERS_FILE, index=False)
    except pd.errors.EmptyDataError:
        print("The orders file is empty.")
    except Exception as e:
        print(f"Failed to delete order: {str(e)}")

def get_image_path():
    return resource_path(os.path.join('web', 'images', 'logo.png'))

def get_image():
    image_path = get_image_path()
    with open(resource_path(image_path), 'rb') as f:
        image_data = f.read()

    return Image.open(io.BytesIO(image_data))

@eel.expose
def save_config(config):
    try:
        if 'logo' in config:
            if config['logo']:
                logo_data = config['logo'].split(',')[1]
                logo_bytes = base64.b64decode(logo_data)
                image = Image.open(io.BytesIO(logo_bytes))
                max_size = (250, 250)
                image.thumbnail(max_size)
                image_path = get_image_path()
                image.save(image_path, "PNG")
            del config['logo']

        if 'sheetsCreds' in config:
            if config['sheetsCreds']:
                print(f"Saving sheetsCreds to _internal folder")
                sheets_creds_data = config['sheetsCreds'].split(',')[1]
                sheets_creds_bytes = base64.b64decode(sheets_creds_data)
                with open(SHEETS_CREDS, 'wb') as f:
                    f.write(sheets_creds_bytes)
            del config['sheetsCreds']

        print(f"Saving config: {config}")
        with open(CONFIG_FILE, 'w', encoding='UTF-8') as f:
            json.dump(config, f)

        return "Config saved successfully!"
    except Exception as e:
        return f"Failed to save config: {str(e)}"

@eel.expose
def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r', encoding='UTF-8') as f:
            return json.load(f)
    else:
        return {
            "printerIP": "192.168.1.55",
            "shopName": "Grannysaidso",
            "shopPhone": "064-241-5696",
            "shopLine": "@grannysaidso",
            "qrText": "Scan here to pay",
            "qrCodeType": "phone",
            "qrCodeValue": "0000000000",
            "thankYouMessage": "Thank you for always saving room for dessert!",
            "sheetName": "GrannySaidso Database"
        }
    
@eel.expose
def test_print(printerIP):
    """Print a test message and cut the paper."""
    try:
        p = Network(printerIP)
        p.text("Test print successful!\n\n")
        p.cut()
        return "Test print successful!"
    except OSError as e:
        if '10057' in str(e):
            return "Failed to print: The printer is not connected."
        else:
            return f"Failed to print: {str(e)}"
    except Exception as e:
        return f"Failed to print: {str(e)}"

@eel.expose
def print_receipt(items, quantities, prices, customer_name):
    print("Printing receipt...")

    try:
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)
            printer_ip = config['printerIP']
            shop_name = config['shopName']
            shop_phone = config['shopPhone']
            shop_line = config['shopLine']
            qr_text = config['qrText']
            qr_code_type = config['qrCodeType']
            qr_code_value = config['qrCodeValue']
            thank_you_message = config['thankYouMessage'] 
    except Exception as e:
        print(f"Failed to read config file: {str(e)}")
        return f"Failed to read config file: {str(e)}"
    
    print(f"Printer IP: {printer_ip}")
    print(f"Shop Name: {shop_name}")
    print(f"Shop Phone: {shop_phone}")
    print(f"Shop Line: {shop_line}")
    print(f"QR Text: {qr_text}")
    print(f"QR Code Type: {qr_code_type}")
    print(f"QR Code Value: {qr_code_value}")
    print(f"Thank You Message: {thank_you_message}")

    try:
        printer = Network(printer_ip)

        # Set thai character
        printer.charcode("THAI18")

        total_price = calculated_total(prices, quantities)

        # Logo
        printer.set(align='center')
        printer.image(get_image())
        printer.text("------------------------------------------------\n")

        printer.set(align='center')
        printer.text(f'{shop_name}\n')
        printer.text(f'{shop_phone}\n')
        printer.text(f'Line {shop_line}\n')
        printer.text("------------------------------------------------\n")

        printer.set(align='left')
        printer.text(f"Customer: {customer_name}\n")
        printer.text("------------------------------------------------\n")

        printer.set(align='left')
        for item, quantity, price in zip(items, quantities, prices):
            quantity = float(quantity)  # Parse quantity to float
            price = float(price)        # Parse price to float

            item_total_price = quantity * price
            printer.text(f"{item}".ljust(40) + f"฿{item_total_price:.2f}\n")
            printer.text(f"{quantity} x ฿{price:.2f}\n\n")
        printer.text("------------------------------------------------\n")

        printer.set(align='left', text_type='B')
        printer.text("Amount due".ljust(40) + f"฿{total_price:.2f}\n\n")
        printer.text("------------------------------------------------\n")

        qr_payload = generate_promptpay_qr(qr_code_type, qr_code_value, total_price)
        printer.set(align='center')
        printer.text(f"{qr_text}\n")
        printer.qr(qr_payload, size=7)
        printer.text("------------------------------------------------\n")

        printer.set(align='center')
        printer.text(f"{thank_you_message}\n")
        printer.set(align='left')
        printer.text(datetime.now().strftime("%d/%m/%Y, %H:%M\n"))

        printer.cut()

        print("Printing receipt... Done!")
        return "Print successful!"
    except OSError as e:
        if '10057' in str(e):
            return "Failed to print: The printer is not connected."
        else:
            return f"Failed to print: {str(e)}"
    except Exception as e:
        print(f"Failed to print: {str(e)}")
        return f"Failed to print: {str(e)}"

def calculated_total(prices, quantities):
    total_price = 0
    for price, quantity in zip(prices, quantities):
        total_price += float(price) * int(quantity)
    return total_price

eel.start('index.html', size=(1200, 900)) # , mode='edge') ## add mode if chrome not available