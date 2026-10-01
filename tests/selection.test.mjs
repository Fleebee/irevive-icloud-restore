import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const helpers = rust.match(/const PAGE_HELPERS: &str = r#"([\s\S]*?)"#;/)[1];
const template = rust.slice(rust.indexOf('async fn select_batch('))
  .match(/r#"([\s\S]*?)"#,\s*\);/)[1];

async function select({ count = 20, existing = 0, growing = false, rerender = false, disabled = false, virtualized = false, cancelAt = Infinity } = {}) {
  let now = 0, scrolls = 0;
  const selected = new Set(Array.from({length: existing}, (_, i) => i));
  let size = virtualized ? existing + 100 : 100, nodes = [];
  const footer = {
    get textContent() { return `恢复 ${selected.size} 个文件`; },
    getClientRects: () => [{}], getAttribute: () => null, closest: () => null,
  };
  function render() {
    nodes.forEach(el => { el.isConnected = false; });
    nodes = Array.from({length: size}, (_, id) => ({
      isConnected: true, checked: selected.has(id), disabled,
      getAttribute: () => null, matches: () => true,
      scrollIntoView() { scrolls++; },
      click() {
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        this.checked = selected.has(id);
        if (rerender) render();
      },
    }));
  }
  render();
  const document = {
    querySelector: () => null,
    querySelectorAll: selector => {
      if (selector === 'input[type="checkbox"]:not(:checked)') return nodes.filter(el => !el.checked);
      if (selector === 'input[type="checkbox"]:checked') return virtualized ? [] : nodes.filter(el => el.checked);
      if (selector === 'button, [role="button"]' && virtualized) return [footer];
      return [];
    },
  };
  let report;
  const ctx = vm.createContext({document, report: r => { report = r; }, cancelled: () => now >= cancelAt,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, ms) => { now += ms; if (growing && ms >= 1000) { size++; render(); } fn(); },
  });
  let body = template.replace('{PAGE_HELPERS}', helpers);
  for (const [key, value] of Object.entries({ n: count, request_id: 1, wait_ms: 180000, settle_ms: 20000, max_retries: 0, ready_when_count: true })) {
    body = body.replaceAll(`{${key}}`, String(value));
  }
  body = body.replaceAll('{{', '{').replaceAll('}}', '}');
  await vm.runInContext(`(async () => { ${body} })()`, ctx);
  return { report, scrolls, selected: selected.size, elapsed: now };
}

test('A full batch starts immediately even while more files continue loading', async () => {
  const r = await select({growing: true});
  assert.equal(r.selected, 20);
  assert.ok(r.report.waited_ms < 3000, `unnecessary list wait: ${r.report.waited_ms}ms`);
});
test('An existing full batch is preserved without adding another batch', async () => {
  const r = await select({existing: 20});
  assert.equal(r.selected, 20);
  assert.equal(r.report.clicked, 0);
});
test('Off-screen selected files count toward the limit through the recovery footer', async () => {
  const r = await select({count: 100, existing: 40, virtualized: true});
  assert.equal(r.selected, 100);
  assert.equal(r.report.clicked, 60);
  assert.equal(r.report.total_selected, 100);
});
test('Selection survives React replacing rows after a click', async () => {
  const r = await select({rerender: true});
  assert.equal(r.selected, 20);
});
test('Clicking real checkboxes does not scroll the page for every file', async () => {
  const r = await select();
  assert.equal(r.selected, 20);
  assert.equal(r.scrolls, 0);
});
test('Cancelling selection prevents additional checkbox clicks', async () => {
  const r = await select({count: 100, cancelAt: 50});
  assert.ok(r.selected < 100);
  assert.equal(r.report.cancelled, true);
});
test('Disabled file checkboxes do not cause a slow selection loop', async () => {
  const r = await select({disabled: true});
  assert.equal(r.selected, 0);
  assert.ok(r.elapsed < 3000);
});
