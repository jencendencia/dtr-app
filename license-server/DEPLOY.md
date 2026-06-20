# License Server Deployment

This is a Cloudflare Worker that validates license keys for the DTR app.

## Prerequisites

1. A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
2. [Node.js](https://nodejs.org/) installed
3. Install Wrangler CLI: `npm install -g wrangler`

## Step 1: Authenticate Wrangler

```bash
npx wrangler login
```

## Step 2: Create KV Namespace

```bash
npx wrangler kv:namespace create LICENSE_KV
```

Copy the returned ID. Then edit `wrangler.toml` and replace `REPLACE_ME` with that ID.

## Step 3: Set Admin Secret

Choose a strong admin secret (used to add/revoke license keys).

Edit `src/index.js` and replace `REPLACE_WITH_ADMIN_SECRET` on line 1 with your secret.

## Step 4: Deploy

```bash
npx wrangler deploy
```

Note the worker URL (e.g., `https://dtr-license-server.xxxx.workers.dev`).

## Step 5: Update the App

In `src/main/main.js`, replace `LICENSE_SERVER` on line 845 with your worker URL:

```js
const LICENSE_SERVER = 'https://dtr-license-server.xxxx.workers.dev';
```

## Step 6: Seed License Keys

Generate initial license keys:

```bash
node seed.js YOUR_ADMIN_SECRET https://dtr-license-server.xxxx.workers.dev
```

This creates 3 license keys. Give one key per customer.

## Managing License Keys

### Add a key manually:

```bash
curl -X POST https://dtr-license-server.xxxx.workers.dev/admin/add-key \
  -H "Content-Type: application/json" \
  -d '{"adminSecret":"YOUR_SECRET","maxActivations":1}'
```

### Revoke a key:

```bash
curl -X POST https://dtr-license-server.xxxx.workers.dev/admin/revoke \
  -H "Content-Type: application/json" \
  -d '{"adminSecret":"YOUR_SECRET","key":"DTR-XXXX-XXXX-XXXX"}'
```

### List all keys:

```bash
curl -H "X-Admin-Secret: YOUR_SECRET" \
  https://dtr-license-server.xxxx.workers.dev/admin/list-keys
```

## How It Works

1. App starts → checks local `license.json` for stored activation
2. If not activated → shows activation screen → user enters license key
3. App calls the worker to validate + register the machine
4. If valid → stores activation → shows login
5. If invalid → shows error
6. Each license key has a max activation count (prevents sharing)
