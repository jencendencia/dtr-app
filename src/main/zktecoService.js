// IMPORTANT: patch the library's 40-byte attendance decoder BEFORE the
// Zkteco class is loaded. ztcp.js destructures decodeRecordData40 at require
// time, so this must run first for the patch to take effect. The library's
// built-in decoder reads the timestamp from the wrong offset on many
// standalone devices (producing garbage years like 2046/2066).
const zktecoUtils = require('zkteco-js/src/helper/utils');

/**
 * Decode a 6-byte device timestamp (yy mm dd hh mm ss, year + 2000).
 * Most devices store raw byte values; some store BCD — try both and pick
 * whichever produces a valid date.
 */
function decodeDeviceTime(buf) {
  const raw = {
    year: buf[0] + 2000,
    month: buf[1],
    day: buf[2],
    hour: buf[3],
    minute: buf[4],
    second: buf[5]
  };
  if (isValidDateTime(raw)) return raw;

  const bcdVal = b => ((b >> 4) & 0x0f) * 10 + (b & 0x0f);
  const bcd = {
    year: 2000 + bcdVal(buf[0]),
    month: bcdVal(buf[1]),
    day: bcdVal(buf[2]),
    hour: bcdVal(buf[3]),
    minute: bcdVal(buf[4]),
    second: bcdVal(buf[5])
  };
  return isValidDateTime(bcd) ? bcd : raw;
}

function isValidDateTime(t) {
  return t.year >= 2000 && t.year <= 2035 &&
    t.month >= 1 && t.month <= 12 && t.day >= 1 && t.day <= 31 &&
    t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59 &&
    t.second >= 0 && t.second <= 59;
}

/**
 * Decode a 4-byte ZKTeco "packed" datetime (the pyzk standard). The integer
 * encodes seconds/minutes/hours/days/months/years in a mixed-radix format:
 *   second = t % 60, minute = (t/60) % 60, hour = (t/3600) % 24,
 *   day = (t/86400) % 31 + 1, month = (t/86400/31) % 12,
 *   year = t/86400/31/12 + 2000
 */
function parseTimeToDate(time) {
  const second = time % 60;
  time = (time - second) / 60;
  const minute = time % 60;
  time = (time - minute) / 60;
  const hour = time % 24;
  time = (time - hour) / 24;
  const day = time % 31 + 1;
  time = (time - (day - 1)) / 31;
  const month = time % 12;
  time = (time - month) / 12;
  const year = time + 2000;
  return { year, month: month + 1, day, hour, minute, second };
}

/**
 * Return the punch/check field (0 = check-in, 1 = check-out) from a 40-byte
 * record. Different firmware stores it at different offsets; use the first
 * clean 0/1 found, otherwise return 2 (unknown) so the caller falls back to
 * time-of-day classification.
 */
function decodePunch(buf) {
  for (const off of [26, 31]) {
    const v = buf[off];
    if (v === 0 || v === 1) return v;
  }
  return 2;
}

/**
 * Decode a 40-byte ZKTeco attendance record using the standard layout
 * (same as the reference pyzk implementation):
 *
 *   offset 0-1   serial number (2 bytes)
 *   offset 2-10  user id / name (9 bytes ASCII)  <- many devices store the NAME
 *   offset 11    status (1 byte)
 *   offset 12-17 timestamp (6 bytes: yy mm dd hh mm ss, year + 2000)
 *   offset 25    uid (1 byte)
 *   offset 30    punch (0 = check-in, 1 = check-out)
 *
 * The bundled zkteco-js library reads the timestamp at offset 27 instead of
 * 12, which yields garbage dates (e.g. 2046/2066) on standalone devices.
 */
