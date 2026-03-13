# iRevive

**For when iCloud Restore messes you about.**

iRevive automates the painful process of restoring thousands of files from iCloud's Data Recovery page. Instead of manually selecting and restoring files one by one, iRevive lets you batch-select and restore hundreds at a time.

[![Download iRevive](https://img.shields.io/badge/Download-iRevive_for_macOS-af52de?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/Fleebee/irevive-icloud-restore/releases/latest/download/iRevive_aarch64.dmg)

## How It Works

1. **Open iCloud** - Opens a window to iCloud's Data Recovery page
2. **Sign In** - Sign in with your Apple ID and navigate to Restore Files
3. **Wait for Items to Load** - Let the file list start loading
4. **Select Items** - Automatically checks a batch of items (configurable, default 500)
5. **Restore / Confirm** - Clicks the Restore button, or dismisses the confirmation dialog
6. **Repeat** - Keep going until all items are restored
A. **Auto Mode** - For automated restore attempts at configurable intervals

## Features

- Self-contained native macOS app - no dependencies required
- Configurable batch size (select 50, 500, or any number at a time)
- Real-time selection counter updates as items are checked
- Automatic restore button detection (works even when scrolled off-screen)
- One button handles both restore and confirmation dialogs
- Code-signed and notarized for macOS

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
