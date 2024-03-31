## TODO:
## 1. When add, edit, remove product dropdown on order_management.html incorrect.
## 2. Pack software
## NOTE:
## 1. Check after pack software how to change logo
## 2. Check availability on both Windows, and macOS

import eel, csv, os
from escpos.printer import Network
from datetime import datetime
from _internal.promptpay import generate_promptpay_qr

PRINTER_IP = '192.168.1.55'
PRODUCTS_FILE = '_internal/products.csv'
ORDERS_FILE = '_internal/orders.csv'
LOGO = '_internal/logo.png'

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
        writer.writerows(products) 


@eel.expose
def load_orders():
    orders = []
    if os.path.exists(ORDERS_FILE):
        with open(ORDERS_FILE, 'r', encoding='UTF-8') as csv_file:
            csv_reader = csv.reader(csv_file)
            header = next(csv_reader)
            for row in csv_reader:
                orders.append([column.replace("|", ", ") for column in row])
                
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

@eel.expose
def print_receipt(items, quantities, prices, customer_name):
    printer = Network(PRINTER_IP)

    # Set thai character
    printer.charcode("THAI18")

    total_price = calculated_total(prices, quantities)

    # # Logo (If your printer supports it)
    printer.set(align='center')
    printer.image(LOGO)
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