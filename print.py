from escpos.printer import Network
from datetime import datetime
from _internal.promptpay import generate_promptpay_qr

printer = Network("192.168.1.55")

# Set thai character
printer.charcode("THAI18")

printer.set(align='center')
printer.image('web/images/logo.png')
printer.text("------------------------------------------------\n")

printer.set(align='center')
printer.text('Grannysaidso\n')
printer.text('064-241-5696\n')
printer.text('Line @grannysaidso\n')
printer.text("------------------------------------------------\n")

printer.set(align='left')
printer.text(f"CURSTOMER: บริษัท อาร์ท ฟาร์มเมอร์ คอเปอร์เรชั่น จำกัด\n")
printer.text(f"ADDRESS: 89/6 ม.2 ต.ท่าศาลา อ.เมืองเชียงใหม่\n")
printer.text(f"\tจ.เชียงใหม่ 50000\n")
printer.text(f"เลขประจำตัวผู้เสียภาษีอากร: 0505564016594\n")
printer.text("------------------------------------------------\n")

printer.set(align='left')
printer.text(f"บลอนดี้ชาไทย".ljust(40) + f"฿{700:.2f}\n")
printer.text(f"{2} x ฿{350:.2f}\n\n")
printer.text("------------------------------------------------\n")

printer.set(align='left', text_type='B')
printer.text("Amount due".ljust(40) + f"฿{700:.2f}\n\n")
printer.text("------------------------------------------------\n")

qr_payload = generate_promptpay_qr("id_card", "1100700546038", 700)
printer.set(align='center')
printer.text("Scan here to pay\n")
printer.qr(qr_payload, size=7)
printer.text("------------------------------------------------\n")

printer.set(align='center')
printer.text("Thank you for always saving room for dessert!\n")
printer.set(align='left')
printer.text(datetime.now().strftime("%d/%m/%Y, %H:%M\n"))

printer.cut()