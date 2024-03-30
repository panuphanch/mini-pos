## TODO:
## 1. Product management page
##    1.1. Display Products
##    1.2. Add Product
##    1.3. Update Product
##    1.4. Remove Product
## 2. Link between both page (Maybe show as tab)
## 3. Pack software
## NOTE:
## 1. Check after pack software how to change logo
## 2. Check availability on both Windows, and macOS

import eel, csv
from escpos.printer import Network
from datetime import datetime
from promptpay import generate_promptpay_qr

PRINTER_IP = '192.168.1.55'

eel.init('web')

@eel.expose
def load_products():
    products = []
    with open("products.csv", 'r', encoding='UTF-8') as file:
        csvreader = csv.reader(file)
        header = next(csvreader)
        for row in csvreader:
            products.append(row)
    return products

@eel.expose
def print_receipt(items, quantities, prices, customer_name):
    printer = Network(PRINTER_IP)

    # Set thai character
    printer.charcode("THAI18")

    total_price = sum(float(price) for price in prices)

    # # Logo (If your printer supports it)
    printer.set(align='center')
    printer.image('logo.png')
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

eel.start('index.html', size=(300, 300), mode='edge') 
