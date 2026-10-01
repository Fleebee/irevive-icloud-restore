import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const path = new URL('../src/i18n.js', import.meta.url);
const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
function load({saved, locale = 'en-US', storageThrows = false} = {}) {
  let stored = saved;
  const ctx = vm.createContext({window: {}, navigator: {language: locale},
    localStorage: {
      getItem() { if (storageThrows) throw new Error('Unavailable'); return stored; },
      setItem(_key, value) { if (storageThrows) throw new Error('Unavailable'); stored = value; },
    },
  });
  vm.runInContext(source, ctx, {filename: new URL('../src/i18n.js', import.meta.url).pathname});
  return {api: ctx.window.IReviveI18n, stored: () => stored};
}

test('Chinese UI follows a Chinese system locale without changing Apple page language', () => {
  const {api} = load({locale: 'zh-CN'});
  assert.equal(api?.getLanguage(), 'zh-CN');
  assert.equal(api?.t('select'), '选择');
});
test('An English preference overrides a Chinese system locale and survives restarts', () => {
  const first = load({locale: 'zh-CN'});
  assert.equal(typeof first.api?.setLanguage, 'function');
  first.api.setLanguage('en');
  assert.equal(first.api.t('select'), 'Select');
  assert.equal(load({saved: first.stored(), locale: 'zh-CN'}).api.getLanguage(), 'en');
});
test('Unsupported saved locales fall back to a supported system language', () => {
  assert.equal(load({saved: 'xx', locale: 'de-DE'}).api?.getLanguage(), 'en');
});
test('Blocked storage does not prevent translating the interface', () => {
  const {api} = load({storageThrows: true, locale: 'zh-TW'});
  assert.equal(typeof api?.setLanguage, 'function');
  api.setLanguage('en');
  assert.equal(api.t('restore'), 'Restore / Confirm');
});
test('Recovery logs interpolate real counts in both languages', () => {
  const {api} = load();
  assert.equal(typeof api?.t, 'function');
  assert.equal(api.t('log.confirmed', {count: 40, total: 100}), 'Apple confirmed 40 files restored. Total: 100');
  api.setLanguage('zh-CN');
  assert.equal(api.t('log.confirmed', {count: 40, total: 100}), 'Apple 已确认恢复 40 个文件。累计：100');
});
test('Every catalog key is present in Chinese and English', () => {
  const {api} = load();
  assert.equal(typeof api?.catalogs, 'object');
  assert.deepEqual(Object.keys(api.catalogs.en).sort(), Object.keys(api.catalogs['zh-CN']).sort());
  for (const messages of Object.values(api.catalogs)) {
    assert.ok(Object.values(messages).every(value => typeof value === 'string' && value.length > 0));
  }
});
test('Unsupported switches and unknown messages have stable, text-only fallbacks', () => {
  const {api} = load();
  api.setLanguage('xx');
  assert.equal(api.getLanguage(), 'en');
  assert.equal(api.t('unknown.key'), 'unknown.key');
  assert.equal(api.t('minutes'), '{count} min');
  const title = {dataset: {i18nTitle: 'select'}, setAttribute(name, value) {this[name] = value;}};
  api.apply({documentElement: {}, querySelectorAll: s => s === '[data-i18n-title]' ? [title] : []});
  assert.equal(title.title, 'Select');
});
test('Applying translations changes text and accessibility labels without injecting HTML', () => {
  const {api} = load({locale: 'zh-CN'});
  assert.equal(typeof api?.apply, 'function');
  const button = {dataset: {i18n: 'select'}, textContent: 'Select'};
  const field = {dataset: {i18nLabel: 'batchSize'}, setAttribute(name, value) { this[name] = value; }};
  const doc = {documentElement: {lang: 'en'}, querySelectorAll(selector) {
    return selector === '[data-i18n]' ? [button] : selector === '[data-i18n-label]' ? [field] : [];
  }};
  api.apply(doc);
  assert.equal(doc.documentElement.lang, 'zh-CN');
  assert.equal(button.textContent, '选择');
  assert.equal(field['aria-label'], '每批文件数');
});

test('The shipped interface exposes a language selector and loads translations before controls', () => {
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="language-select"/);
  assert.ok(html.indexOf('src="i18n.js"') < html.indexOf('src="main.js"'));
  const {api} = load();
  for (const [, key] of html.matchAll(/data-i18n(?:-label|-title)?="([^"]+)"/g)) {
    assert.ok(Object.hasOwn(api.catalogs.en, key), `missing English translation: ${key}`);
    assert.ok(Object.hasOwn(api.catalogs['zh-CN'], key), `missing Chinese translation: ${key}`);
  }
});

test('Switching interface language preserves an active recovery batch and disabled controls', () => {
  const {api} = load({locale: 'en-US'});
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {disabled: true, value: id === 'auto-wait-time' ? '3' : '',
      classList: {contains: name => id === 'btn-select' && name === 'btn-cancelling', add() {}, toggle() {}},
      setAttribute() {}});
    return nodes.get(id);
  };
  const ctx = vm.createContext({window: {IReviveI18n: api, __TAURI__: {core: {}, opener: {}, updater: {}, process: {}, app: {}}, addEventListener() {}},
    document: {documentElement: {}, querySelectorAll: () => [], getElementById: node,
      createElement: () => ({innerHTML: '', textContent: ''})},
    setTimeout, clearTimeout, setInterval, clearInterval});
  vm.runInContext(source, ctx, {filename: new URL('../src/main.js', import.meta.url).pathname});
  vm.runInContext('browserLaunched = true; autoModeActive = true; totalRestored = 46; selectedNow = 40;', ctx);
  api.setLanguage('zh-CN');
  vm.runInContext('refreshInterfaceLanguage()', ctx);
  assert.equal(node('btn-auto').textContent, '停止自动恢复');
  assert.equal(node('btn-select').innerHTML, '取消');
  assert.equal(node('btn-select').disabled, true);
  assert.equal(vm.runInContext('totalRestored', ctx), 46);
  assert.equal(vm.runInContext('selectedNow', ctx), 40);
  assert.equal(vm.runInContext('autoModeActive', ctx), true);
});
