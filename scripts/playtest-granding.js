/**
 * Playtest harness: loads the REAL main.js with a stubbed electron module and
 * a sandboxed copy of the app database. Handles are invoked the way the UI
 * would invoke them. Read-only toward the real DB and the real device.
 *
 * Run: node scripts/playtest-granding.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const REAL_DB = 'C:/Users/Admin/AppData/Roaming/biometric-dtr-app/biometric_dtr.db';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dtr-playtest-'));
const DB_PATH = path.join(USER_DATA, 'biometric_dtr.db');

// Fresh sandbox DB (empty teachers/logs — same state the real app is in)
fs.copyFileSync(REAL_DB, DB_PATH);
console.log('Sandbox DB:', DB_PATH);

// ── Electron stub ───────────────────────────────────────────────
const handlers = {};
const fakeWin = { webContents: { send: () => {} } };
const electron = {
  app: {
    getPath: (p) => (p === 'userData' ? USER_DATA : USER_DATA),
    getVersion: () => '1.3.5',
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {}
  },
  BrowserWindow: class {
    constructor() {}
    loadFile() {}
    maximize() {}
    on() {}
    webContents = { send: () => {}, print: () => {} };
    static getAllWindows() { return []; }
    static getFocusedWindow() { return null; }
  },
  ipcMain: {
    handle: (name, fn) => { handlers[name] = fn; },
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openExternal: () => {} },
  Menu: { setApplicationMenu: () => {} },
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: () => {},
    checkForUpdates: () => {},
    downloadUpdate: () => {},
    quitAndInstall: () => {}
  }
};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return 'electron-stub';
  if (request === 'better-sqlite3') return 'better-sqlite3-stub';
  return origResolve.call(this, request, ...args);
};
// better-sqlite3 shim over node:sqlite (the real module is compiled for
// Electron's ABI; the SQL executed is identical).
const { DatabaseSync } = require('node:sqlite');
class ShimStmt {
  constructor(s) { this.s = s; }
  run(...a) {
    try { const r = this.s.run(...a); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; }
    catch (e) {
      // Emulate better-sqlite3's error.code for constraint violations so the
      // app's friendly-message paths behave identically.
      if (e.errcode === 2067 || e.errcode === 19) e.code = 'SQLITE_CONSTRAINT_UNIQUE';
      throw e;
    }
  }
  get(...a) { return this.s.get(...a); }
  all(...a) { return this.s.all(...a); }
}
class ShimDB {
  constructor(p) { this.d = new DatabaseSync(p); }
  prepare(sql) { return new ShimStmt(this.d.prepare(sql)); }
  exec(sql) { this.d.exec(sql); }
  pragma(s) { this.d.exec('PRAGMA ' + s); return {}; }
  transaction(fn) {
    return (...args) => {
      this.d.exec('BEGIN');
      try { const r = fn(...args); this.d.exec('COMMIT'); return r; }
      catch (e) { try { this.d.exec('ROLLBACK'); } catch (_) {} throw e; }
    };
  }
  close() { this.d.close(); }
}
require.cache['electron-stub'] = { id: 'electron-stub', filename: 'electron-stub', loaded: true, exports: electron };
require.cache['better-sqlite3-stub'] = { id: 'better-sqlite3-stub', filename: 'better-sqlite3-stub', loaded: true, exports: ShimDB };

require('../src/main/main.js');

// ── Test driver ─────────────────────────────────────────────────
const results = [];
async function test(name, fn) {
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', `${name} :: ${err.message}`]);
    console.log('  ✗', err.message);
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  // ── A. Error paths (careless-user flows) ──────────────────────
  await test('sync while not connected fails gracefully', async () => {
    await handlers['disconnect-device']();
    const r = await handlers['sync-device-attendance']({}, {});
    expect(r && r.success === false && r.message, 'expected graceful failure, got ' + JSON.stringify(r));
  });

  await test('enroll while not connected fails gracefully', async () => {
    const r = await handlers['enroll-teacher-to-device'](null, 1);
    expect(r && r.success === false, 'expected graceful failure');
  });

  await test('connect to dead IP fails with message (no crash)', async () => {
    const r = await handlers['connect-device']({}, '192.168.2.250', 4370, 'zkteco');
    expect(r && r.success === false && r.message, 'expected connect failure with message');
  }, );

  await test('connect with wrong protocol type still answers', async () => {
    // Granding selected but pointed at... itself: should succeed (granding path)
    const r = await handlers['connect-device']({}, '192.168.2.38', 4370, 'granding');
    expect(r && r.success === true, 'granding connect failed: ' + (r && r.message));
    await handlers['disconnect-device']();
  });

  // ── B. Real device flow on the sandbox DB (empty teachers/logs) ──
  await test('add-device registers Granding (duplicate-safe)', async () => {
    const r1 = await handlers['add-device']({}, { name: 'Granding FA210', serial_number: '3324202160161', ip_address: '192.168.2.38', port: 4370, device_type: 'granding' });
    expect(r1.success === true || /already exists/.test(r1.message), 'add failed: ' + r1.message);
    const devices = await handlers['get-devices']();
    const g = devices.find(d => d.device_type === 'granding');
    expect(g, 'no granding device row');
  });

  await test('FULL SYNC on empty sandbox DB: roster + logs + last_sync', async () => {
    const conn = await handlers['connect-device']({}, '192.168.2.38', 4370, 'granding');
    expect(conn.success, 'connect failed: ' + conn.message);
    const devices = await handlers['get-devices']();
    const granding = devices.find(d => d.device_type === 'granding');
    const gateBefore = (devices.find(d => d.device_type === 'zkteco') || {}).last_sync;
    const r = await handlers['sync-device-attendance']({}, { deviceId: granding.id });
    expect(r.success, 'sync failed: ' + r.message);
    console.log('  ↳', r.message.substring(0, 160));
    expect(r.synced > 5000, 'expected thousands of inserts, got ' + r.synced);
    // 63 punchers auto-create from logs; the remaining roster users import as
    // teachers afterwards (162 roster - 63 punchers = 99).
    expect(r.importedUsers === 99, 'expected 99 roster-only imports, got ' + r.importedUsers);
    const { db } = require('../src/db/connection');
    const teachers = db.prepare('SELECT COUNT(*) c FROM Teachers').get().c;
    const logs = db.prepare('SELECT COUNT(*) c FROM AttendanceLogs').get().c;
    console.log(`  ↳ DB now: ${teachers} teachers, ${logs} logs`);
    expect(teachers === 162, `expected full 162-user roster as teachers, got ${teachers}`);
    expect(logs === 6898, `expected 6898 logs, got ${logs}`);
    // Spot check: bio 1 (ADRALES,CORAZON) must have exactly her 32 punches
    const spot = db.prepare("SELECT t.name, (SELECT COUNT(*) FROM AttendanceLogs a WHERE a.teacher_id = t.id) c FROM Teachers t WHERE t.biometric_id = 1").get();
    expect(spot && spot.c === 32, 'bio 1 spot check: ' + JSON.stringify(spot));
    const garbage = db.prepare("SELECT COUNT(*) c FROM Teachers WHERE name = '' OR name LIKE '%;%/%' ").get().c;
    expect(garbage === 0, `${garbage} garbage-named teachers imported`);
    const synced = db.prepare("SELECT last_sync FROM BiometricDevices WHERE device_type='granding'").get();
    expect(synced && synced.last_sync, 'last_sync not stamped');
    const devicesAfter = await handlers['get-devices']();
    const gateAfter = (devicesAfter.find(d => d.device_type === 'zkteco') || {}).last_sync;
    expect(gateAfter === gateBefore, `Gate last_sync changed (${gateBefore} → ${gateAfter}) — per-device stamping broken`);
  });

  await test('repeat sync is idempotent (all duplicates)', async () => {
    const devices = await handlers['get-devices']();
    const granding = devices.find(d => d.device_type === 'granding');
    const r = await handlers['sync-device-attendance']({}, { deviceId: granding.id });
    expect(r.success, 'sync failed');
    expect(r.synced === 0, 'second sync inserted ' + r.synced + ' new records (expected 0)');
    console.log('  ↳', r.message);
  });

  await test('View Users modal data path returns clean roster', async () => {
    const r = await handlers['get-device-users']();
    expect(r.success, 'getUsers failed: ' + r.message);
    const bad = (r.data || []).filter(u => u.name && /[^A-Za-z0-9 .,'()\/-]/.test(u.name));
    expect(bad.length === 0, `${bad.length} garbage names in roster: ` + JSON.stringify(bad.slice(0, 2)));
    console.log(`  ↳ roster: ${(r.data || []).length} users, ${bad.length} garbage`);
  });

  await test('device status reports connected device info', async () => {
    const s = await handlers['get-device-status']();
    expect(s.connected === true && s.deviceName === 'FA210', 'status: ' + JSON.stringify(s).substring(0, 120));
    await handlers['disconnect-device']();
  });

  // ── Summary ───────────────────────────────────────────────────
  console.log('\n════════ PLAYTEST RESULTS ════════');
  for (const [status, name] of results) console.log(`${status === 'PASS' ? '✅' : '❌'} ${name}`);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error('HARNESS FATAL:', err);
  process.exit(1);
});
