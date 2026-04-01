## Thai Font for Receipt Printing

This directory should contain the NotoSansThai font for rendering Thai text on thermal receipt printers.

### Download

1. Go to https://fonts.google.com/noto/specimen/Noto+Sans+Thai
2. Click "Download family"
3. Extract the zip and copy `NotoSansThai-Regular.ttf` into this directory

The application will gracefully handle the font not being present by falling back to ASCII-only printing with a warning logged to stderr.
