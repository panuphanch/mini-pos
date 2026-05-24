# Granny's POS

A small point-of-sale app for printing receipts to a thermal printer, with Google Sheets sync and PromptPay QR codes.

## Download

Grab the latest installer from the **[Releases page](https://github.com/panuphanch/mini-pos/releases/latest)**:

- **macOS** → download the file ending in `.dmg`
- **Windows** → download the file ending in `.msi`

## Install on macOS

1. **Open the `.dmg` file** you downloaded.
2. **Drag _Granny's POS_ into the _Applications_ folder.**
3. **Eject the disk image** (right-click the disk icon on your desktop → Eject).

### First time you open it

The first time only, macOS will block the app because it isn't from the App Store. This is normal — just follow these steps once:

1. Open **Applications** and double-click _Granny's POS_.
2. You'll see this message:

   > _"Granny's POS" Not Opened — Apple could not verify "Granny's POS" is free of malware…_

   Click **Done**.

3. Open **System Settings** (the gear icon in the Dock, or Apple menu → System Settings).
4. Click **Privacy & Security** in the sidebar.
5. **Scroll all the way down** to the **Security** section. You'll see a line that says:

   > _"Granny's POS" was blocked to protect your Mac._

   Click the **Open Anyway** button next to it.

6. Enter your Mac password if asked.
7. Double-click _Granny's POS_ in Applications again. A new dialog appears — this time with an **Open** button. Click **Open**.

That's it. From now on, double-clicking the app just opens it normally.

## Install on Windows

1. **Double-click the `.msi` file** you downloaded.
2. Follow the installer (just keep clicking Next).
3. _Granny's POS_ will appear in the Start menu.

If Windows shows a blue **"Windows protected your PC"** screen:

1. Click **More info**.
2. Click **Run anyway**.

This only happens the first time.

## First-time setup inside the app

1. Open _Granny's POS_.
2. Go to the **Settings** tab.
3. Fill in:
   - **Shop name, phone, LINE**
   - **Printer IP address** (you can find this in your printer's network menu)
   - **PromptPay number** (phone number or ID card)
   - **Google Sheet ID** + the service account JSON file (your husband or developer will set this up for you).
4. Click **Save**.
5. Go to the **Sync** tab and tap **Sync this week** to pull orders from the Google Sheet.

## Day-to-day

- **Orders** tab → see this week's orders, print receipts, mark items, merge rows.
- **Sync** tab → pull the latest from Google Sheets after your wife adds new orders.
- **Settings** tab → change printer / shop info anytime.

## Need help?

Open an issue on the [GitHub repo](https://github.com/panuphanch/mini-pos/issues) or ask the person who set this up for you.
