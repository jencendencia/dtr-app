/**
 * Dump raw 40-byte attendance records from the device so we can map the
 * actual byte layout of this ZK3969 firmware (the standard offset 12-17
 * timestamp guess fails on this device — records decode with empty times).
 *
 * Run: node scripts/dump-raw-records.js
 */
const Zkteco = require('zkteco-js');
const { REQUEST_DATA } = require('zkteco-js/src/helper/command');

const HOST = process.env.ZK_HOST || '192.168.1.201';
const PORT = parseInt(process.env.ZK_PORT || '4370', 10);

function fmt(buf) {
  const hex = [];
  let asc = [];
  for (let i = 0; i < buf.length; i++) {
    if (i % 16 === 0) {
      if (i) hex.push('  ' + asc.join(''));
      hex.push(String(i).padStart(2, '0') + ':');
      asc = [];
    }
    hex.push(buf[i].toString(16).padStart(2, '0'));
    asc.push(buf[i] >= 32 && buf[i] < 127 ? String.fromCharCode(buf[i]) : '.');
  }
  hex.push('  ' + asc.join(''));
  return hex.join(' ');
}

async function main() {
  const device = new Zkteco(HOST, PORT, 15000, 4000);
  await device.createSocket();

  // Fetch raw attendance buffer
  const raw = await device.ztcp.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS);
  let data = raw.data || Buffer.alloc(0);

  console.log('Raw buffer length:', data.length);
  if (data.length >= 4) {
    // First 4 bytes are a size header (little-endian u32), records follow
    const declared = data.readUInt32LE(0);
    console.log('Declared size header:', declared);
    data = data.subarray(4);
  }

  console.log('\nRecords (40 bytes each):', Math.floor(data.length / 40), '\n');
  for (let i = 0; i + 40 <= data.length; i += 40) {
    const rec = data.subarray(i, i + 40);
    console.log(`--- Record ${i / 40} (sn bytes 0-1: ${rec.readUInt16LE(0)}) ---`);
    console.log(fmt(rec));
    // Probe common timestamp candidates: try every 6-byte window that yields a sane date
    console.log('  candidate timestamps (offset -> Y-M-D H:M:S):');
    for (let off = 0; off + 6 <= 40; off++) {
      const t = rec.subarray(off, off + 6);
      // raw bytes
      const y = t[0] + 2000, mo = t[1], d = t[2], h = t[3], mi = t[4], s = t[5];
      const bcd = b => ((b >> 4) & 0xf) * 10 + (b & 0xf);
      const by = 2000 + bcd(t[0]), bmo = bcd(t[1]), bd = bcd(t[2]), bh = bcd(t[3]), bmi = bcd(t[4]), bs = bcd(t[5]);
      const sane = (v) => v.mo >= 1 && v.mo <= 12 && v.d >= 1 && v.d <= 31 && v.h <= 23 && v.mi <= 59 && v.s <= 59;
      const rawOk = sane({ mo, d, h: h, mi, s }) && y >= 2020 && y <= 2035;
      const bcdOk = sane({ mo: bmo, d: bd, h: bh, mi: bmi, s: bs }) && by >= 2020 && by <= 2035;
      if (rawOk) console.log(`    off ${String(off).padStart(2)}: RAW  ${y}-${mo}-${d} ${h}:${mi}:${s}`);
      if (bcdOk) console.log(`    off ${String(off).padStart(2)}: BCD  ${by}-${bmo}-${bd} ${bh}:${bmi}:${bs}`);
    }
    console.log('');
  }

  try { await device.ztcp.freeData(); } catch (_) {}
  await device.disconnect();
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
