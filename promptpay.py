from crc16pure import crc16xmodem 

def generate_promptpay_qr(account_type, account_id, amount, multiple_use=False):
    """
    Generates a PromptPay QR code string.

    Args:
        account_type (str): "phone" or "id_card"
        account_id (str): Phone number (format: 0898350889) or ID card number
        amount (float): Transaction amount
        multiple_use (bool): True for multiple uses, False for one-time use

    Returns:
        str: The generated PromptPay QR code string
    """

    payload = "000201"  # Required start
    if multiple_use:
        payload += "010212"  # Multiple use
    else:
        payload += "010211"  # One-time use

    # Merchant Account Information
    payload += "2937"  # Field ID and length
    if account_type == "phone":
        payload += "0016A00000067701011101130066" + account_id[1:]
    elif account_type == "id_card":
        payload += "0016A0000006770101110213" + account_id
    else:
        raise ValueError("Invalid account type. Must be 'phone' or 'id_card'")

    payload += "5802TH"  # Country code
    payload += "5303764"  # Currency code (THB)

    if amount > 0:
        amount_str = "{:.2f}".format(amount)
        payload += "54" + str(len(amount_str)).zfill(2) + amount_str  # Amount

	# CRC-16 Checksum 
    payload += "6304"
    hex_crc16 = hex(crc16xmodem(payload, 0xFFFF))
    checksum = hex_crc16.upper()[2:].zfill(4)
    payload += checksum

    return payload