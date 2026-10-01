# iRevive

**For when iCloud Restore messes you about.**

iRevive automates the painful process of restoring thousands of files from iCloud's Data Recovery page. Instead of manually selecting and restoring files one by one, iRevive lets you batch-select and restore hundreds at a time.

[![Download iRevive](https://img.shields.io/badge/Download-iRevive_for_macOS-af52de?style=for-the-badge&logo=apple&logoColor=white)](https://backend.gilroy.digital/api/apps/irevive/download/)

[Product page](https://gilroy.digital/icloud-file-restore-frozen/index.html) — what iRevive does, and why iCloud's Restore Files page struggles with large restores.

## How It Works

1. **Open iCloud** - Opens a window to iCloud's Data Recovery page
2. **Sign In** - Sign in with your Apple ID and navigate to Restore Files
3. **Wait for Items to Load** - Let the file list start loading
4. **Select Items** - Automatically checks a batch of items (configurable, default 500)
5. **Restore / Confirm** - Clicks the Restore button, or dismisses the confirmation dialog
6. **Repeat** - Keep going until all items are restored
A. **Auto Mode** - Select a verified batch, restore when the button is ready, confirm success, then continue. The slider limits readiness waiting; it is not a fixed pause.

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

**Leon Gilroy** | [Gilroy Digital](https://gilroy.digital) | [iRevive product page](https://gilroy.digital/icloud-file-restore-frozen/index.html)

If iRevive saved you time, consider [supporting the project](https://donate.stripe.com/14A28r1Fq9yNf7agVqfbq02).


## English / 中文 recovery controls

Choose English or 简体中文 in the header. This changes recovery controls, help, status and new recovery logs, independently of the iCloud page's language. English, Simplified Chinese and selected Traditional Chinese recovery labels are recognized. Feedback, privacy, donation and updater dialogs retain their existing text and behavior.

在右上角切换 English / 简体中文，不需要修改 Apple 账户语言。自动模式在恢复按钮可用后提交一次请求，读到 Apple 成功确认后才累计并继续；无法验证或超时会停止。每批数量是上限，包含已有选择；无需先手动恢复一批。滑块不是固定等待。

[Recovery behavior, limits and local verification / 操作、限制与本地验证](docs/RECOVERY.md)

```sh
npm run check
npm test
npm run fixture
python3 -m http.server 8768 --bind 127.0.0.1 --directory artifacts/fixture
```

The fixture uses simulated files and never connects to an Apple account. / 夹具只使用模拟文件，不连接 Apple 账户。
