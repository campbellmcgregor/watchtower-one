<!-- cspell:ignore EBUSY taskkill -->

# Joplin v3.6.15 runtime plaintext trace

This harness records the persistent allocated-file footprint of the pinned
Joplin desktop baseline at the public profile-storage seam. It exercises clean
startup, note/resource/plugin persistence, external editing, stock Backup,
update check, renderer crash, Windows process-tree termination, and recovery.

It is development evidence, not packaged-build or Windows-wide forensic
qualification. The harness scans only its declared observation root. It does
not scan the host account's existing home or app-data directories, deleted
records, pagefile, hibernation, Windows Error Reporting, antivirus/indexer
state, or network traffic.

## Run on Windows

Use a new empty trace root. The evidence directory may already exist; a
successful run replaces the ten scenario manifests, environment record, and
summary.

```powershell
$env:WATCHTOWER_TRACE_ROOT = 'C:\tmp\watchtower-issue7-runtime-clean'
$env:WATCHTOWER_TRACE_EVIDENCE = (
    Resolve-Path 'docs\evidence\issue-7-runtime-plaintext-trace'
).Path
yarn watchtowerTraceBaseline
```

The run intentionally uses `taskkill /pid <main-pid> /f /t` for the
forced-termination checkpoint. The PID comes from the Electron application
launched by Playwright; the harness never terminates by image name.

## Evidence interpretation

- Live Chromium LevelDB `LOCK` files can report `EBUSY`. Closed snapshots must
  have zero scan errors.
- Canary hits report UTF-8 and UTF-16LE literal matches in readable regular
  files. No match does not rule out compressed, deleted, sparse, encoded, or
  unreadable content.
- Fixture hashes and source-controlled canaries are test inputs. Only copies
  created below the observation root are classified as runtime artifacts.
- Machine-specific absolute paths are redacted from committed evidence. File
  paths inside the observation root, sizes, hashes, timestamps, errors, and
  canary identifiers remain intact.

The reviewed result and packaged-build follow-up matrix are in
[`docs/research/joplin-v3.6.15-windows-runtime-plaintext-footprint.md`](../../docs/research/joplin-v3.6.15-windows-runtime-plaintext-footprint.md).
The disposable Windows Sandbox packaged-trace harness is under
[`watchtower/sandbox-trace`](../sandbox-trace/).
