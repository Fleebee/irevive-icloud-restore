import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const helpers = rust.match(/const PAGE_HELPERS: &str = r#"([\s\S]*?)"#;/)[1];
const body = rust.slice(rust.indexOf('async fn click_restore('))
  .match(/r#"([\s\S]*?)"#,\s*\);/)[1]
  .replace('{PAGE_HELPERS}', helpers)
  .replaceAll('{request_id}', '1')
  .replaceAll('{{', '{').replaceAll('}}', '}');

async function run({ buttons, selected = 2, title = '', confirmOnly = false }) {
  const clicks = [];
  const heading = { textContent: title };
  const container = {
    scrollHeight: 100, clientHeight: 100,
    querySelectorAll: () => title ? [heading] : [],
    parentElement: null,
  };
  const nodes = buttons.map(({ text, disabled = false, tile = false, hidden = false }) => ({
    textContent: text, disabled, parentElement: container,
    getClientRects: () => hidden ? [] : [{}],
    getAttribute: () => null,
    closest: (selector) => selector === '.tile-article' ? (tile ? {} : null)
      : selector === '[role="dialog"]' ? container : null,
    scrollIntoView() {},
    click() { if (!this.disabled) clicks.push(text); },
  }));
  const doc = {
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === 'button, [role="button"]') return nodes;
      if (selector === 'button, [role="button"], a') return nodes;
      if (selector === 'input[type="checkbox"]:checked') return Array(selected).fill({});
      if (selector === 'h1, h2, [role="heading"]') return title ? [heading] : [];
      return [];
    },
  };
  const reports = [];
  const context = vm.createContext({ document: doc, report: r => reports.push(r),
    setTimeout: fn => { fn(); return 0; }, Date, cancelled: () => false });
  await vm.runInContext(`(async () => { ${body.replace('{confirm_only}', String(confirmOnly))} })()`, context);
  return { clicks, report: reports.at(-1) };
}

test('Chinese recovery restores the selected batch and never deletes it', async () => {
  const result = await run({ buttons: [{ text: '删除 2 个文件' }, { text: '恢复 2 个文件' }] });
  assert.deepEqual(result.clicks, ['恢复 2 个文件']);
  assert.equal(result.report.action, 'restore');
  assert.equal(result.report.selected, 2);
});

test('Chinese success confirmation reports the count Apple actually restored', async () => {
  const result = await run({ buttons: [{ text: '好' }], selected: 0, title: '已恢复 39 个文件' });
  assert.deepEqual(result.clicks, ['好']);
  assert.equal(result.report.action, 'confirm');
  assert.equal(result.report.restored, 39);
});

test('English recovery skips the background Restore Files tile', async () => {
  const result = await run({ buttons: [{ text: 'Restore Files', tile: true }, { text: 'Restore 2 Files' }] });
  assert.deepEqual(result.clicks, ['Restore 2 Files']);
});

test('A pane Close button must not be treated as recovery success', async () => {
  const result = await run({ buttons: [{ text: 'Close' }, { text: 'Restore 2 Files' }] });
  assert.deepEqual(result.clicks, ['Restore 2 Files']);
});

test('Disabled recovery must not restore or delete anything', async () => {
  const result = await run({ buttons: [{ text: '删除 2 个文件' }, { text: '恢复 2 个文件', disabled: true }] });
  assert.deepEqual(result.clicks, []);
  assert.equal(result.report.action, 'disabled');
});

test('English confirmation reports the server-confirmed count', async () => {
  const result = await run({ buttons: [{ text: 'OK' }], selected: 0, title: '2 files were restored' });
  assert.deepEqual(result.clicks, ['OK']);
  assert.equal(result.report.restored, 2);
});

test('Waiting for confirmation never clicks Restore a second time', async () => {
  const result = await run({ buttons: [{ text: '恢复 2 个文件' }], confirmOnly: true });
  assert.deepEqual(result.clicks, []);
  assert.equal(result.report.action, 'pending');
});

test('A hidden restore control must not mask the visible recovery button', async () => {
  const result = await run({ buttons: [{text: '恢复 1 个文件', hidden: true}, {text: '恢复 2 个文件'}] });
  assert.deepEqual(result.clicks, ['恢复 2 个文件']);
});

test('Traditional Chinese success counts the confirmed files', async () => {
  const result = await run({buttons: [{text: '好'}], selected: 0, title: '已恢復 40 個檔案'});
  assert.deepEqual(result.clicks, ['好']);
  assert.equal(result.report.restored, 40);
});

test('Chinese and English recovery labels accept nonbreaking whitespace', async () => {
  for (const text of ['恢复\u00a040\u00a0个文件', 'Restore\u00a040\u00a0Files']) {
    const result = await run({buttons: [{text}], selected: 40});
    assert.equal(result.report.action, 'restore');
    assert.equal(result.report.selected, 40);
  }
});
