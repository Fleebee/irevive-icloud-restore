import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function setup(value) {
  const ctx = vm.createContext({window: {__TAURI__: {core: {}, opener: {}, updater: {}, process: {}, app: {}}, addEventListener() {}},
    document: {getElementById: () => ({value})}, setTimeout, clearTimeout, setInterval, clearInterval});
  vm.runInContext(readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8'), ctx, {filename: new URL('../src/i18n.js', import.meta.url).pathname});
  vm.runInContext(source, ctx, {filename: new URL('../src/main.js', import.meta.url).pathname});
  vm.runInContext('log = () => {}; browserLaunched = true;', ctx);
  return ctx;
}
test('Invalid batch settings do not silently select a fallback batch or start Auto', () => {
  for (const value of ['0', '-1', '12.5', '5001', 'invalid', '']) {
    const ctx = setup(value);
    assert.equal(vm.runInContext('typeof getBatchSize', ctx), 'function');
    assert.equal(vm.runInContext('getBatchSize()', ctx), null);
    vm.runInContext('startAutoMode()', ctx);
    assert.equal(vm.runInContext('autoModeActive', ctx), false);
  }
});
test('Valid integer batch limits are accepted exactly', () => {
  for (const value of ['1', '20', '100', '5000']) {
    const ctx = setup(value);
    assert.equal(vm.runInContext('typeof getBatchSize', ctx), 'function');
    assert.equal(vm.runInContext('getBatchSize()', ctx), Number(value));
  }
});
