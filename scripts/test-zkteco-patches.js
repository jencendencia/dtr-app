/**
 * Standalone test for the ZTCP protocol patches applied in zktecoService.js.
 *
 * Simulates a ZKTeco device over an in-memory fake socket and verifies:
 *  1. requestData() resolves on a short CMD_ACK_OK reply (the "no data" case)
 *     instead of hanging until TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA.
 *  2. readWithBuffer() returns empty data for CMD_ACK_OK / zero-size PREPARE_DATA.
 *  3. readWithBuffer() rejects cleanly (no null.subarray crash / unhandled
 *     rejection) when the device never responds.
 *  4. A full chunked attendance download still decodes records correctly.
 *
 * Run: node scripts/test-zkteco-patches.js
 */
const assert = require('assert');

// Applying the service's module-level patches (decoder + ZTCP requestData/
// readWithBuffer) by simply requiring it.
require('../src/main/zktecoService');

const ZTCP = require('zkteco-js/src/ztcp');
const { createTCPHeader } = require('zkteco-js/src/helper/utils');
const { COMMANDS, REQUEST_DATA, MAX_CHUNK } = require('zkteco-js/src/helper/command');

/** Minimal in-memory socket with the event surface ztcp.js relies on. */
class FakeSocket {
  constructor(responder) {
    this.responder = responder || null; // (writtenBuffer, socket) => Buffer | null
    this.listeners = {};
    this.destroyed = false;
    this.writable = true;
    this.closed = false;
  }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
  once(ev, fn) {
    const wrap = (...a) => { this.removeListener(ev, wrap); fn(...a); };
    wrap.listener = fn;
    return this.on(ev, wrap);
  }
  removeListener(ev, fn) {
    this.listeners[ev] = (this.listeners[ev] || []).filter(f => f !== fn && f.listener !== fn);
    return this;
  }
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

function makeInstance(timeout, maxChunk) {
  const inst = new ZTCP('192.168.1.201', 4370, timeout, maxChunk);
  inst.sessionId = 42;
  return inst;
}

/** Build a 40-byte attendance record: user_id "5", 2026-07-21 08:30:00, punch 0. */
function buildRecord40() {
  const rec = Buffer.alloc(40);
  rec.writeUInt16LE(1, 0);            // sn
  rec.write('5', 2, 1, 'ascii');      // user_id
  const t = [26, 7, 21, 8, 30, 0];    // yy mm dd hh mm ss (year + 2000)
  t.forEach((b, i) => { rec[i + 12] = b; });
  rec[30] = 0;                        // punch: check-in
  rec[11] = 0;                        // state
  return rec;
}

/** Build a CMD_ACK_OK reply — a short 16-byte packet with no payload. */
function ackOkReply(inst) {
  return createTCPHeader(COMMANDS.CMD_ACK_OK, inst.sessionId, inst.replyId + 1, Buffer.alloc(0));
}

(async () => {
  let passed = 0;
  const ok = (name) => { passed++; console.log('  ✓', name); };

  // ── Test 1: requestData resolves on CMD_ACK_OK (no data) ──────────────
  console.log('Test 1: requestData resolves on short CMD_ACK_OK reply');
  {
    const inst = makeInstance(2000);
    inst.socket = new FakeSocket(() => ackOkReply(inst));
    const started = Date.now();
    const reply = await inst.requestData(Buffer.alloc(20));
    assert.strictEqual(reply.length, 16, 'reply should be the 16-byte ACK packet');
    assert(Date.now() - started < 1500, 'should resolve immediately, not after the 2s timeout');
    assert.strictEqual(reply.readUInt16LE(8), COMMANDS.CMD_ACK_OK, 'command id should be CMD_ACK_OK');
    ok('resolved with ACK_OK reply in ' + (Date.now() - started) + 'ms');
  }

  // ── Test 2: readWithBuffer returns empty data on ACK_OK ───────────────
  console.log('Test 2: readWithBuffer treats CMD_ACK_OK as "no data"');
  {
    const inst = makeInstance(2000);
    inst.socket = new FakeSocket(() => ackOkReply(inst));
    const out = await inst.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS);
    assert.ok(out.data instanceof Buffer, 'data should be a Buffer');
    assert.strictEqual(out.data.length, 0, 'empty attendance buffer => empty result');
    ok('returned empty buffer');
  }

  // ── Test 2b: readWithBuffer treats other ACK-class replies (e.g. ─────────
  // CMD_ACK_ERROR) as "no data" — some devices answer with ACK_ERROR instead
  // of ACK_OK when the buffer is empty.
  console.log('Test 2b: readWithBuffer treats CMD_ACK_ERROR as "no data"');
  {
    const inst = makeInstance(2000);
    inst.socket = new FakeSocket(() =>
      createTCPHeader(COMMANDS.CMD_ACK_ERROR, inst.sessionId, inst.replyId + 1, Buffer.alloc(0))
    );
    const out = await inst.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS);
    assert.ok(out.data instanceof Buffer, 'data should be a Buffer');
    assert.strictEqual(out.data.length, 0, 'ACK_ERROR => empty result');
    ok('returned empty buffer for CMD_ACK_ERROR reply');
  }

