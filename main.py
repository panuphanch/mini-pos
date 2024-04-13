## TODO:
## 1. Continue on products sync to Google Sheets: product.js to call main.py
## 2. Create GH action to create executable file for both Windows and Mac
## 3. Create a way to edit and delete orders
## 4. Clear the order form after submitting

import eel, csv, os, gspread, io
from escpos.printer import Network
from datetime import datetime
from _internal.promptpay import generate_promptpay_qr
from oauth2client.service_account import ServiceAccountCredentials
from PIL import Image
import pandas as pd

PRINTER_IP = '192.168.1.55'
PRODUCT_COLUMNS = ['id', 'name', 'price']
PRODUCTS_FILE = 'static/products.csv'
ORDER_COLUMNS = ['date', 'customer_name', 'items', 'quantities', 'prices', 'total']
ORDERS_FILE = 'static/orders.csv'
SHEETS_CREDS = '_internal/grannysaidso-7abe2438dfe8.json'

eel.init('web')

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

def get_google_sheet(worksheet_index):
    scope = ['https://spreadsheets.google.com/feeds',
             'https://www.googleapis.com/auth/drive']

    credentials = ServiceAccountCredentials.from_json_keyfile_name(SHEETS_CREDS, scope)
    gc = gspread.authorize(credentials)

    sh = gc.open("GrannySaidso Database")
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
    orders = []
    if os.path.exists(ORDERS_FILE):
        with open(ORDERS_FILE, 'r', encoding='UTF-8') as csv_file:
            csv_reader = csv.reader(csv_file)
            header = next(csv_reader)
            for row in csv_reader:
                orders.append([column.replace("|", ", ") for column in row])
    orders.sort(key=lambda x: datetime.strptime(x[0], "%d/%m/%Y %H:%M"), reverse=True)
    return orders

@eel.expose
def save_order(items, quantities, prices, customer_name):
    total_price = calculated_total(prices, quantities)
    
    with open(ORDERS_FILE, 'a', newline='', encoding='UTF-8') as csv_file:
        writer = csv.writer(csv_file)

        if not os.path.exists(ORDERS_FILE):
            writer.writerow(['date', 'customer', 'items', 'amounts', 'prices', 'total'])
        
        order_data = [
                datetime.now().strftime("%d/%m/%Y %H:%M"),
                customer_name,
                '|'.join(items),
                '|'.join(quantities),
                '|'.join(prices),
                f"{total_price:.2f}"
            ]
        writer.writerow(order_data)

def get_image():
    image_path = os.path.join('web', 'images', 'logo.png') 
    with open(image_path, 'rb') as f:
        image_data = f.read()

    return Image.open(io.BytesIO(image_data))

@eel.expose
def print_receipt(items, quantities, prices, customer_name):
    print("Printing receipt...")

    printer = Network(PRINTER_IP)

    # Set thai character
    printer.charcode("THAI18")

    total_price = calculated_total(prices, quantities)

    # # Logo (If your printer supports it)
    printer.set(align='center')
    printer.image(get_image())
    printer.text("------------------------------------------------\n")

    printer.set(align='center')
    printer.text('Grannysaidso\n')
    printer.text('064-241-5696\n')
    printer.text('Line @grannysaidso\n')
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

    qr_payload = generate_promptpay_qr("id_card", "1100700546038", total_price)
    printer.set(align='center')
    printer.text("Scan here to pay\n")
    printer.qr(qr_payload, size=7)
    printer.text("------------------------------------------------\n")

    printer.set(align='center')
    printer.text("Thank you for always saving room for dessert!\n")
    printer.set(align='left')
    printer.text(datetime.now().strftime("%d/%m/%Y, %H:%M\n"))

    printer.cut()

def calculated_total(prices, quantities):
    total_price = 0
    for price, quantity in zip(prices, quantities):
        total_price += float(price) * int(quantity)
    return total_price

eel.start('index.html', size=(1200, 900)) # , mode='edge') ## add mode if chrome not available