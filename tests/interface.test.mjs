import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Minimal DOM and native bridge: tests assert visible states and submitted commands.
function app() {
  const nodes = new Map(), events = new Map(), timers = new Map(), intervals = new Map();
  let nextTimer = 1;
  const element = id => {
    const classes = new Set();
    return {id, dataset: {}, style: {}, value: id === 'batch-size' ? '100' : '3', disabled: false,
      querySelectorAll: () => [], children: [], events: new Map(), attributes: {}, hidden: false,
      classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
        toggle(x, on) { if (on ?? !classes.has(x)) classes.add(x); else classes.delete(x); }},
      addEventListener(type, fn) { this.events.set(type, fn); },
      setAttribute(key, value) { this.attributes[key] = value; },
      appendChild(child) { this.children.push(child); }, removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      get firstChild() { return this.children[0]; },
      set textContent(value) { this.text = String(value); this.children = []; this.html = String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); },
      get textContent() { return this.text || ''; },
      set innerHTML(value) { this.html = value; if (value === '') this.children = []; }, get innerHTML() { return this.html || ''; },
    };
  };
  const node = id => { if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); };
  const commands = [], opened = [];
  let respond = () => ({}), failure = null;
  const window = {addEventListener: (name, fn) => events.set(name, fn), __TAURI__: {
    core: {invoke: async (command, args = {}) => {
      commands.push({command, args});
      if (failure) throw new Error(failure);
      if (args.requestId) {
        const report = respond(command, args);
        if (report) window.__onICloudReport({id: args.requestId, ...report});
      }
      return {ok: true};
    }}, opener: {openUrl: async url => opened.push(url)}, updater: {check: async () => null}, process: {relaunch: async () => {}}, app: {getVersion: async () => '0.4.0'},
  }};
  const link = element('external'); link.href = 'https://github.com/Fleebee/irevive-icloud-restore';
  const ctx = vm.createContext({window, navigator: {language: 'en'},
    localStorage: {getItem() {}, setItem() {}},
    document: {documentElement: {}, getElementById: node, createElement: () => element('new'),
      addEventListener: (name, fn) => events.set(name, fn),
      querySelectorAll: selector => selector === '[data-open-privacy]' ? [node('btn-privacy')] : selector === 'a.donate-link, a.brand-link' ? [link]
        : selector === '.modal-overlay.active' ? [...nodes.values()].filter(n => n.id.startsWith('modal-') && n.classList.contains('active')) : []},
    setTimeout: fn => { const id = nextTimer++; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = nextTimer++; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),
  });
  for (const file of ['i18n.js', 'main.js']) {
    const url = new URL('../src/' + file, import.meta.url);
    vm.runInContext(readFileSync(url, 'utf8'), ctx, {filename: url.pathname});
  }
  vm.runInContext('initSupport = () => {}; initClearData = () => {};', ctx);
  events.get('DOMContentLoaded')();
  return {ctx, node, window, events, link, commands, opened, timers, intervals,
    run: code => vm.runInContext(code, ctx), click: id => node(id).events.get('click')?.({target: node(id)}),
    response: fn => { respond = fn; }, fail: message => { failure = message; },
    log: () => node('log-area').children.map(n => n.innerHTML).join('\n')};
}

test('Manual selection, restore submission and confirmation show distinct verified counts', async () => {
  const a = app();
  await a.click('btn-launch');
  assert.equal(a.node('btn-launch').textContent, 'Show iCloud');
  a.response(command => command === 'select_batch' ? {selected: 40, total_selected: 40}
    : {action: 'restore', selected: 40});
  await a.click('btn-select');
  assert.equal(a.node('count-selected').textContent, '40');
  assert.equal(a.node('btn-select').disabled, false);
  await a.click('btn-restore');
  assert.equal(a.node('count-selected').textContent, '0');
  assert.equal(a.run('totalRestored'), 0);
  a.response(() => ({action: 'confirm', restored: 37}));
  await a.click('btn-restore');
  assert.equal(a.node('count-restored').textContent, '37');
  assert.match(a.log(), /Apple confirmed 37/);
});

test('Launch and action failures restore controls and report localized errors', async () => {
  const a = app(); a.fail('Bridge unavailable');
  await a.click('btn-launch');
  assert.equal(a.node('btn-launch').disabled, false);
  assert.match(a.log(), /Could not open iCloud/);
  await a.click('btn-select');
  assert.equal(a.node('btn-select').disabled, false);
  await a.click('btn-restore'); await a.click('btn-deselect');
  a.run('setSelectAsCancel(true); icloudBusy = true');
  await a.run('selectBatch()');
  await a.run('cancelICloud()');
  assert.match(a.log(), /Selection failed/);
  assert.match(a.log(), /Restore failed/);
  assert.match(a.log(), /Deselect failed/);
  assert.match(a.log(), /Could not stop/);
});

test('Deselect preserves off-screen selections, idle reports refresh counts, and closing disables actions', async () => {
  const a = app(); await a.click('btn-launch');
  a.response(command => command === 'deselect_all' ? {cleared: 5, still_selected: 35} : {selected: 35, loaded: 100});
  await a.click('btn-deselect');
  assert.equal(a.node('count-selected').textContent, '35');
  a.response(() => ({selected: 12, loaded: 100}));
  await a.run('checkICloudIdle()');
  assert.equal(a.node('count-selected').textContent, '12');
  a.run('autoModeActive = true'); a.window.__onICloudClosed();
  assert.equal(a.node('btn-auto').disabled, true);
  assert.equal(a.run('autoModeActive'), false);
});

