# Issue 11 ephemeral Joplin session binding evidence

<!-- cspell:ignore handoff -->

Date: 2026-07-29

## Result: content-bearing Electron session can remain memory-only

The Ephemeral Runtime now retains the native Electron `Session` created by its
fresh non-persistent partition and exposes that exact object only while the
Vault Session capability remains active. Disposal or termination revokes access
through the same capability boundary that guards the encrypted profile.

The controlled `joplinMain` entrypoint requires that session alongside the
encrypted `ProfileStorageBinding`. `ElectronAppWrapper` uses a supplied session
for custom protocols, the main window, and secondary plugin or export windows,
bypassing stock creation of the file-backed `<profile>/internal` session and
its spell-check dictionary migration files. The optional wrapper input
preserves upstream Joplin behavior when the wrapper is used outside the
controlled Watchtower entrypoint.

## Verification

Focused tests prove:

- the native Electron session is the exact session made available by the active
  Ephemeral Runtime;
- it cannot be obtained after runtime disposal;
- a file-backed Electron session is rejected before runtime activation;
- a supplied session bypasses the stock session factory; and
- secondary plugin and export windows receive the supplied session without
  replacing their existing web preferences; and
- the stock fallback remains available when no session is supplied directly to
  the upstream-compatible wrapper.

Desktop typechecking verifies that the production Electron factory, encrypted
profile host, controlled Joplin entrypoint, and wrapper agree on the native
session contract.

## Deliberate failed-closed handoff

Issue #11 remains open. The production runtime loader remains unavailable.
Although this slice removes the `<profile>/internal` persistence path for the
controlled entrypoint, ordinary Joplin startup still creates or reads
root-profile settings, logs, lock files, window state, plugin state, temporary
files, backups, crash data, and other profile paths outside the current
encrypted or ephemeral adapters.

Those paths must be routed through reviewed encrypted storage, made
reconstructible and non-content-bearing, or classified as explicit plaintext
egress before production Joplin startup is enabled. Runtime tracing and
forced-termination evidence remain required before issue #11 can close.
