import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const helpers = rust.match(/const PAGE_HELPERS: &str = r#"([\s\S]*?)"#;/)[1];

async function run(command, { outsideContent = true, renderedSelected = 0,
  label = '恢复 40 个文件', disabled = false, hidden = false } = {}) {
  const clicks = [];
  const button = {
    textContent: label, disabled, parentElement: null,
    getClientRects: () => hidden ? [] : [{}],
    getAttribute: () => null, closest: () => null,
    scrollIntoView() {}, click() { clicks.push(label); },
  };
  const buttons = [button];
  const query = selector => {
    if (selector.startsWith('button,')) return buttons;
    if (selector === 'input[type="checkbox"]:checked') return Array(renderedSelected).fill({});
    return [];
  };
  const content = {querySelectorAll: outsideContent ? () => [] : query};
  const document = {querySelector: () => content, querySelectorAll: query};
  let report;
  const context = vm.createContext({document, report: r => { report = r; }, cancelled: () => false,
    setTimeout: fn => { fn(); }, Date});
  const template = rust.slice(rust.indexOf(`async fn ${command}(`))
    .match(/r#"([\s\S]*?)"#,\s*\);/)[1];
  const body = template.replace('{PAGE_HELPERS}', helpers)
    .replaceAll('{request_id}', '1').replaceAll('{confirm_only}', 'false')
    .replaceAll('{{', '{').replaceAll('}}', '}');
  await vm.runInContext(`(async () => { ${body} })()`, context);
  return {report, clicks};
}

test('Readiness finds an enabled recovery footer outside the file-list content', async () => {
  const {report, clicks} = await run('check_icloud', {renderedSelected: 40});
  assert.equal(report.restore_ready, true);
  assert.deepEqual(clicks, []);
});

test('Footer count preserves selected files when their checkboxes are not rendered', async () => {
  const {report} = await run('check_icloud', {outsideContent: false, renderedSelected: 0});
  assert.equal(report.selected, 40);
  assert.equal(report.restore_ready, true);
});

test('Restore submits the footer batch even when selected checkboxes are off screen', async () => {
  const {report, clicks} = await run('click_restore');
  assert.deepEqual(clicks, ['恢复 40 个文件']);
  assert.equal(report.action, 'restore');
  assert.equal(report.selected, 40);
  assert.equal(report.restored, 0);
});

test('A disabled footer with a positive count is still not ready', async () => {
  const {report, clicks} = await run('check_icloud', {disabled: true});
  assert.equal(report.restore_ready, false);
  assert.deepEqual(clicks, []);
});

test('Hidden footer counts cannot invent a selected batch', async () => {
  const {report} = await run('check_icloud', {hidden: true});
  assert.equal(report.selected, 0);
  assert.equal(report.restore_ready, false);
});

test('An uncounted Restore button still uses rendered checkbox selection', async () => {
  const {report} = await run('check_icloud', {label: 'Restore', renderedSelected: 5});
  assert.equal(report.selected, 5);
  assert.equal(report.restore_ready, true);
});

test('English footer counts support thousands separators', async () => {
  const {report} = await run('check_icloud', {label: 'Restore 1,234 Files'});
  assert.equal(report.selected, 1234);
  assert.equal(report.restore_ready, true);
});

test('Chinese button labels ignore invisible bidirectional formatting marks', async () => {
  const {report} = await run('check_icloud', {label: '恢复\u200e 40 个文件'});
  assert.equal(report.selected, 40);
  assert.equal(report.restore_ready, true);
});

test('Traditional Chinese recovery labels count selected files', async () => {
  const {report} = await run('check_icloud', {label: '恢復 40 個檔案'});
  assert.equal(report.selected, 40);
  assert.equal(report.restore_ready, true);
});
