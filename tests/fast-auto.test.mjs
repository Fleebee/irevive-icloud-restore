import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
async function cycle({readyAt = 3000, confirmedAt = 6000, cancel = false, pendingManual = false, pageError = false, language = 'en'} = {}) {
  let now = 0, latest = {}, restoreClicks = 0;
  const pauses = [];
  const ctx = vm.createContext({
    window: {__TAURI__: {core: {}, opener: {}, updater: {}, process: {}, app: {}}, addEventListener() {}},
    document: {}, Date: class extends Date { static now() { return now; } },
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  vm.runInContext(readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8'), ctx, {filename: new URL('../src/i18n.js', import.meta.url).pathname});
  vm.runInContext(source, ctx, {filename: new URL('../src/main.js', import.meta.url).pathname});
  ctx.fakeInvoke = async (command, args) => {
    if (command === 'check_icloud') {
      latest = {selected: 20, loaded: 100, apple_error: pageError, restore_ready: now >= readyAt,
        confirmation_ready: now >= confirmedAt};
      return latest;
    }
    if (command === 'click_restore') {
      if (args.confirmOnly) return latest.confirmation_ready ? {action: 'confirm', restored: 20} : {action: 'pending'};
      restoreClicks++;
      return latest.restore_ready ? {action: 'restore', selected: 20} : {action: 'disabled'};
    }
    throw new Error(command);
  };
  ctx.fakePause = async (_label, ms = 60000) => {
    pauses.push(_label);
    now += ms;
    if (cancel) vm.runInContext('autoModeActive = false', ctx);
  };
  ctx.fakeSelect = async () => {
    if (pendingManual) {
      assert.ok(now >= confirmedAt, 'must confirm the manual request before selecting again');
      vm.runInContext('autoModeActive = false', ctx);
    }
    return {selected:20,total_selected:20};
  };
  vm.runInContext(`
    browserLaunched = true; autoModeActive = true;
    document.getElementById = id => ({value: id === 'batch-size' ? '20' : '1'});
    invokeWithReport = fakeInvoke; autoWait = fakePause;
    selectInICloud = fakeSelect;
    log = () => {}; logSelection = () => {}; setSelected = () => {}; updateCounters = () => {};
    setStatus = () => {}; showLoader = () => {}; showListWaitTimer = () => {}; stopListWaitTimer = () => {};
    showAutoTimer = () => {}; hideAutoTimer = () => {}; updateAutoTimer = () => {};
    stopAutoMode = () => { autoModeActive = false; };
    updateAutoCycleCount = () => { autoModeActive = false; };
  `, ctx);
  if (pendingManual) vm.runInContext('awaitingConfirm = true', ctx);
  ctx.window.IReviveI18n.setLanguage(language);
  await vm.runInContext('runAutoCycle()', ctx);
  return {elapsed: now, restoreClicks, pauses, cycles: vm.runInContext('autoCycleCount', ctx), restored: vm.runInContext('totalRestored', ctx)};
}

test('Auto waits for readiness, confirms promptly, and completes without minute-long sleeps', async () => {
  const r = await cycle();
  assert.equal(r.cycles, 1);
  assert.equal(r.restored, 20);
  assert.equal(r.restoreClicks, 1);
  assert.ok(r.elapsed < 10000, `fixed waits took ${r.elapsed}ms`);
});
test('A Restore button that never becomes ready times out without being clicked', async () => {
  const r = await cycle({readyAt: Infinity, confirmedAt: Infinity});
  assert.equal(r.restoreClicks, 0);
  assert.equal(r.cycles, 0);
});
test('Chinese polling progress uses Chinese countdown instructions', async () => {
  const result = await cycle({language: 'zh-CN'});
  assert.ok(result.pauses.length > 0);
  assert.ok(result.pauses.every(label => !label.includes('checking again in')));
});
test('Stopping during a readiness poll does not send a restore request', async () => {
  const r = await cycle({cancel: true});
  assert.equal(r.restoreClicks, 0);
  assert.equal(r.cycles, 0);
});
test('No confirmation means no successful count and no duplicate Restore request', async () => {
  const r = await cycle({readyAt: 0, confirmedAt: Infinity});
  assert.equal(r.restoreClicks, 1);
  assert.equal(r.restored, 0);
  assert.equal(r.cycles, 0);
});
test('Auto finishes a pending manual restore before selecting another batch', async () => {
  const r = await cycle({pendingManual:true});
  assert.equal(r.restoreClicks, 0);
  assert.equal(r.restored, 20);
});
test('Apple loading errors stop Auto without sending a restore request', async () => {
  const r = await cycle({pageError:true});
  assert.equal(r.restoreClicks, 0);
  assert.equal(r.restored, 0);
  assert.equal(r.cycles, 0);
});

test('An old finished timer cannot clear the next polling timer', async () => {
  const callbacks = [];
  const ctx = vm.createContext({
    window: {__TAURI__: {core:{},opener:{},updater:{},process:{},app:{}},addEventListener(){}},
    document: {}, Date,
    setTimeout: fn => { callbacks.push(fn); return callbacks.length; }, clearTimeout() {},
    setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8'), ctx, {filename: new URL('../src/i18n.js', import.meta.url).pathname});
  vm.runInContext(source, ctx, {filename: new URL('../src/main.js', import.meta.url).pathname});
  vm.runInContext('showAutoTimer = () => {}; hideAutoTimer = () => {}; autoWait("first", 10)', ctx);
  callbacks[0]();
  vm.runInContext('autoWait("second", 10)', ctx);
  callbacks[0]();
  assert.equal(vm.runInContext('typeof autoWaitResolve', ctx), 'function');
  callbacks[1]();
});
