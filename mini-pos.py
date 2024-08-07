import eel, csv, os, gspread, io, json, base64, shutil, sys, ctypes, subprocess
from escpos.printer import Network
from datetime import datetime
from _internal.promptpay import generate_promptpay_qr
from oauth2client.service_account import ServiceAccountCredentials
from PIL import Image
from collections import defaultdict
from wcwidth import wcswidth
import pandas as pd

PERSISTENT_DIR = os.path.expanduser('~/.mini-pos')
os.makedirs(PERSISTENT_DIR, exist_ok=True)

def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, relative_path)

PRODUCT_COLUMNS = ['id', 'name', 'price']
ORDER_COLUMNS = ['date', 'customer_name', 'items', 'quantities', 'prices']

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
    google_sheet_data = worksheet.get_all_values()
    google_sheet_df = pd.DataFrame(google_sheet_data[1:])
    if not google_sheet_df.empty:
        google_sheet_df.columns = ORDER_COLUMNS
    else:
        google_sheet_df = pd.DataFrame(columns=ORDER_COLUMNS)
    google_sheet_df['date'] = pd.to_datetime(google_sheet_df['date'], format="%d/%m/%Y %H:%M")
    google_sheet_df['customer_name'] = google_sheet_df['customer_name'].astype('str')
    google_sheet_df['items'] = google_sheet_df['items'].astype('str')
    google_sheet_df['quantities'] = google_sheet_df['quantities'].astype('str')
    google_sheet_df['prices'] = google_sheet_df['prices'].astype('str')

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
    else:
        local_csv_df = pd.DataFrame(columns=ORDER_COLUMNS)
    local_csv_df['date'] = pd.to_datetime(local_csv_df['date'], format="%d/%m/%Y %H:%M")
    local_csv_df['customer_name'] = local_csv_df['customer_name'].astype('str')
    local_csv_df['items'] = local_csv_df['items'].astype('str')
    local_csv_df['quantities'] = local_csv_df['quantities'].astype('str')
    local_csv_df['prices'] = local_csv_df['prices'].astype('str')

    merged_df = pd.merge(local_csv_df, google_sheet_df, how='outer', on=ORDER_COLUMNS, indicator=True)

    only_in_local = merged_df[merged_df['_merge'] == 'left_only']
    only_in_local = only_in_local.drop(columns=['_merge'])
    only_in_google_sheet = merged_df[merged_df['_merge'] == 'right_only']
    only_in_google_sheet = only_in_google_sheet.drop(columns=['_merge'])

    google_sheet_df = pd.concat([google_sheet_df, only_in_local], ignore_index=True)
    google_sheet_df = google_sheet_df.sort_values('date')
    google_sheet_df['date'] = google_sheet_df['date'].dt.strftime("%d/%m/%Y %H:%M")

    local_csv_df = pd.concat([local_csv_df, only_in_google_sheet], ignore_index=True)
    local_csv_df = local_csv_df.sort_values('date')
    local_csv_df['date'] = local_csv_df['date'].dt.strftime("%d/%m/%Y %H:%M")

    if not google_sheet_df.empty:
        worksheet.clear()
        # Convert the DataFrame to a list of lists and prepend the columns
        rows = [ORDER_COLUMNS] + google_sheet_df.values.tolist()
        # Use the append_rows method to append all rows at once
        worksheet.append_rows(rows)

    if not local_csv_df.empty:
        with open(ORDERS_FILE, 'w', newline='', encoding='utf-8') as file:
            writer = csv.writer(file)
            writer.writerow(ORDER_COLUMNS)
            for index, row in local_csv_df.iterrows():
                writer.writerow(row.tolist())

    print("Syncing orders to Google Sheets... Done!")

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
        items = "|".join(value[0] for value in values if value[0] != 'discount' and value[0] != 'delivery_fee')
        quantities = "|".join(value[1] for value in values if value[0] != 'discount' and value[0] != 'delivery_fee')
        prices = "|".join(value[2] for value in values if value[0] != 'discount' and value[0] != 'delivery_fee')
        total_withou_addition = calculated_total(prices.split('|'), quantities.split('|'))
        discounts = [(value[1], value[2]) for value in values if value[0] == 'discount']
        discount = 0
        total_discount = 0
        discount_type = 'none'
        if discounts and discounts[0][0] == 'percentage':
            discount = float(discounts[0][1])
            total_discount = float(discounts[0][1]) * total_withou_addition / 100
            discount_type = 'percentage'
        elif discounts and discounts[0][0] == 'amount':
            discount = float(discounts[0][1])
            total_discount = float(discounts[0][1])
            discount_type = 'amount'
        delivery_fee = sum(float(value[2]) for value in values if value[0] == 'delivery_fee')
        total = total_withou_addition - discount + delivery_fee
        orders.append([date, customer_name, items, quantities, prices, discount_type, f"{discount:.2f}", f"{total_discount:.2f}", f"{delivery_fee:.2f}", f"{total:.2f}"])
    
    orders.sort(key=lambda x: datetime.strptime(x[0], "%d/%m/%Y %H:%M"), reverse=True)
    return orders

