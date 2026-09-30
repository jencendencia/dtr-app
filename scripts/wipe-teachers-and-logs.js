/**
 * One-off: erase all teachers and attendance logs from the app database so the
 * Granding device can be re-synced from scratch. Keeps users, global schedule,
 * holidays, and the activity log (an audit entry is appended).
 *
 * The app must be CLOSED while this runs.
 *
 * Run: node scripts/wipe-teachers-and-logs.js
 */
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = 'C:/Users/Admin/AppData/Roaming/biometric-dtr-app/biometric_dtr.db';
const db = new DatabaseSync(DB_PATH);

const before = {
  teachers: db.prepare('SELECT COUNT(*) c FROM Teachers').get().c,
  logs: db.prepare('SELECT COUNT(*) c FROM AttendanceLogs').get().c,
  schedules: db.prepare('SELECT COUNT(*) c FROM TeacherTimeSchedule').get().c,
  trainings: db.prepare('SELECT COUNT(*) c FROM Trainings').get().c
};
console.log('Before:', JSON.stringify(before));

db.exec('BEGIN');
db.prepare('DELETE FROM AttendanceLogs').run();
db.prepare('DELETE FROM TeacherTimeSchedule').run();
db.prepare('DELETE FROM Trainings').run();
db.prepare('DELETE FROM Teachers').run();
// Granding device: forget the last sync so the Devices page shows "Never"
db.prepare("UPDATE BiometricDevices SET last_sync = NULL WHERE device_type = 'granding'").run();
db.prepare(
  "INSERT INTO UserActivityLogs (username, action, details) VALUES ('System', 'Wipe Teachers & Logs', ?)"
).run(`Erased ${before.teachers} teacher(s), ${before.logs} attendance log(s), ${before.schedules} teacher schedule(s), ${before.trainings} training(s) ahead of a full Granding re-sync`);
db.exec('COMMIT');

db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.exec('VACUUM');

const after = {
  teachers: db.prepare('SELECT COUNT(*) c FROM Teachers').get().c,
  logs: db.prepare('SELECT COUNT(*) c FROM AttendanceLogs').get().c,
  devices: db.prepare('SELECT id, name, device_type, last_sync FROM BiometricDevices').all()
};
console.log('After:', JSON.stringify(after, null, 1));
console.log('Integrity:', db.prepare('PRAGMA integrity_check').get().integrity_check);
db.close();
console.log('✅ Wipe complete');