  // ── Test 3: readWithBuffer rejects cleanly when device never responds ──
  console.log('Test 3: readWithBuffer rejects without null.subarray() crash');
  {
    const inst = makeInstance(300); // short timeout for the test
    inst.socket = new FakeSocket(() => null); // no response ever
    let rejected = false;
    try {
      await inst.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS);
    } catch (err) {
      rejected = true;
      assert(err.message.includes('TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA'),
        'should reject with the request timeout error, got: ' + err.message);
    }
    assert(rejected, 'should have rejected');
    ok('rejected cleanly with TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA');
  }

  // ── Test 4: full chunked attendance download end-to-end ───────────────
  console.log('Test 4: chunked attendance download decodes records');
  {
    const inst = makeInstance(2000);
    const record40 = buildRecord40();
    // The device announces the size INCLUDING its 4-byte size prefix, and each
    // chunk reply wraps the data in an 8-byte real-data header (pyzk protocol).
    const announcedSize = 4 + record40.length; // 44
    inst.socket = new FakeSocket((buf) => {
      const reqCmd = buf.readUInt16LE(8); // command id of the client request
      if (reqCmd === COMMANDS.CMD_DATA_WRRQ) {
        // Requesting the buffer → CMD_PREPARE_DATA advertising total payload size
        const p = Buffer.alloc(5);
        p.writeUInt32LE(announcedSize, 1);
        return createTCPHeader(COMMANDS.CMD_PREPARE_DATA, inst.sessionId, inst.replyId + 1, p);
      }
      if (reqCmd === COMMANDS.CMD_DATA_RDY) {
        // Chunk request → CMD_PREPARE_DATA: [8-byte real header][4-byte size][records]
        const sizePrefix = Buffer.alloc(4);
        sizePrefix.writeUInt32LE(announcedSize, 0);
        const chunkPayload = Buffer.concat([Buffer.alloc(8), sizePrefix, record40]);
        return createTCPHeader(COMMANDS.CMD_PREPARE_DATA, inst.sessionId, inst.replyId + 1, chunkPayload);
      }
      // CMD_FREE_DATA and anything else → plain ACK
      return createTCPHeader(COMMANDS.CMD_ACK_OK, inst.sessionId, inst.replyId + 1, Buffer.alloc(0));
    });
    const out = await inst.getAttendances();
    assert.strictEqual(out.data.length, 1, 'one record expected');
    assert.strictEqual(out.data[0].user_id, '5');
    assert.strictEqual(out.data[0].type, 0, 'punch 0 = check-in');
    const dt = new Date(out.data[0].record_time);
    assert.strictEqual(dt.getFullYear(), 2026);
    assert.strictEqual(dt.getMonth(), 6);   // July
    assert.strictEqual(dt.getDate(), 21);
    assert.strictEqual(dt.getHours(), 8);
    assert.strictEqual(dt.getMinutes(), 30);
    ok('decoded 1 record: user_id=5, 2026-07-21 08:30, type=check-in');
  }

  // ── Test 5: service helper methods exist ──────────────────────────────
  console.log('Test 5: zktecoService loads with helpers');
  {
    const svc = require('../src/main/zktecoService');
    assert.strictEqual(typeof svc._downloadWithDisable, 'function');
    assert.strictEqual(typeof svc.getAttendanceLogs, 'function');
    assert.strictEqual(typeof svc.getUsers, 'function');
    ok('service exports _downloadWithDisable / getAttendanceLogs / getUsers');
  }

  console.log(`\nAll ${passed} tests passed ✓`);
})().catch((err) => {
  console.error('\nTEST FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
