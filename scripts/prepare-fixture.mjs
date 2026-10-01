// Uses the production scripts against fake local files, never an Apple account.
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'artifacts', 'fixture');
await mkdir(destination, {recursive: true});
await cp(path.join(root, 'src'), destination, {recursive: true});
const rust = await readFile(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const helpers = rust.match(/const PAGE_HELPERS: &str = r#"([\s\S]*?)"#;/)[1];
const scripts = {};
for (const command of ['select_batch', 'click_restore', 'check_icloud', 'deselect_all']) {
  const template = rust.slice(rust.indexOf(`async fn ${command}(`)).match(/r#"([\s\S]*?)"#,\s*\);/)[1];
  scripts[command] = template.replace('{PAGE_HELPERS}', helpers).replaceAll('{{', '{').replaceAll('}}', '}');
}
await writeFile(path.join(destination, 'fixture-scripts.js'), `window.fixtureScripts = ${JSON.stringify(scripts)};\n`);
await cp(path.join(root, 'fixtures/platform.js'), path.join(destination, 'platform.js'));
await cp(path.join(root, 'fixtures/icloud.html'), path.join(destination, 'fake-icloud.html'));
let html = await readFile(path.join(destination, 'index.html'), 'utf8');
html = html.replace('<script type="module" src="main.js" defer>', '<script src="fixture-scripts.js"></script><script src="platform.js"></script><script type="module" src="main.js" defer>');
html = html.replace('<body>', `<body><p class="fixture-banner">DEMO / 隔离测试 · 150 simulated files · 不连接 Apple，不处理真实文件</p><iframe id="fixture-page" title="Simulated iCloud / 模拟 iCloud" src="fake-icloud.html"></iframe><style>.fixture-banner{color:#34d399;padding:4px;text-align:center;font-size:12px}#fixture-page{width:100%;height:190px;border:0}.container{height:900px}body{overflow:auto}</style>`);
await writeFile(path.join(destination, 'index.html'), html);
process.stdout.write(`Prepared isolated fixture at ${destination}\nServe on localhost; use ?apple=en, ?apple=zh-CN or ?apple=zh-TW to choose the simulated Apple page.\n`);
