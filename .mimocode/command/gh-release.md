---
description: "Upload DTR app installer to GitHub release with correct filename matching"
---

# GitHub Release Upload

Upload the Electron app installer to GitHub releases, handling the filename mismatch issue between electron-builder output and GitHub's storage.

## Parameters

- `$1` = version (e.g., `1.2.5`)
- `$2` = GitHub token (optional, uses `GH_TOKEN` env var if not provided)

## Procedure

### 1. Bump Version

Edit `package.json` and set the version:
```json
{ "version": "$1" }
```

### 2. Build the Installer

```bash
npm run dist
```

This creates files in `dist/`:
- `Biometric DTR System Setup X.X.X.exe`
- `Biometric DTR System Setup X.X.X.exe.blockmap`
- `latest.yml`

### 3. Fix latest.yml (CRITICAL)

The `latest.yml` file references the installer filename with hyphens, but GitHub stores files with dots. Edit `dist/latest.yml` and replace all hyphens with dots in the filename:

**Before:** `Biometric-DTR-System-Setup-1.2.5.exe`
**After:** `Biometric.DTR.System.Setup.1.2.5.exe`

Fix both the `url` field under `files` and the `path` field.

### 4. Delete Old Release (if exists)

```bash
$env:GH_TOKEN = "$2"
gh release delete v$1 --repo jencendencia/dtr-app --yes
```

### 5. Create New Release and Upload

```bash
$env:GH_TOKEN = "$2"
gh release create v$1 `
  "dist\Biometric DTR System Setup $1.exe" `
  "dist\Biometric DTR System Setup $1.exe.blockmap" `
  "dist\latest.yml" `
  --repo jencendencia/dtr-app `
  --title "v$1" `
  --notes "Release v$1"
```

### 6. Verify

```bash
gh release view v$1 --repo jencendencia/dtr-app
```

Check that:
- Asset names use dots (not hyphens or spaces)
- `latest.yml` references the correct filename with dots

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| 404 when downloading update | `latest.yml` filename doesn't match asset | Fix `latest.yml` to use dots |
| Push rejected (secret scanning) | Token in committed code | Remove token, use env variable |
| Release not found | Old release not deleted | Delete old release first |

## Quick Checklist

- [ ] Version bumped in `package.json`
- [ ] Ran `npm run dist`
- [ ] Fixed `latest.yml` — replaced hyphens with dots in filename
- [ ] Deleted old release (if exists)
- [ ] Created new release with all 3 files (.exe, .blockmap, .yml)
- [ ] Verified asset names use dots
- [ ] Verified `latest.yml` content matches asset names
