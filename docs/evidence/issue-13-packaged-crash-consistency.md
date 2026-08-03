# Issue 13 packaged crash-consistency evidence

Date: 2026-08-03

## Result

The packaged Windows application survives ordinary shutdown and a forced
process-tree termination without opening or creating a plaintext Joplin
profile. A corrupt committed Vault Key Envelope prevents Joplin startup and
terminates the application with exit code 1 rather than reporting false
success.

The proof runs against `dist/win-unpacked/Joplin.exe`, not a storage-only test
harness. It creates two notes containing unique plaintext canaries, waits for
the second note to become durable, forcibly terminates the Electron process
tree, scans all Watchtower-managed paths, restarts the same vault, and reads
the second note through the recovered encrypted profile.

It then corrupts the committed envelope, attempts another unlock, and proves:

- the application process exits with code 1;
- no Joplin note window remains or opens;
- the plaintext scanner reports no canary in any managed file; and
- `profile.sqlite` does not have the plaintext SQLite file header.

The CI artifact `watchtower-packaged-first-run-win32-x64` contains:

- `plaintext-scan.json` for ordinary close;
- `forced-termination-plaintext-scan.json` for the hard-kill boundary;
- `corrupt-envelope-plaintext-scan.json` for failed-closed startup; and
- `usable-note-window.png` showing the usable encrypted application.

## Durable-transition coverage

The packaged proof complements the child-process credential lifecycle tests
recorded in `issues-13-15-vault-credential-lifecycle.md`. Those tests terminate
at every current envelope persistence barrier: before initial recovery
confirmation, after pending-envelope flush, after committed-envelope flush,
and at pending and committed barriers for passphrase recovery and Recovery
Secret replacement. Restart observes only the complete old generation or the
complete new generation.

Together, the two layers cover the durable transitions that exist in the
first-release vault implementation: credential-envelope activation,
SQLCipher note persistence, ordinary close, abrupt process death, encrypted
restart, and corrupt-bootstrap refusal. Encrypted backup and update
transactions are separate future modules and must add their own transition
matrices when implemented.

## Defect found by the proof

The initial red packaged test exposed a desktop lifecycle race. Destroying the
pre-profile unlock window removed Electron's final window, allowing a normal
code-0 exit before failed bootstrap could request code 1. The composition root
now keeps Electron alive only for the pre-profile bootstrap lifetime, allowing
secure view cleanup to finish before the bootstrap selects the exit status.
The guard is removed after successful Joplin startup.