function decodeRecord40(buf) {
  let time = null;

  // Layout A: 6-byte date at offset 12-17 (yy mm dd hh mm ss, year + 2000).
  const timeBytesA = buf.subarray(12, 18);
  if (!timeBytesA.every(b => b === 0)) {
    const t = decodeDeviceTime(timeBytesA);
    if (isValidDateTime(t)) time = t;
  }

  // Layout B: 4-byte packed datetime at offset 27-30 (pyzk standard). This is
  // what the ZK3969 firmware uses — the 6-byte layout above is all zeros.
  if (!time) {
    const packed = buf.readUInt32LE(27);
    if (packed > 0) {
      const t = parseTimeToDate(packed);
      if (isValidDateTime(t)) time = t;
    }
  }

  // Layout C: 4-byte packed datetime at offset 12-15 (pyzk BioMetric offset).
  if (!time) {
    const packed = buf.readUInt32LE(12);
    if (packed > 0) {
      const t = parseTimeToDate(packed);
      if (isValidDateTime(t)) time = t;
    }
  }

  const date = time
    ? new Date(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
    : null;
  return {
    sn: buf.readUIntLE(0, 2),
    user_id: buf.slice(2, 11).toString('ascii').split('\0')[0],
    record_time: date ? date.toString() : '',
    type: decodePunch(buf),  // punch: 0 = check-in, 1 = check-out
    state: buf[11]           // status
  };
}

// Apply the corrected decoder to the library's module. ztcp.js already
// destructured it, but at this point in the file the library is not loaded
// yet — patching now means the class below uses our decoder.
zktecoUtils.decodeRecordData40 = decodeRecord40;

// ─── ZTCP protocol patches ────────────────────────────────────────────────
// The bundled zkteco-js has two bugs that make attendance syncing fail with
// "TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA":
//
// 1. requestData() only resolves a response when its declared packet length
//    is > 8 bytes. When the device has no data to send (e.g. an empty
//    attendance buffer) it answers CMD_DATA_WRRQ with a short 16-byte
//    CMD_ACK_OK packet, which the stock code ignores — so the request hangs
//    until the timeout fires even though the device replied fine.
//
// 2. readWithBuffer() calls reject() on failure but keeps executing, then
//    crashes on `reply.subarray(0, 16)` with reply === null, producing an
//    unhandled promise rejection.
const { COMMANDS, MAX_CHUNK } = require('zkteco-js/src/helper/command');
const ZTCP = require('zkteco-js/src/ztcp');
const {
  checkNotEventTCP,
  decodeTCPHeader,
  createTCPHeader,
  exportErrorMessage
} = zktecoUtils;

/**
 * Patched ZTCP.requestData — resolves immediately on ACK-class replies
 * (CMD_ACK_OK / CMD_ACK_ERROR / ...), which are complete answers even though
 * their packet length is only 8 bytes. CMD_DATA responses still get a 1s
 * grace period for more chunks; everything else keeps the stock behavior.
 */
ZTCP.prototype.requestData = function (msg) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let replyBuffer = Buffer.from([]);

    const internalCallback = (data) => {
      if (this.socket) this.socket.removeListener('data', handleOnData);
      if (timer) clearTimeout(timer);
      resolve(data);
    };

    const handleOnData = (data) => {
      replyBuffer = Buffer.concat([replyBuffer, data]);
      if (checkNotEventTCP(data)) return;
      // Wait for a full 16-byte header before decoding it (guards against
      // partial TCP segments crashing decodeTCPHeader).
      if (replyBuffer.length < 16) return;

      const header = decodeTCPHeader(replyBuffer.subarray(0, 16));

      if (header.commandId === COMMANDS.CMD_DATA) {
        // More data may follow — give the device a short grace period.
        timer = setTimeout(() => internalCallback(replyBuffer), 1000);
      } else {
        const packetLength = data.readUIntLE(4, 2);
        // Complete replies: any packet with a payload, any ACK-class reply
        // (e.g. CMD_ACK_OK "no data"), and CMD_PREPARE_DATA (even a size-0
        // one, which readWithBuffer resolves as empty).
        const isAck = header.commandId >= COMMANDS.CMD_ACK_OK; // 2000+
        if (packetLength > 8 || isAck || header.commandId === COMMANDS.CMD_PREPARE_DATA) {
          internalCallback(replyBuffer);
        } else {
          timer = setTimeout(() => {
            if (this.socket) this.socket.removeListener('data', handleOnData);
            reject(new Error('TIMEOUT_ON_RECEIVING_REQUEST_DATA'));
          }, this.timeout);
        }
      }
    };

    if (this.socket) {
      this.socket.on('data', handleOnData);
      this.socket.write(msg, null, (err) => {
        if (err) {
          if (this.socket) this.socket.removeListener('data', handleOnData);
          return reject(err);
        }
        timer = setTimeout(() => {
          if (this.socket) this.socket.removeListener('data', handleOnData);
          reject(new Error('TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA'));
        }, this.timeout);
      });
    } else {
      reject(new Error('SOCKET_NOT_INITIALIZED'));
    }
  });
};

