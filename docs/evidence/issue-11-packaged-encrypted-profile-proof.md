# Issue 11 packaged encrypted-profile proof

## Claim

The Windows desktop distribution can create a Watchtower Profile Vault, run
the real Joplin note editor through the encrypted profile adapters, close
cleanly, and reopen the same note without persisting the note canary as
plaintext in Watchtower-managed paths.

## Exercised production seams

- The pre-profile window creates the Local Vault Key envelope and requires the
  user to confirm the independently wrapped Recovery Secret.
- Joplin starts only after the Vault Session capability has been issued.
- The Joplin database uses the verified SQLCipher N-API build and rejects
  incompatible compile options.
- profile configuration, private settings, resources, file-backed logs,
  cache, temporary, and Electron-session operations use the encrypted or
  ephemeral profile bindings.
- admitted plugin executable packages and their deterministic extraction cache
  remain in the separate Public Plugin Code Store; plugin user data remains in
  encrypted storage.
- stock note, resource, and profile-configuration external editing remains
  unavailable until the Plaintext Egress module supplies its disclosure,
  lifetime, and residue contract.
- orderly shutdown gives the renderer up to five seconds to drain note and
  settings saves, drains profile log writes, closes Joplin and SQLCipher,
  disposes the ephemeral session, and revokes session authority before exit.

## Automated scenario

`watchtower/runtime-trace/watchtower-first-run.spec.ts` launches the unpacked
Windows package and:

1. creates a new vault with the standard memory profile;
2. records and confirms the generated Recovery Secret;
3. waits for the real Joplin note window;
4. creates a note containing `WT1-USABLE-NOTE-CANARY-20260801`;
5. closes Watchtower through its normal application lifecycle;
6. scans every file beneath the isolated application root for the canary;
7. asserts that the match set is empty;
8. reopens the package, unlocks with the passphrase, and confirms that the note
   title is present; and
9. closes cleanly a second time.

The workflow builds the pinned, reviewed SQLCipher source, verifies its
compile options, stages that exact prebuild into the packaged application, and
uploads `plaintext-scan.json` plus `usable-note-window.png` as the
`watchtower-packaged-first-run-win32-x64` artifact.

## Local verification

On 2026-08-01 the final packaged scenario passed in 1.1 minutes. The closed-profile
snapshot contained 49 files and zero note-canary matches. The same run reopened
the encrypted database and displayed the previously created note. Focused
verification also passed 70 desktop tests (one conditional SQLCipher test
skipped when no external prebuild root was supplied), ten profile-storage and
external-editing boundary tests, and desktop TypeScript checking.

## Remaining release evidence

This proof covers the ordinary create/use/close/reopen path. It does not replace
the forced-termination, recovery, migration, upstream-upgrade, or final
allowlist traces required by ADR-0004 and the release plan.
