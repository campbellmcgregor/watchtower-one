# Issue 15 packaged Recovery Secret replacement evidence

Date: 2026-08-03

## Result

The packaged Windows application can authenticate Recovery Secret replacement
with the current passphrase, generate a new user-held Recovery Secret, require
full confirmation, and atomically replace only the Recovery Secret wrapper.
The Local Vault Key, SQLCipher profile, note data, and active passphrase remain
unchanged.

The trusted pre-profile screen distinguishes replacement from first-run vault
creation. The authorizing passphrase and generated Recovery Secret remain in
the isolated, memory-only Electron session and are cleared after use.

## Packaged proof

The Playwright proof runs against `dist/win-unpacked/Joplin.exe` after
passphrase rotation and verifies:

- the rotated passphrase authorizes Recovery Secret replacement;
- the new Recovery Secret is distinct and requires exact confirmation before
  the replacement becomes active;
- the existing encrypted note remains readable after the durable commit;
- the retired Recovery Secret is rejected without initializing Joplin;
- `recovery-secret-replacement-plaintext-scan.json` reports zero scanner
  errors and zero matches for either Recovery Secret, either recent
  passphrase, or note canaries; and
- corrupt committed envelope metadata still prevents Joplin startup and exits
  non-zero after replacement.

The Windows CI artifact `watchtower-packaged-first-run-win32-x64` includes the
replacement plaintext scan alongside the restart, forced-termination,
recovery, passphrase-rotation, and corrupt-envelope evidence.

## Issue 15 completion

Authenticated local retirement and restored-envelope refusal are recorded in
`issue-15-packaged-vault-retirement.md`.
