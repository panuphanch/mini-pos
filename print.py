from escpos.printer import Network
from datetime import datetime
from promptpay import generate_promptpay_qr

printer = Network("192.168.1.55")

## TODO:
## 1. Calculate total here using in QR and Amount due
## 2. Calculate checksum using crcmod <- DONE!
##    https://g.co/gemini/share/46a9b1388ec8
## 3. Find a way to pass Thai character and THB symbol (optional) <- DONE!
## 4. Try to fix alignment

printer.charcode("THAI18")

# qr_payload = generate_promptpay_qr("id_card", "1100700546038", 300)
# printer.set(align='center')
# printer.qr(qr_payload)

# printer.set(align='center')
# printer.image('logo.png')

# printer.set(align='left')
# printer.text("Customer: ฝ้าย\n")
# printer.set(align='center')
# printer.text("------------------------------------------------\n")

printer.set(align='left')
printer.text("Sweet Cider (3g.)".ljust(40) + "฿450.00\n")
# printer.set(align='right')
# printer.text("฿450.00\n")

printer.set(align='left')
printer.text("Namwah (2g.)".ljust(40) + "฿300.00\n")
# printer.set(align='right')
# printer.text("฿300.00\n")
# printer.set(align='center')
printer.text("------------------------------------------------\n")

# printer.set(align='left')
# printer.text("Amount due\n")
# printer.set(align='right')
# printer.text("฿750\n")
# printer.set(align='center')
# printer.text("------------------------------------------------\n")

# printer.set(align='center')
# printer.text("Thank you for always saving room for dessert!\n")
# printer.set(align='left')
# printer.text(datetime.now().strftime("%d/%m/%Y, %H:%M"))

printer.cut()