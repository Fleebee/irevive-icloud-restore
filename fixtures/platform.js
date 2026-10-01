window.fixtureStats = {restoreRequests: 0, confirmations: 0};
window.__TAURI__ = {
  core: {invoke: async (command, args = {}) => {
    const page = document.getElementById('fixture-page').contentWindow;
    if (command === 'open_icloud_window') return {ok:true,status:'Isolated fixture opened'};
    if (command === 'cancel_icloud') { page.__ireviveCancelAt = Date.now(); return; }
    if (!window.fixtureScripts[command]) throw new Error('Unexpected fixture command: '+command);
    const values = {request_id:args.requestId,n:args.count || 100,wait_ms:args.waitMs || 0,
      settle_ms:args.settleMs || 3000,max_retries:args.maxRetries || 0,
      ready_when_count:!!args.readyWhenCount,confirm_only:!!args.confirmOnly};
    const code = window.fixtureScripts[command].replace(/\{(request_id|n|wait_ms|settle_ms|max_retries|ready_when_count|confirm_only)\}/g,
      (_,key) => String(values[key]));
    const started = Date.now();
    page.Function('report','cancelled', `return (async () => { ${code} })()`)(
      result => window.__onICloudReport(result), () => (page.__ireviveCancelAt || 0) > started)
      .catch(err => { document.title = 'Fixture failed: '+err.message; console.error(err); });
    return {ok:true};
  }},
  opener: {openUrl:async () => { throw new Error('External URLs disabled in fixture'); }},
  updater: {check:async () => null}, process: {relaunch:async () => {}},
  app: {getVersion:async () => '0.4.0-demo'},
};
