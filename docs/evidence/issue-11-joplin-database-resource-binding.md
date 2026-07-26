# Issue 11 Joplin database and resource binding evidence

<!-- cspell:ignore handoffs -->

Date: 2026-07-26

## Result: focused runtime binding, issue remains open

Ordinary Joplin database startup can now receive an authorised logical
database driver and name. Stock Joplin retains its existing
`DatabaseDriverNode` and physical `profileDir/database.sqlite` default when no
binding is supplied. Watchtower supplies `watchtower-profile`, so Joplin runs
its own migrations and model queries without receiving the physical SQLCipher
path.

`EncryptedJoplinProfileHost` now gives the Joplin runtime an unopened,
capability-scoped database driver. The runtime owns the logical open, while the
host continues to own final close, forced termination, and Vault Session
authority.

The Watchtower profile binding also installs the virtual encrypted resource
filesystem in both Joplin's `Resource` model and `EncryptionService`. Ordinary
attachment behavior and sync E2EE therefore select the same encrypted resource
boundary rather than stock physical resource files.

## Verification

The public-seam tests prove that:

- an authorised logical driver is opened as `watchtower-profile`;
- a forbidden physical database path is never supplied to that driver;
- Joplin runs the pinned schema migration through the capability-scoped driver;
- a note is written, read, updated during shutdown, and closed in Vault
  Lifecycle order;
- resource metadata is saved through Joplin's `Resource` model and its content
  is read through `Resource.content`; and
- Joplin's sync `EncryptionService` selects the same virtual resource
  filesystem.

The desktop and mobile shared-backend type checks pass, preserving the stock
SQLite adapters outside the Watchtower desktop binding.

## Deliberate handoffs

Issue #11 remains open. This slice does not yet:

- transport the main-process storage interfaces to Joplin's content-bearing
  renderer;
- route sensitive plugin persistence through `PrivateProfileData`;
- replace stock root-profile, cache, log, temporary, or Electron-state paths;
  or
- select production vault access before issues #14 and #15 provide the Local
  Vault Key lifecycle.

Those boundaries must be implemented and runtime-traced before issue #11 can
close. Issue #12 continues to own explicit plaintext-egress replacements.
