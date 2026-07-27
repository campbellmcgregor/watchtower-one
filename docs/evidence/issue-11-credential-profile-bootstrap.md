# Issue 11 credential-to-profile bootstrap evidence

<!-- cspell:ignore handoff handoffs sqlcipher -->

Date: 2026-07-27

## Result: existing-vault production handoff, issue remains open

The desktop bootstrap can now compose the committed Vault Credential
Lifecycle, production SQLCipher profile opener, and encrypted Joplin profile
host through one dependency module. A successful passphrase unlock transfers
only the `VaultSessionKeyRing` into the trusted SQLCipher opener. The derived
database key exists only inside the key-ring callback and is not returned to
desktop startup, Joplin runtime, renderer code, command-line arguments,
environment variables, or IPC.

The module owns the otherwise error-prone handoff between vault access and
profile startup. Callers provide a command, public envelope location, encrypted
database location, lazy Joplin runtime loader, and ephemeral-session adapter.
They do not publish storage globally or coordinate its lifetime. The encrypted
storage and key ring are disposed together on orderly close or hard
termination.

At the accepted Application bootstrap seam, the focused test proves:

- a real committed envelope and correct passphrase open capability-scoped
  profile storage before Joplin is lazy-loaded;
- the SQLCipher domain key is the same key created with the vault;
- a wrong passphrase opens no storage and loads no Joplin profile code; and
- close drains the profile before disposing encrypted storage and key custody.

The Windows compatibility workflow now includes the same desktop-bootstrap
test. With the pinned reviewed compatibility prebuild, it opens the production
SQLCipher adapter, writes and reads a canary through the profile database, and
closes through Vault Lifecycle.

## Native-prebuild finding

The stock Signal 3.3.9 Windows prebuild correctly fails the accepted profile
verification. A direct runtime probe reports `DQS=0`, FTS5, and memory temp
storage, but not the required `DQS=3`, FTS3, or FTS4 options needed by pinned
Joplin migrations and search. Production therefore continues to require the
reproducible compatibility build from pinned Signal source. The adapter does
not weaken verification to accept the stock binary.

## Deliberate handoffs

Issue #11 remains open. This slice supports existing-vault passphrase unlock
but does not yet:

- supply the pre-unlock create/recovery user interface;
- transport the main-process storage interfaces to the content-bearing Joplin
  renderer;
- replace stock settings, plugin, log, cache, temporary, and Electron-state
  persistence in the ordinary renderer runtime; or
- replace the failed-closed placeholder in `main.ts`.

Those integrations must land before Watchtower has a user-operable desktop
build or issue #11 can close. Issue #13 must then qualify forced termination
and prove that application startup never selects a plaintext profile.
