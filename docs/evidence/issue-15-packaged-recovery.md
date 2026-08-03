# Issue 15 packaged Recovery Secret evidence

Date: 2026-08-03

## Result

The packaged Windows application can recover an existing encrypted profile
with its user-held Recovery Secret and a replacement passphrase. Recovery
rewraps the existing Local Vault Key; it does not create another profile or
rewrite note content.

The pre-profile recovery screen accepts the Recovery Secret and replacement
passphrase through the isolated, memory-only Electron session. The main
process consumes and clears both submitted values before opening profile
storage. Joplin cannot initialize until the recovered key ring has opened the
existing SQLCipher profile.

## Packaged proof

The Playwright proof runs against `dist/win-unpacked/Joplin.exe` and verifies:

- the same note written before forced termination is readable after recovery;
- the original passphrase is rejected after the recovery commit;
- the replacement passphrase is used for the subsequent failed-closed check;
- `recovery-plaintext-scan.json` scans 64 managed files with zero scanner
  errors and zero matches for the note, Recovery Secret, or replacement-
  passphrase canaries; and
- corrupt committed envelope metadata still prevents Joplin startup and exits
  non-zero after recovery.

The Windows CI artifact `watchtower-packaged-first-run-win32-x64` now includes
`recovery-plaintext-scan.json` alongside the ordinary-close,
forced-termination, and corrupt-envelope reports.

## Issue 15 completion

Packaged passphrase rotation, Recovery Secret replacement, and authenticated
vault retirement are recorded in the corresponding Issue 15 evidence files.
