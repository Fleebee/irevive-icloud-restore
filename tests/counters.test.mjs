import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function context(report) {
  const ctx = vm.createContext({
    window: { __TAURI__: { core: {}, opener: {}, updater: {}, process: {}, app: {} }, addEventListener() {} },
    document: {}, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  vm.runInContext(readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8'), ctx, {filename: new URL('../src/i18n.js', import.meta.url).pathname});
  vm.runInContext(source, ctx, {filename: new URL('../src/main.js', import.meta.url).pathname});
  ctx.result = report;
  vm.runInContext(`invokeWithReport = async () => result; log = () => {}; setSelected = () => {}; updateCounters = () => {};`, ctx);
  return ctx;
}
test('Clicking Restore does not count files before Apple confirms success', async () => {
  const ctx = context({ action: 'restore', selected: 60 });
  await vm.runInContext('restoreInICloud()', ctx);
  assert.equal(vm.runInContext('totalRestored', ctx), 0);
});
test('Apple confirmation counts only its actual restored number', async () => {
  const ctx = context({ action: 'confirm', selected: 0, restored: 39 });
  const report = await vm.runInContext('restoreInICloud()', ctx);
  assert.equal(vm.runInContext('totalRestored', ctx), 39);
  assert.equal(report.action, 'confirm');
});

function selectionLog(report) {
  const ctx = context(report);
  const messages = [];
  ctx.capture = message => messages.push(message);
  vm.runInContext('log = capture; logSelection(result, 100)', ctx);
  return messages.join('\n');
}

test('Selection log distinguishes new clicks from the full existing batch', () => {
  assert.match(selectionLog({selected: 60, total_selected: 100}), /60 new items; 100 total selected/);
});

test('An existing selected batch is not logged as having nothing to restore', () => {
  const message = selectionLog({selected: 0, total_selected: 40});
  assert.match(message, /40 total selected/);
  assert.doesNotMatch(message, /nothing left to restore/i);
});

test('Partial selection logs do not guess that Apple has no more loaded files', () => {
  assert.doesNotMatch(selectionLog({selected: 40, total_selected: 40}), /all iCloud had loaded/);
});

test('Auto stops when the selection report is missing, without attempting recovery', async () => {
  const ctx = context(null);
  vm.runInContext(`
    browserLaunched = true; autoModeActive = true;
    document.getElementById = () => ({value: '500'});
    selectInICloud = async () => null;
    logSelection = () => {}; setStatus = () => {}; showLoader = () => {};
    showListWaitTimer = () => {}; stopListWaitTimer = () => {}; updateAutoCycleCount = () => {};
    stopAutoMode = () => { autoModeActive = false; };
    var restoreCalls = 0, waits = 0;
    restoreInICloud = async () => { restoreCalls++; return {action: 'restore'}; };
    autoWait = async () => { if (++waits >= 2) autoModeActive = false; };
  `, ctx);
  await vm.runInContext('runAutoCycle()', ctx);
  assert.equal(vm.runInContext('restoreCalls', ctx), 0);
  assert.equal(vm.runInContext('autoCycleCount', ctx), 0);
});

test('Auto confirms successful recovery before it can select the next batch', async () => {
  const ctx = context({ action: 'status', loaded: 500 });
  vm.runInContext(`
    browserLaunched = true; autoModeActive = true;
    document.getElementById = () => ({value: '500'});
    selectInICloud = async () => ({selected: 60, total_selected: 60});
    logSelection = () => {}; setStatus = () => {}; showLoader = () => {};
    showListWaitTimer = () => {}; stopListWaitTimer = () => {}; updateAutoCycleCount = () => {};
    stopAutoMode = () => { autoModeActive = false; };
    var modes = [];
    invokeWithReport = async () => ({restore_ready:true,confirmation_ready:modes.length > 0});
    restoreInICloud = async (prefix, only = false) => { modes.push(only); return {action:only ? 'confirm' : 'restore',restored:60}; };
    updateAutoCycleCount = () => { autoModeActive = false; };
  `, ctx);
  await vm.runInContext('runAutoCycle()', ctx);
  assert.deepEqual(Array.from(vm.runInContext('modes', ctx)), [false, true]);
  assert.equal(vm.runInContext('autoCycleCount', ctx), 1);
});