@eel.expose
def save_order(items, quantities, prices, customer_name, discount_type, discount, delivery_fee):    
    with open(ORDERS_FILE, 'a', newline='', encoding='UTF-8') as csv_file:
        writer = csv.writer(csv_file)

        if not os.path.exists(ORDERS_FILE):
            writer.writerow(ORDER_COLUMNS)
        
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

        # Wrtie discount transaction
        writer.writerow([
            date_now,
            customer_name,
            "discount",
            discount_type,
            discount
        ])

        # Wrtie delivery fee transaction
        if delivery_fee and float(delivery_fee) > 0:
            writer.writerow([
                date_now,
                customer_name,
                "delivery_fee",
                "1",
                delivery_fee
            ])

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
        if is_reachable(printerIP):
            p = Network(printerIP)
            p.text("Test print successful!\n\n")
            p.cut()
            return "Test print successful!"
        else:
            return "The printer is not connected."
    except OSError as e:
        if '10057' in str(e):
            return "Failed to print: The printer is not connected."
        else:
            return f"Failed to print: {str(e)}"
    except Exception as e:
        return f"Failed to print: {str(e)}"
    
def is_reachable(ip):
    try:
        # Use '-n 1' for Windows, '-c 3' for Unix-based systems
        command = ["ping", "-n", "1", ip] if os.name == 'nt' else ["ping", "-c", "3", "-W", "3", ip]
        response = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Decode the stdout to a string
        output = response.stdout.decode()
        
        # Check for unreachable message in the output
        unreachable = "Destination host unreachable" in output or "Request timed out" in output
        
        return response.returncode == 0 and not unreachable
    except Exception as e:
        print(f"An error occurred: {e}")
        return False

@eel.expose
def print_receipt(items, quantities, prices, customer_name, discount_type, discount, delivery_fee):
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
        if not is_reachable(printer_ip):
            return "The printer is not connected."

        printer = Network(printer_ip)

        # Set thai character
        printer.charcode("THAI18")

        total_price = calculated_total(prices, quantities)

        # Logo
        printer.set(align='center')
        printer.image(get_image())
        printer.set(align='left')
        printer.text("------------------------------------------------\n")

        printer.set(align='center')
        printer.text(f'{shop_name}\n')
        printer.text(f'{shop_phone}\n')
        printer.text(f'Line {shop_line}\n')
        printer.set(align='left')
        printer.text("------------------------------------------------\n")

        printer.set(align='left')
        printer.text(f"Customer: {customer_name}\n")
        printer.text("------------------------------------------------\n")

        total_width = 48
        printer.set(align='left')
        for item, quantity, price in zip(items, quantities, prices):
            quantity = float(quantity)  # Parse quantity to float
            price = float(price)        # Parse price to float

            item_total_price = quantity * price
            item_total_price_str = f"฿{item_total_price:.2f}"
            
            # Calculate the display width of the item text
            item_display_width = wcswidth(item)
            item_width = total_width - len(item_total_price_str)
            
            # Print item on the left and item_total_price with ฿ on the right
            printer.text("{:<{}}{:>{}}\n".format(item, item_width - item_display_width + len(item), item_total_price_str, len(item_total_price_str)))
            printer.text(f"{quantity} x ฿{price:.2f}\n\n")
        printer.text("------------------------------------------------\n")

        if discount_type != 'none':
            printer.set(align='left')
            if discount_type == 'percentage':
                discount_text = f"{float(discount):.2f}%"
                discount = float(discount) * total_price / 100
                total_price = total_price - discount
            else:
                total_price = total_price - float(discount)
                discount_text = f"฿{float(discount):.2f}"
            
            discount_line = f"Discount ({discount_text}) ฿{float(discount):.2f}\n"
            discount_display_width = wcswidth(discount_line)
            total_width = 47  # Assuming total width of the receipt
            right_justify = total_width - discount_display_width
            
            printer.text(f"Discount ({discount_text})" + f" ฿{float(discount):.2f}\n".rjust(right_justify))

        if float(delivery_fee) > 0:
            total_price = total_price + float(delivery_fee)
            printer.set(align='left')
            delivery_fee_text = f"Delivery fee"
            delivery_fee_amount = f"฿{float(delivery_fee):.2f}"
            delivery_fee_display_width = wcswidth(delivery_fee_text) + wcswidth(delivery_fee_amount)
            left_justify = total_width - delivery_fee_display_width
            printer.text(f"{delivery_fee_text}{' ' * left_justify}{delivery_fee_amount}\n")

        printer.set(align='left', text_type='B')
        amount_due_text = "Amount due"
        amount_due_amount = f"฿{total_price:.2f}"
        amount_due_display_width = wcswidth(amount_due_text) + wcswidth(amount_due_amount)
        left_justify = total_width - amount_due_display_width
        printer.text(f"{amount_due_text}{' ' * left_justify}{amount_due_amount}\n\n")
        printer.text("------------------------------------------------\n")

        qr_payload = generate_promptpay_qr(qr_code_type, qr_code_value, total_price)
        printer.set(align='center')
        printer.text(f"{qr_text}\n")
        printer.qr(qr_payload, size=7)
        printer.set(align='left')
        printer.text("------------------------------------------------\n")

        printer.set(align='center')
        printer.text(f"{thank_you_message}\n")
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

eel.start('index.html', size=(1400, 900)) # , mode='edge') ## add mode if chrome not available