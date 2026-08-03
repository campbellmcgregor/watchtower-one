# Issue 15 packaged vault-retirement evidence

Date: 2026-08-03

## Result

The packaged Windows application requires the current vault passphrase and
the exact phrase `DELETE MY VAULT` before retiring a local vault. It durably
commits a per-vault marker authenticated under the metadata domain key before
removing the encrypted profile directory. Joplin is never initialized during
the operation, and successful retirement exits cleanly.

This is local cryptographic retirement and encrypted-file deletion. It does
not delete sync targets or user-controlled backups and does not claim physical
secure erasure from SSD media.

## Interruption proof

Real child-process termination at each durability barrier proves:

- termination after the pending marker is flushed but before activation
  leaves the original encrypted vault active;
- termination after the committed marker is directory-flushed leaves the
  vault retired and causes the next access attempt to finish cleanup; and
- termination after encrypted-vault removal leaves the same durable retired
  state.

At every barrier, restart observes either the complete original vault or
durable retirement. It never reports deletion before the marker is committed.

## Packaged proof

The Playwright proof runs against `dist/win-unpacked/Joplin.exe` after all
credential rotations and verifies:

- retirement returns process exit code 0 without opening a Joplin window;
- `vault-retirement-plaintext-scan.json` scans 80 managed files with zero
  scanner errors and zero matches for either Recovery Secret, either recent
  passphrase, or note canaries;
- restoring the previously valid committed envelope returns process exit code
  1 before Joplin starts and removes the restored retired vault; and
- `retired-envelope-restoration-plaintext-scan.json` scans 82 managed files
  with zero scanner errors and zero canary matches.

The Windows CI artifact `watchtower-packaged-first-run-win32-x64` includes both
retirement reports alongside the existing restart, crash, recovery, rotation,
replacement, and corrupt-envelope evidence.

## Deliberate boundary

The local retirement registry prevents restoration while its separate marker
remains. An administrator who deletes the marker or restores the entire
Watchtower data root can roll back this local state. Stronger rollback
resistance requires an external hardware or service anchor and is outside the
account-free, cross-platform version 1 boundary.
