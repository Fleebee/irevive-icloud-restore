# iRevive

**For when iCloud Restore messes you about.**

iRevive automates the painful process of restoring thousands of files from iCloud's Data Recovery page. Instead of manually selecting and restoring files one by one, iRevive lets you batch-select and restore hundreds at a time.

[![Download iRevive](https://img.shields.io/badge/Download-iRevive_for_macOS-af52de?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/Fleebee/irevive-icloud-restore/releases/latest/download/iRevive_aarch64.dmg)

## How It Works

1. **Open iCloud** - Opens a window to iCloud's Data Recovery page
2. **Sign In** - Sign in with your Apple ID and navigate to Restore Files
3. **Wait for Items to Load** - Let the file list start loading
4. **Scan Page** - Detects selectable items on the page
5. **Select Items** - Automatically checks a batch of items (configurable, default 500)
6. **Click Restore** - Finds and clicks the Restore button, even if scrolled off-screen
7. **Confirm** - Click the confirmation dialog in iCloud
8. **Repeat** - Keep going until all items are restored

## Features

- Self-contained native macOS app - no dependencies required
- Configurable batch size (select 50, 500, or any number at a time)
- Automatic restore button detection (works even when scrolled off-screen)
- Confirmation dialog detection - one button handles both restore and confirm
- Loading indicator for long operations
- Detects when the iCloud window is closed

## Build from Source

```bash
git clone https://github.com/Fleebee/irevive-icloud-restore.git
cd irevive-icloud-restore
npm install
npm run tauri dev
```

Requires [Node.js](https://nodejs.org/) and [Rust](https://rustup.rs/).

## Built By

**Leon Gilroy** | [Gilroy Digital](https://gilroy.digital)

If iRevive saved you time, consider [supporting the project](https://donate.stripe.com/14A28r1Fq9yNf7agVqfbq02).