/**
 * Patched ZTCP.readWithBuffer:
 *  - returns early after a failed request (fixes the null.subarray() crash),
 *  - treats CMD_ACK_OK / zero-size CMD_PREPARE_DATA as "no data" and resolves
 *    with an empty buffer instead of stalling on the chunk download.
 */
ZTCP.prototype.readWithBuffer = function (reqData, cb = null) {
  return new Promise(async (resolve, reject) => {
    this.replyId++;
    const buf = createTCPHeader(COMMANDS.CMD_DATA_WRRQ, this.sessionId, this.replyId, reqData);
    let reply = null;

    try {
      reply = await this.requestData(buf);
    } catch (err) {
      reject(err);
      return; // stock code forgot this return and crashed on null.subarray()
    }

    const header = decodeTCPHeader(reply.subarray(0, 16));
    // Remember what the device actually answered with, so callers can tell a
    // genuine "nothing to send" (CMD_ACK_OK / size-0 CMD_PREPARE_DATA) apart
    // from a rejected/unsupported request (e.g. CMD_ACK_ERROR on devices whose
    // firmware won't stream a particular data type over TCP).
    this.lastReply = header.commandId;
    switch (header.commandId) {
      case COMMANDS.CMD_DATA: {
        resolve({ data: reply.subarray(16), mode: 8 });
        break;
      }
      case COMMANDS.CMD_ACK_OK:
      case COMMANDS.CMD_PREPARE_DATA: {
        // CMD_ACK_OK = "nothing to send"; PREPARE_DATA with size 0 = same.
        const recvData = reply.subarray(16);
        const size = recvData.length >= 5 ? recvData.readUIntLE(1, 4) : 0;
        if (header.commandId === COMMANDS.CMD_ACK_OK || size === 0) {
          resolve({ data: Buffer.from([]) });
          break;
        }

        const maxChunk = this.maxChunk || MAX_CHUNK;
        const remain = size % maxChunk;
        const numberChunks = Math.round((size - remain) / maxChunk);
        let totalPackets = numberChunks + (remain > 0 ? 1 : 0);
        let replyData = Buffer.from([]);
        let totalBuffer = Buffer.from([]);
        let realTotalBuffer = Buffer.from([]);

        const timeout = this.timeout || 10000;
        let timer = setTimeout(() => {
          internalCallback(replyData, new Error('TIMEOUT WHEN RECEIVING PACKET'));
        }, timeout);

        const internalCallback = (replyData, err = null) => {
          if (timer) clearTimeout(timer);
          resolve({ data: replyData, err });
        };

        const handleOnData = (reply) => {
          if (checkNotEventTCP(reply)) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            internalCallback(replyData, new Error(`TIME OUT !! ${totalPackets} PACKETS REMAIN !`));
          }, timeout);

          totalBuffer = Buffer.concat([totalBuffer, reply]);
          const packetLength = totalBuffer.readUIntLE(4, 2);
          if (totalBuffer.length >= 8 + packetLength) {
            realTotalBuffer = Buffer.concat([realTotalBuffer, totalBuffer.subarray(16, 8 + packetLength)]);
            totalBuffer = totalBuffer.subarray(8 + packetLength);

            if ((totalPackets > 1 && realTotalBuffer.length === maxChunk + 8)
              || (totalPackets === 1 && realTotalBuffer.length === remain + 8)) {
              replyData = Buffer.concat([replyData, realTotalBuffer.subarray(8)]);
              totalBuffer = Buffer.from([]);
              realTotalBuffer = Buffer.from([]);

              totalPackets -= 1;
              if (cb) cb(replyData.length, size);

              if (totalPackets <= 0) {
                internalCallback(replyData);
              } else {
                requestNextChunk();
              }
            }
          }
        };

        // Request one chunk at a time so slow/high-latency links keep up.
        let nextChunk = 0;
        const requestNextChunk = () => {
          if (nextChunk > numberChunks) return;
          if (nextChunk === numberChunks) {
            this.sendChunkRequest(numberChunks * maxChunk, remain);
          } else {
            this.sendChunkRequest(nextChunk * maxChunk, maxChunk);
          }
          nextChunk++;
        };

        if (this.socket) {
          this.socket.once('close', () => {
            internalCallback(replyData, new Error('Socket is disconnected unexpectedly'));
          });
          this.socket.on('data', handleOnData);
        }

        requestNextChunk();
        break;
      }
      default: {
        // This device (ZK3969 firmware) answers a data request with other
        // ACK-class replies (e.g. CMD_ACK_ERROR 2001) when there is nothing to
        // send — treat every ACK-class reply as "no data". Only genuinely
        // unknown non-ACK commands are an error.
        if (header.commandId >= COMMANDS.CMD_ACK_OK) {
          console.warn(`[ZktecoService] Device answered data request with command ${header.commandId} (${exportErrorMessage(header.commandId)}) — treating as no data`);
          resolve({ data: Buffer.from([]) });
        } else {
          reject(new Error('ERROR_IN_UNHANDLE_CMD ' + header.commandId + ' ' + exportErrorMessage(header.commandId)));
        }
      }
    }
  });
};

