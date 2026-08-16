# Energy Farmer (Browser Extension)

A browser extension for Firefox and Google Chrome that automates chapter upvoting

---

## 🚀 Installation Guide

### Google Chrome & Chromium Browsers (Brave, Edge, Opera)

1. **Download/Clone** this repository to your computer.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `addon_ef` directory containing `manifest.json`.

---

### Mozilla Firefox

#### Temporary Developer Load
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select `manifest.json` from the project folder.
4. *(Note: Firefox temporary extensions reload until browser restart, so you will lose the history tab)*
---

## How to Use

1. **Log in**: Ensure you are logged into your account in your browser.
2. **Open Extension**: Click the **Energy Farmer** icon in your extension toolbar.
3. **Input Parameters**:
   - **Manga Input**: Paste either the title slug (e.g., `THAT-IS-A-TITLE`) or full chapter URL.
   - **Chapter Range**: Enter the Start Chapter (e.g. `1`) and End Chapter (e.g. `50`).
   - **Delay**: Set the delay per chapter (default `0.5s` / `500ms`).
4. **Start Farming**: Click **Start Farming**.
5. **View History**: Check the **History** tab in the extension popup to view upvoted chapter ranges per manga.

---

## License & Disclaimer


This project is created for educational and personal automation purposes. Please use responsible delay settings (`>= 0.5s`) to respect server load.
