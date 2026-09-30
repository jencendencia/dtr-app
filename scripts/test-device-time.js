/**
 * Standalone test for the hidden device utilities (Ctrl+Shift+I feature).
 *
 * Verifies against a simulated ZKTeco device (same FakeSocket harness as
 * test-zkteco-patches.js):
 *   1. getDeviceTime decodes the device's packed clock correctly
 *   2. setDeviceTime sends the correct packed clock (local wall-clock)
 *   3. both fail cleanly when not connected
 *   4. setDeviceTime rejects invalid dates
 *   5. isUserOnDevice finds an enrolled biometric ID
 *   6. isUserOnDevice reports false for an ID the device doesn't have
 *   7. isUserOnDevice returns "unknown" (null) when firmware refuses the list
 *   8. isUserOnDevice fails cleanly when not connected
 *
 * Run: node scripts/test-device-time.js
 */
const assert = require('assert');
require('../src/main/zktecoService');
const ZTCP = require('zkteco-js/src/ztcp');
const { createTCPHeader } = require('zkteco-js/src/helper/utils');
const { COMMANDS } = require('zkteco-js/src/helper/command');
const timeParser = require('zkteco-js/src/helper/time');

class FakeSocket {
  constructor(responder) {
    this.responder = responder || null;
    this.listeners = {};
    this.destroyed = false;
    this.writable = true;
    this.closed = false;
  }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
  once(ev, fn) { const wrap = (...a) => { this.removeListener(ev, wrap); fn(...a); }; wrap.listener = fn; return this.on(ev, wrap); }
  removeListener(ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter(f => f !== fn && f.listener !== fn); return this; }
  removeAllListeners(ev) { if (ev) this.listeners[ev] = []; else this.listeners = {}; return this; }
  emit(ev, ...args) { (this.listeners[ev] || []).slice().forEach(f => f(...args)); }
  write(buf, enc, cb) {
    if (typeof enc === 'function') { cb = enc; }
    const res = this.responder ? this.responder(buf, this) : null;
    if (cb) cb(null);
    if (res) setTimeout(() => this.emit('data', res), 5);
    return true;
  }
  destroy() { this.destroyed = true; this.emit('close'); }
  end(cb) { if (cb) cb(); this.emit('close'); }
}

let fakeDeviceClock = null; // packed seconds counter the "device" holds

function makeInstance() {
  const inst = new ZTCP('192.168.1.201', 4370, 3000, 5000);
  inst.sessionId = 42;
  return inst;
}