const Zkteco = require('zkteco-js');

class ZktecoService {
  constructor() {
    this.device = null;
    this.connected = false;
    this.deviceInfo = null;
  }

  /**
   * Connect to a ZKTeco device via TCP/IP.
   * @param {string} ip - Device IP address
   * @param {number} port - Device port (default 4370)
   * @param {number} timeout - Connection timeout in ms (default 5000; command
   *   transfers get a floor of 10s so slow devices/large downloads don't stall)
   * @returns {{success: boolean, info?: object, message?: string}}
   */
  async connect(ip, port = 4370, timeout = 5000) {
    try {
      // Disconnect any existing connection first
      if (this.device) {
        try { await this.device.disconnect(); } catch (_) {}
        this.device = null;
        this.connected = false;
      }

      // Command timeout: be generous (min 10s) so slow devices or large
      // attendance downloads don't stall mid-transfer. 4th arg is the UDP
      // bind port used only when the library falls back to UDP.
      const commandTimeout = Math.max(10000, timeout);
      this.device = new Zkteco(ip, port, commandTimeout, 5000);
      await this.device.createSocket();
      this.connected = true;

      // Get device info
      const info = await this.device.getInfo();
      this.deviceInfo = {
        ip,
        port,
        userCount: info.userCounts || 0,
        attendanceCount: info.logCounts || 0,
        attendanceCapacity: info.logCapacity || 0
      };

      // Best-effort: re-enable a device left disabled by an interrupted
      // download/crash so fingerprint reads keep working.
      try { await this.device.enableDevice(); } catch (_) {}

      // Try to get device name/version
      try {
        this.deviceInfo.deviceName = await this.device.getDeviceName();
      } catch (_) {}
      try {
        this.deviceInfo.version = await this.device.getDeviceVersion();
      } catch (_) {}

      console.log(`[ZktecoService] Connected to device at ${ip}:${port}`, this.deviceInfo);
      return { success: true, info: this.deviceInfo };
    } catch (err) {
      console.error('[ZktecoService] Connection error:', err);
      this.connected = false;
      this.device = null;
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }

  /**
   * Disconnect from the current device.
   */
  async disconnect() {
    try {
      if (this.device) {
        await this.device.disconnect();
      }
    } catch (_) {}
    this.device = null;
    this.connected = false;
    this.deviceInfo = null;
    console.log('[ZktecoService] Disconnected');
  }

  /**
   * Check if currently connected to a device.
   * Also verifies the underlying TCP socket is alive.
   */
  isConnected() {
    if (!this.connected || !this.device) return false;
    // Verify the TCP socket is actually alive
    try {
      const socket = this.device.ztcp?.socket;
      if (socket && (socket.destroyed || !socket.writable)) {
        this.connected = false;
        return false;
      }
    } catch (_) {}
    return true;
  }

  /**
   * Check if the underlying TCP socket is actually alive and writable.
   */
  isSocketAlive() {
    try {
      if (!this.device || !this.device.ztcp || !this.device.ztcp.socket) return false;
      const socket = this.device.ztcp.socket;
      return !socket.destroyed && socket.writable && !socket.closed;
    } catch (_) {
      return false;
    }
  }

  /**
   * Get device info (must be connected).
   */
  getDeviceInfo() {
    return this.deviceInfo;
  }

  /**
   * Run a device operation, and if it fails because of a dead/stale TCP
   * connection (write/read timeouts, socket errors), reconnect to the device
   * and retry once. ZKTeco devices silently drop TCP sessions (e.g. after
   * idle time or a second concurrent connection), which makes every command
   * hang with TIMEOUT_* even though the socket still looks "connected".
   */
  async _withRetry(commandLabel, fn) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(
        (err && err.err && err.err.message) ||
        (err && err.message) ||
        err || ''
      );
      const looksDead = /TIMEOUT|ECONNRESET|EPIPE|destroyed|SOCKET|socket|not connected|connect/i.test(msg);
      if (!looksDead || !this.deviceInfo) throw err;

      console.warn(`[ZktecoService] ${commandLabel} failed (${msg}). Reconnecting and retrying once...`);
      const { ip, port } = this.deviceInfo;
      // Fast teardown: the connection is already dead, so skip the graceful
      // CMD_EXIT (which can hang ~10s on a dead socket) and force-close.
      try {
        const ztcp = this.device && this.device.ztcp;
        if (ztcp && ztcp.socket) ztcp.socket.destroy();
      } catch (_) {}
      this.device = null;
      this.connected = false;
      this.deviceInfo = null;
      const re = await this.connect(ip, port);
      if (!re.success) {
        throw new Error(`Device reconnection failed: ${re.message}`);
      }
      return await fn();
    }
  }

  /**
   * Run a device data download using the standard ZKTeco sequence: temporarily
   * disable the device so it answers the CMD_DATA_WRRQ data request (pyzk does
   * the same), then re-enable it when done — even on failure. If the socket is
   * dead the retry layer reconnects anyway, so skip the (pointless, slow)
   * enable attempt.
   */
  async _downloadWithDisable(fn) {
    if (!this.isSocketAlive()) {
      return await fn();
    }
    await this.device.disableDevice();
    try {
      return await fn();
    } finally {
      if (this.isSocketAlive()) {
        try {
          await this.device.enableDevice();
        } catch (err) {
          console.warn('[ZktecoService] Failed to re-enable device:', err.message);
        }
      }
    }
  }

  /**
   * Classify the outcome of a data download based on what the device replied.
   * - 'ok'       — data was actually returned (CMD_DATA or a prepared buffer).
   * - 'empty'    — device answered CMD_ACK_OK / size-0 CMD_PREPARE_DATA: genuinely
   *                nothing to send.
   * - 'rejected' — device answered with another ACK-class reply (e.g. CMD_ACK_ERROR
   *                2001): the request was refused/unsupported. Some firmware
   *                reports item counts in getInfo() but won't stream that data
   *                type over TCP.
   */
  _classifyDownloadStatus(dataLength, lastReply) {
    if (dataLength > 0) return 'ok';
    if (lastReply === COMMANDS.CMD_ACK_OK || lastReply === COMMANDS.CMD_PREPARE_DATA || lastReply === COMMANDS.CMD_DATA) {
      return 'empty';
    }
    if (lastReply != null) return 'rejected';
    return 'empty';
  }

  /**
   * Retrieve all attendance logs from the device.
   *
   * Uses the library's own getAttendances() download routine (which is proven
   * to work with these devices) combined with the corrected decodeRecordData40
   * decoder patched in at load time.
   * @returns {{success: boolean, data?: Array, message?: string, status?: string}}
   */
  async getAttendanceLogs() {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      const rawLogs = await this._withRetry('Get attendance', async () => {
        const response = await this._downloadWithDisable(() => this.device.getAttendances());
        return response.data || [];
      });
      const lastReply = this.device && this.device.ztcp ? this.device.ztcp.lastReply : null;
      const status = this._classifyDownloadStatus(rawLogs.length, lastReply);
      console.log(`[ZktecoService] Retrieved ${rawLogs.length} raw attendance log(s) (device reply: ${lastReply})`);
      // Sanity check: the device reports pending logs but the download came
      // back empty — that usually means the device rejected the data request,
      // not that there's genuinely nothing to sync.
      if (rawLogs.length === 0 && this.deviceInfo && this.deviceInfo.attendanceCount > 0) {
        if (status === 'rejected') {
          console.warn(`[ZktecoService] Device reports ${this.deviceInfo.attendanceCount} attendance log(s) but answered the download request with command ${lastReply} (${exportErrorMessage(lastReply)}) — the device refused the request.`);
        } else {
          console.warn(`[ZktecoService] Device reports ${this.deviceInfo.attendanceCount} attendance log(s) but download returned 0 — the device may be rejecting the attendance data request.`);
        }
      }
      if (rawLogs.length > 0) {
        console.log(`[ZktecoService] Sample raw record:`, JSON.stringify(rawLogs[0]));
      }

// Normalize logs into our format
      const records = [];
      for (const log of rawLogs) {
        // zkteco-js decodeRecordData40 returns:
        // { sn, user_id, record_time, type, state }
        // record_time is a Date.toString() string
        let logTime = '';

        if (log.record_time) {
          // record_time is a Date.toString() like "Mon Jul 21 2026 08:30:00 GMT+0800 (Philippine Standard Time)"
          // We need to preserve the LOCAL time, not convert to UTC
          const parsed = new Date(log.record_time);
          if (!isNaN(parsed.getTime())) {
            // Use local time components to avoid timezone conversion
            const year = parsed.getFullYear();
            const month = String(parsed.getMonth() + 1).padStart(2, '0');
            const day = String(parsed.getDate()).padStart(2, '0');
            const hours = String(parsed.getHours()).padStart(2, '0');
            const minutes = String(parsed.getMinutes()).padStart(2, '0');
            const seconds = String(parsed.getSeconds()).padStart(2, '0');
            logTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          } else {
            // Try parsing as-is
            logTime = String(log.record_time);
          }
        }

        if (!logTime) continue;

        records.push({
          employeeId: String(log.user_id || '').trim(),
          logTime: logTime,
          logType: '', // filled in by the alternating classifier below
          state: log.state
        });
      }

      // This device records raw punches (no manual check-in/check-out), so the
      // punch byte is unreliable. Classify each employee's punches per day by
      // ALTERNATING in/out in chronological order (1st = Check-in, 2nd =
      // Check-out, 3rd = Check-in, 4th = Check-out, ...). This fills the DTR's
      // AM In / AM Out / PM In / PM Out slots correctly even when the device
      // doesn't distinguish between in and out punches.
      const byEmpDay = {};
      for (const r of records) {
        const key = `${r.employeeId}|${r.logTime.substring(0, 10)}`;
        if (!byEmpDay[key]) byEmpDay[key] = [];
        byEmpDay[key].push(r);
      }
      for (const key of Object.keys(byEmpDay)) {
        const dayRecords = byEmpDay[key].sort((a, b) => a.logTime.localeCompare(b.logTime));
        dayRecords.forEach((r, idx) => {
          r.logType = idx % 2 === 0 ? 'Check-in' : 'Check-out';
        });
      }
      if (records.length > 0) {
        console.log(`[ZktecoService] Sample parsed record:`, JSON.stringify(records[0]));
      }

      console.log(`[ZktecoService] Parsed ${records.length} attendance record(s)`);
      return { success: true, data: records, status, message: `Retrieved ${records.length} record(s) from device.` };
    } catch (err) {
      console.error('[ZktecoService] Get attendance error:', err);
      return { success: false, message: `Failed to retrieve logs: ${err.message}` };
    }
  }

  /**
   * Retrieve all users registered on the device.
   * @returns {{success: boolean, data?: Array, message?: string, status?: string, userCount?: number}}
   */
  async getUsers() {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      const users = await this._withRetry('Get users', async () => {
        const response = await this._downloadWithDisable(() => this.device.getUsers());
        return response.data || [];
      });
      const lastReply = this.device && this.device.ztcp ? this.device.ztcp.lastReply : null;
      const status = this._classifyDownloadStatus(users.length, lastReply);
      console.log(`[ZktecoService] Retrieved ${users.length} user(s) from device (device reply: ${lastReply})`);
      // Sanity check: device reports users but the download came back empty.
      if (users.length === 0 && this.deviceInfo && this.deviceInfo.userCount > 0) {
        if (status === 'rejected') {
          console.warn(`[ZktecoService] Device reports ${this.deviceInfo.userCount} user(s) but answered the user-list request with command ${lastReply} (${exportErrorMessage(lastReply)}) — this firmware doesn't stream the user list over TCP. Attendance sync is unaffected.`);
        } else if (lastReply === COMMANDS.CMD_ACK_OK) {
          // Verified against the pyzk reference: the GET_USERS request is correct;
          // the device just acknowledges it with "nothing to send" (CMD_ACK_OK)
          // even though it reports users. Firmware limitation, not fixable in code.
          console.warn(`[ZktecoService] Device reports ${this.deviceInfo.userCount} user(s) but answered the user-list request with CMD_ACK_OK ("nothing to send") — this firmware doesn't stream its user list over TCP/IP, so user names can't be pulled from the device.`);
        } else {
          console.warn(`[ZktecoService] Device reports ${this.deviceInfo.userCount} user(s) but download returned 0 (device reply: ${lastReply}) — the device doesn't serve its user list over TCP/IP.`);
        }
      }
      return { success: true, data: users, status, userCount: this.deviceInfo ? this.deviceInfo.userCount : 0, message: `Retrieved ${users.length} user(s).` };
    } catch (err) {
      console.error('[ZktecoService] Get users error:', err);
      return { success: false, message: `Failed to retrieve users: ${err.message}` };
    }
  }

  /**
   * Add or update a user on the device.
   * @param {number} uid - Internal device record ID (1-3000)
   * @param {string} userid - User-facing ID (max 9 chars)
   * @param {string} name - Display name (max 24 chars)
   * @param {string} password - Device password (max 8 chars)
   * @param {number} role - 0=normal, 1=admin
   * @param {number} cardno - Card number
   * @returns {{success: boolean, message?: string}}
   */
  async setUser(uid, userid, name, password = '', role = 0, cardno = 0) {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      await this.device.setUser(uid, String(userid), String(name).substring(0, 24), String(password).substring(0, 8), role, cardno);
      console.log(`[ZktecoService] Set user: uid=${uid}, userid=${userid}, name=${name}`);
      return { success: true, message: `User "${name}" enrolled on device.` };
    } catch (err) {
      console.error('[ZktecoService] Set user error:', err);
      return { success: false, message: `Failed to enroll user: ${err.message}` };
    }
  }

  /**
   * Delete a user from the device.
   * @param {number} uid - Internal device record ID (1-3000)
   * @returns {{success: boolean, message?: string}}
   */
  async deleteUser(uid) {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      await this.device.deleteUser(uid);
      console.log(`[ZktecoService] Deleted user: uid=${uid}`);
      return { success: true, message: `User removed from device.` };
    } catch (err) {
      console.error('[ZktecoService] Delete user error:', err);
      return { success: false, message: `Failed to delete user: ${err.message}` };
    }
  }

  /**
   * Clear all attendance logs from the device.
   * @returns {{success: boolean, message?: string}}
   */
  async clearAttendanceLog() {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      await this.device.clearAttendanceLog();
      console.log('[ZktecoService] Cleared attendance logs from device');
      return { success: true, message: 'Attendance logs cleared from device.' };
    } catch (err) {
      console.error('[ZktecoService] Clear attendance log error:', err);
      return { success: false, message: `Failed to clear logs: ${err.message}` };
    }
  }

  /**
   * Get device status/info.
   */
  async getStatus() {
    if (!this.isConnected()) {
      return { connected: false };
    }

    try {
      const info = await this.device.getInfo();
      return {
        connected: true,
        ...this.deviceInfo,
        ...info
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }
}

module.exports = new ZktecoService();
