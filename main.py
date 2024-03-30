import eel
import socket
from escpos.printer import Network
from datetime import datetime
from promptpay import generate_promptpay_qr

PRINTER_IP = '192.168.1.55'

eel.init('web')

@eel.expose
def print_receipt(items, prices, customer_name):
    printer = Network(PRINTER_IP)

    # Set thai character
    # printer.charcode("THAI18")

    total_price = sum(float(price) for price in prices)
    print(f"Amount due: {total_price}")

    printer.block_text

    # qr_payload = generate_promptpay_qr("id_card", "1100700546038", 300)
    # printer.set(align='center')
    # printer.qr(qr_payload)

    # # Logo (If your printer supports it)
    # printer.set(align='center')
    # printer.image('logo.png')

    # printer.set(align='center')
    # printer.text("Customer: {}\n".format(customer_name))
    # printer.text("------------\n")

    # for item, price in zip(items, prices):
    #     printer.text("{}   ฿{}\n".format(item, price))  # THB currency symbol
    # printer.text("------------\n")

    # printer.set(align='right')
    # printer.text(f"Total:  ฿{sum(prices):.2f}\n\n")

    # printer.set(align='center')
    # printer.text("Thank you for always saving room for dessert!\n")
    # printer.text(datetime.now().strftime("%d/%m/%Y, %H:%M\n"))

    # printer.cut()

eel.start('index.html', size=(300, 300), mode='edge') 
