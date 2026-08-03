# Issue 15 packaged passphrase-rotation evidence

Date: 2026-08-03

## Result

The packaged Windows application can authorize a passphrase change with the
current passphrase, atomically rewrap the existing Local Vault Key, and open
the same encrypted profile with the replacement passphrase. The SQLCipher key
fingerprint and note data remain unchanged; profile content is not rewritten.

The trusted pre-profile screen collects current and replacement passphrases
through the isolated, memory-only Electron session. Both submitted values are
cleared after one attempt. Wrong current credentials and rejected replacement
passphrases return opaque feedback without initializing Joplin.

## Packaged proof

The Playwright proof runs against `dist/win-unpacked/Joplin.exe` after the
Recovery Secret flow and verifies:

- the note written before forced termination remains readable after rotation;
- the pre-rotation passphrase is rejected after the durable rewrap commit;
- the rotated passphrase remains the active credential for subsequent
  failed-closed startup checks;
- `passphrase-rotation-plaintext-scan.json` scans 70 managed files with zero
  scanner errors and zero matches for either passphrase, the Recovery Secret,
  or note canaries; and
- corrupt committed envelope metadata still prevents Joplin startup and exits
  non-zero after rotation.

The Windows CI artifact `watchtower-packaged-first-run-win32-x64` now includes
`passphrase-rotation-plaintext-scan.json`.

## Remaining Issue 15 scope

This slice does not close Issue #15. User-facing Recovery Secret replacement
and authenticated vault retirement/deletion remain. The lifecycle-level
forced-termination tests already cover pending and committed Recovery Secret
replacement barriers; the next slice must expose that operation without
persisting the authorizing passphrase or newly generated Recovery Secret.
