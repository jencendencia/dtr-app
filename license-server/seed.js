/**
 * License key seed script.
 * Run with: node seed.js <admin-secret> <server-url>
 *
 * Example:
 *   node seed.js mysecret123 https://dtr-license-server.REPLACE.workers.dev
 */

const ADMIN_SECRET = process.argv[2];
const SERVER_URL = process.argv[3];

if (!ADMIN_SECRET || !SERVER_URL) {
  console.log('Usage: node seed.js <admin-secret> <server-url>');
  console.log('');
  console.log('This script adds the initial license keys to the server.');
  console.log('Generate as many keys as you need, one per customer.');
  process.exit(1);
}

const KEYS_TO_ADD = [
  { maxActivations: 1 },
  { maxActivations: 1 },
  { maxActivations: 1 },
];

async function run() {
  for (const opts of KEYS_TO_ADD) {
    const res = await fetch(`${SERVER_URL}/admin/add-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminSecret: ADMIN_SECRET, maxActivations: opts.maxActivations })
    });
    const data = await res.json();
    if (data.success) {
      console.log('✓ License key:', data.key);
    } else {
      console.log('✗ Error:', data.message);
    }
  }
}

run().catch(console.error);