test('Apple loading errors show help once, and translated controls keep their purpose', async () => {
  const a = app(); await a.click('btn-launch');
  a.response(() => ({selected: 0, apple_error: true}));
  await a.run('checkICloudIdle()'); await a.run('checkICloudIdle()');
  assert.equal(a.node('modal-apple-error').classList.contains('active'), true);
  assert.equal(a.log().split('Apple could not load').length - 1, 1);
  await a.click('btn-apple-error-browser');
  assert.deepEqual(a.opened, ['https://www.icloud.com/recovery']);
  await a.click('btn-apple-error-close');
  assert.equal(a.node('modal-apple-error').classList.contains('active'), false);
  a.node('language-select').events.get('change')({target: {value: 'zh-CN'}});
  assert.equal(a.node('btn-auto').textContent, '启动自动恢复');
  a.node('auto-wait-time').value = '5';
  a.node('auto-wait-time').events.get('input')({target: a.node('auto-wait-time')});
  assert.equal(a.node('auto-slider-value').textContent, '5 分钟');
});

test('Help, donation and privacy close without starting recovery or opening links implicitly', async () => {
  const a = app();
  a.click('btn-welcome-start');
  for (const name of ['help', 'donate', 'privacy']) {
    a.click('btn-' + name);
    assert.equal(a.node('modal-' + name).classList.contains('active'), true);
    a.click('close-' + name);
    a.click('btn-' + name); a.events.get('keydown')({key: 'Escape'});
    assert.equal(a.node('modal-' + name).classList.contains('active'), false);
    a.click('btn-' + name); a.click('modal-' + name);
  }
  a.events.get('keydown')({key: 'Enter'});
  assert.equal(a.commands.length, 0); assert.equal(a.opened.length, 0);
  a.link.events.get('click')({preventDefault() {}});
  assert.equal(a.opened[0], a.link.href);
  a.click('tab-auto'); assert.equal(a.node('panel-manual').hidden, true);
  a.click('tab-manual'); assert.equal(a.node('panel-auto').hidden, true);
  a.click('btn-clear-log'); assert.equal(a.node('log-area').children.length, 0);
});

test('Late or unrelated native reports cannot resolve a different request', async () => {
  const a = app(); a.response(() => null);
  const pending = a.run('invokeWithReport("check_icloud", {}, 10)');
  const id = a.commands.at(-1).args.requestId;
  a.window.__onICloudReport({id: id + 1, selected: 500});
  for (const fn of [...a.timers.values()]) fn();
  assert.equal(await pending, null);
  a.window.__onICloudReport({id, selected: 500});
  assert.equal(a.run('selectedNow'), 0);
});

test('Timer cancellation resolves pending waits, and logs escape markup and stay bounded', async () => {
  const a = app();
  a.run('showListWaitTimer()');
  for (const fn of a.intervals.values()) fn();
  assert.match(a.node('auto-timer-label').textContent, /Waiting for iCloud/);
  a.run('stopListWaitTimer()');
  const pending = a.run('autoWait("Checking", 1)');
  for (const fn of a.intervals.values()) fn();
  for (const fn of [...a.timers.values()]) fn();
  await pending;
  a.run('log("<script>secret</script>");');
  assert.match(a.log(), /&lt;script&gt;/);
  a.run('for (let i=0; i<510; i++) log("Entry " + i);');
  assert.equal(a.node('log-area').children.length, 500);
  assert.match(a.log(), /Entry 509/);
});

test('Auto start and stop controls disable manual actions and preserve the selected batch', async () => {
  const a = app(); await a.click('btn-launch');
  a.run('runAutoCycle = () => {}; setSelected(40, false);');
  a.click('btn-auto');
  assert.equal(a.node('btn-select').disabled, true);
  assert.equal(a.node('btn-auto').textContent, 'Stop Auto');
  a.click('btn-auto');
  assert.equal(a.node('btn-select').disabled, false);
  assert.equal(a.node('count-selected').textContent, '40');
  assert.equal(a.node('btn-auto').textContent, 'Start Auto');
});

test('Recovery action reports explain pending, unavailable, malformed and loading-error states', async () => {
  const a = app(); await a.click('btn-launch');
  for (const report of [{action:'pending'}, {action:'disabled'}, {action:'missing'}, {action:'restore',selected:0},
    {action:'missing',apple_error:true}]) {
    a.response(() => report); await a.click('btn-restore');
  }
  assert.equal(a.run('totalRestored'), 0);
  assert.match(a.log(), /Waiting for Apple’s recovery confirmation/);
  assert.match(a.log(), /No restore request was sent/);
  assert.match(a.log(), /without a verified selected count/);
  a.run('logSelection({cancelled:true,selected:3,total_selected:43}, 100);');
  assert.equal(a.node('count-selected').textContent, '43');
  a.run('logSelection({selected:0,total_selected:0,retries:1,apple_error:true}, 100);');
  assert.match(a.log(), /Retried 1/);
  a.run('logSelection({selected:0,total_selected:0}, 100); logSelection({selected:20,total_selected:20}, 100); logSelection(null,100);');
  assert.match(a.log(), /No new files/);
  assert.match(a.log(), /Selected 20 of 100/);
  assert.match(a.log(), /selected count could not be read/);
});