(async () => {
  let passed = 0;
  const ok = (name) => { passed++; console.log('  ✓', name); };
  const svc = require('../src/main/zktecoService');

  // ── Test 1: getDeviceTime decodes the device clock ──────────────────────
  console.log('Test 1: getDeviceTime decodes the device clock');
  {
    const inst = makeInstance();
    inst.socket = new FakeSocket((buf) => {
      const cmd = buf.readUInt16LE(8);
      if (cmd === COMMANDS.CMD_GET_TIME) {
        const payload = Buffer.alloc(4);
        payload.writeUInt32LE(fakeDeviceClock, 0);
        return createTCPHeader(COMMANDS.CMD_DATA, inst.sessionId, inst.replyId + 1, payload);
      }
      return createTCPHeader(COMMANDS.CMD_ACK_OK, inst.sessionId, inst.replyId + 1, Buffer.alloc(0));
    });
    svc.device = inst;
    svc.connected = true;
    svc.deviceInfo = { ip: '192.168.1.201', port: 4370 };

    const expected = new Date(2026, 8, 16, 14, 25, 30);
    fakeDeviceClock = timeParser.encode(expected);

    const res = await svc.getDeviceTime();
    assert.strictEqual(res.success, true, 'getDeviceTime should succeed');
    const got = new Date(res.time);
    assert.strictEqual(got.getFullYear(), 2026);
    assert.strictEqual(got.getMonth(), 8);
    assert.strictEqual(got.getDate(), 16);
    assert.strictEqual(got.getHours(), 14);
    assert.strictEqual(got.getMinutes(), 25);
    assert.strictEqual(got.getSeconds(), 30);
    ok(`decoded ${got.toString()}`);
  }

  // ── Test 2: setDeviceTime sends the correct packed clock ────────────────
  console.log('Test 2: setDeviceTime sends the correct packed clock');
  {
    const inst = makeInstance();
    inst.socket = new FakeSocket((buf) => {
      const cmd = buf.readUInt16LE(8);
      if (cmd === COMMANDS.CMD_SET_TIME) {
        fakeDeviceClock = buf.readUInt32LE(16); // payload starts after the 16-byte header
        return createTCPHeader(COMMANDS.CMD_ACK_OK, inst.sessionId, inst.replyId + 1, Buffer.alloc(0));
      }
      return createTCPHeader(COMMANDS.CMD_ACK_OK, inst.sessionId, inst.replyId + 1, Buffer.alloc(0));
    });
    svc.device = inst;
    svc.connected = true;
    svc.deviceInfo = { ip: '192.168.1.201', port: 4370 };

    const want = new Date(2026, 8, 16, 7, 5, 9);
    const res = await svc.setDeviceTime(want);
    assert.strictEqual(res.success, true, 'setDeviceTime should succeed: ' + res.message);

    const got = timeParser.decode(fakeDeviceClock);
    assert.strictEqual(got.getFullYear(), 2026);
    assert.strictEqual(got.getMonth(), 8);
    assert.strictEqual(got.getDate(), 16);
    assert.strictEqual(got.getHours(), 7);
    assert.strictEqual(got.getMinutes(), 5);
    assert.strictEqual(got.getSeconds(), 9);
    ok(`device clock now decodes to ${got.toString()}`);
  }

  // ── Test 3: both methods fail cleanly when not connected ────────────────
  console.log('Test 3: not-connected guards');
  {
    svc.connected = false;
    svc.device = null;
    const g = await svc.getDeviceTime();
    const s = await svc.setDeviceTime(new Date());
    assert.strictEqual(g.success, false);
    assert.strictEqual(s.success, false);
    ok('both return success:false with a message');
  }

  // ── Test 4: setDeviceTime rejects invalid dates ─────────────────────────
  console.log('Test 4: invalid date rejected');
  {
    svc.connected = true;
    const res = await svc.setDeviceTime(new Date('not-a-date'));
    assert.strictEqual(res.success, false);
    ok('invalid date returns success:false without touching the device');
  }

  // ── Fake 72-byte device user records for the enrollment-check tests ──
  const makeUserRecord = (uid, userId, name) => {
    const b = Buffer.alloc(72, 0);
    b.writeUIntLE(uid, 0, 2);
    b.write(String(userId).substring(0, 9), 48, 9, 'ascii');
    b.write(String(name).substring(0, 20), 11, 'ascii');
    return b;
  };
  const userListResponder = (users) => (buf, sock) => {
    const cmd = buf.readUInt16LE(8);
    if (cmd === COMMANDS.CMD_DATA_WRRQ) {
      const body = Buffer.concat([Buffer.alloc(4), ...users.map(u => makeUserRecord(u.uid, u.userId, u.name))]);
      body.writeUInt32LE(users.length * 72, 0);
      return createTCPHeader(COMMANDS.CMD_DATA, sock.sessionId || 42, 1, body);
    }
    return createTCPHeader(COMMANDS.CMD_ACK_OK, 42, 1, Buffer.alloc(0));
  };

  // ── Test 5: isUserOnDevice finds an enrolled ID ──────────────────────────
  console.log('Test 5: isUserOnDevice finds an enrolled ID');
  {
    const inst = makeInstance();
    inst.socket = new FakeSocket(userListResponder([
      { uid: 1, userId: '107', name: 'Juan Dela Cruz' },
      { uid: 2, userId: '108', name: 'Maria Santos' }
    ]));
    svc.device = inst;
    svc.connected = true;
    svc.deviceInfo = { ip: '192.168.1.201', port: 4370 };

    const res = await svc.isUserOnDevice('107');
    assert.strictEqual(res.success, true, 'check should succeed: ' + res.message);
    assert.strictEqual(res.onDevice, true, 'ID 107 is on the device');
    assert.strictEqual(res.deviceUsers, 2);
    ok('ID 107 -> onDevice=true among 2 device user(s)');
  }

  // ── Test 6: isUserOnDevice reports false for a missing ID ────────────────
  console.log('Test 6: isUserOnDevice reports false for a missing ID');
  {
    const inst = makeInstance();
    inst.socket = new FakeSocket(userListResponder([
      { uid: 1, userId: '107', name: 'Juan Dela Cruz' }
    ]));
    svc.device = inst;
    svc.connected = true;
    svc.deviceInfo = { ip: '192.168.1.201', port: 4370 };

    const res = await svc.isUserOnDevice('999');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.onDevice, false, 'ID 999 is not on the device');
    ok('ID 999 -> onDevice=false');
  }

  // ── Test 7: firmware refusing the user list reads as "unknown" ──────────
  console.log('Test 7: refused user list reads as unknown (null)');
  {
    const inst = makeInstance();
    inst.socket = new FakeSocket((buf, sock) => {
      const cmd = buf.readUInt16LE(8);
      if (cmd === COMMANDS.CMD_DATA_WRRQ) {
        return createTCPHeader(COMMANDS.CMD_ACK_ERROR, 42, 1, Buffer.alloc(0));
      }
      return createTCPHeader(COMMANDS.CMD_ACK_OK, 42, 1, Buffer.alloc(0));
    });
    svc.device = inst;
    svc.connected = true;
    svc.deviceInfo = { ip: '192.168.1.201', port: 4370 };

    const res = await svc.isUserOnDevice('107');
    assert.strictEqual(res.success, true, 'not an error: ' + res.message);
    assert.strictEqual(res.onDevice, null, 'must be unknown, never a false "not enrolled"');
    ok('device refused the list -> onDevice=null (unknown)');
  }

  // ── Test 8: isUserOnDevice fails cleanly when not connected ─────────────
  console.log('Test 8: enrollment check not-connected guard');
  {
    svc.connected = false;
    svc.device = null;
    const res = await svc.isUserOnDevice('107');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.onDevice, null);
    ok('not connected -> success:false, onDevice=null');
  }

  console.log(`\n${passed}/8 test groups passed`);
  process.exit(passed === 8 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
