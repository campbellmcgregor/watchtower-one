# Issue 11 encrypted profile storage adapter evidence

<!-- cspell:ignore handoffs sqlcipher -->

Date: 2026-07-25

## Result: adapter foundation, issue remains open

The Watchtower profile boundary now has an implementation for an already-keyed
SQLCipher connection. It preserves Joplin's database-driver contract, migrates
the pinned v3.6.15 schema to version 49, stores attachment bytes and
Joplin-sync ciphertext as separate encrypted records, offers SQLCipher-backed
private-data storage, and supplies memory-only building blocks for cache, log,
Electron-state, and temporary content.

This is a reviewable foundation for issue #11, not its completion. Stock Joplin
does not yet select these adapters in `BaseApplication`, its resource globals,
plugin-data paths, logger/cache/temp paths, BrowserWindows, or synchronizer.
Those ordinary-runtime bindings must be added and qualified in a follow-up
slice before issue #11 can close.

The production entry point remains deliberately failed closed. Issue #11 does
not invent the Local Vault Key or pass a raw database key through JavaScript
renderers. Issues #14 and #15 own key creation, wrapping, unlock, recovery, and
rotation and will supply the already-keyed native connection to this adapter.

## Implemented boundaries

### Encrypted Profile Database

- `EncryptedProfileStorage.database()` implements the public driver used by
  Joplin's `Database` and `JoplinDatabase`.
- The driver accepts only the logical name `watchtower-profile`; it never
  exposes the physical SQLCipher path.
- Every operation requires a live Vault Session lease.
- Closing Joplin's logical database does not prematurely close the native
  store; Vault Lifecycle owns the physical close and forced termination.
- The SQLCipher connection verifies the reviewed SQLite/SQLCipher compile
  options, plaintext-header size, memory security, memory temp store, secure
  deletion, foreign keys, WAL mode, SQLite integrity, and cipher integrity
  before returning a usable adapter.
- Queries that can attach another database, load an extension, write a database
  through `VACUUM INTO`, rekey or decrypt the profile, enable SQLCipher
  diagnostics, or relax a protected persistence PRAGMA are rejected, including
  multi-statement, quoted, and schema-qualified PRAGMA variants.
- A failed native close can be retried by hard termination rather than being
  misreported as already closed.

### Resource Content

- Canonical resource bytes and temporary Joplin sync ciphertext use distinct
  records keyed by the resource identifier.
- Content is bound with SQLite's binary storage class while the declared content
  column remains `TEXT` for Joplin schema compatibility. The fixed content-kind
  enum uses integer storage and every column is non-null.
- Size and SHA-256 metadata are checked on reads, and the v1 100 MiB limit is
  enforced for canonical content. Sync ciphertext has bounded allowance for
  Joplin's encryption and base64 overhead.
- `EncryptedResourceFsDriver` preserves Joplin's existing file-oriented
  resource calls without creating a resource directory. It implements ordinary
  reads, writes, metadata, directory listing, chunked reads, append, move,
  delete, hash, and timestamp behavior.
- Imports from an external source may enter encrypted storage. Resource copies
  leaving the virtual resource directory are rejected with
  `explicitPlaintextEgressRequired`; issue #12 owns the user-authorised egress
  workflow.
- Invalid nested paths, directory creation, directory reads, and synchronous
  appends cannot fall through to the physical filesystem.

### Sensitive and ephemeral state

- Sensitive application settings and curated-plugin values are addressable only
  through `PrivateProfileData` inside SQLCipher.
- Cache, log, Electron-state, and temporary artifact values are held in session
  memory and cleared before the encrypted store closes.
- `EphemeralProfileRuntime` creates a fresh non-`persist:` Electron partition
  with caching disabled. A non-null Electron `storagePath` is rejected before
  Joplin can load. Stop drains connections, storage, and cache in a fixed order.
- `EncryptedJoplinProfileHost` creates the database, resource, private-data, and
  ephemeral adapters only after Vault Lifecycle issues its non-serialisable
  capability. It holds one root lease for the runtime lifetime so orderly
  Joplin shutdown can flush encrypted state after Vault Lifecycle stops accepting
  new external work. The Joplin runtime remains lazy-loaded until those checks
  pass.

## Verification

The focused suites prove:

- database access is rejected outside an active Vault Session;
- stock Joplin `Database` behavior and the complete schema-49 migration pass
  through the logical driver;
- direct note, resource, private-data, cache, log, Electron-state, and temporary
  adapter canaries use the selected storage boundary;
- Joplin's E2EE file primitive streams a canonical resource into isolated sync
  ciphertext and decrypts it back through the virtual resource filesystem;
- explicit plaintext resource copies and unsafe SQLCipher persistence changes
  fail closed; and
- a file-backed Electron session is rejected before runtime activation.

These tests do not claim that the stock renderer, plugin runner, synchronizer,
or BrowserWindows are wired. The host test deliberately uses an injected
runtime contract and now proves that the runtime may flush its database during
the lock transition.

The native integration proof uses the compatibility prebuild recipe selected in
ADR-0003. It creates a new encrypted profile, runs all Joplin migrations, writes
note/resource/setting canaries, closes, reopens, verifies the data, and scans
the database, WAL, SHM, and journal artifacts for plaintext matches. The virtual
resource directory is never created.

The pull-request workflow rebuilds the binding from Signal's pinned
`node-sqlcipher` commit
`14e0f5e74e6bcd26d3462b48546473de5fd3a1fc`, applies the reviewed Joplin
compile flags, verifies FTS and temp-store support, runs the native proof, and
retains the compatibility binary and compile-options record as short-lived CI
evidence.

## Deliberate handoffs

- The remaining issue #11 work installs these database, resource, private-data,
  ephemeral-file, and Electron-session seams in ordinary Joplin startup and
  verifies real model, plugin, renderer, and synchronizer behavior.
- Issue #12 disables or replaces stock backup, crash, diagnostic,
  external-edit, and other plaintext-egress paths. The storage adapter does not
  grant an alternate export bypass.
- Issue #13 performs forced-termination and recovery qualification and proves
  zero silent fallback.
- Issues #14 and #15 supply and manage the Local Vault Key. Until then,
  `main.ts` continues to select the failed-closed desktop dependencies.
- Release qualification must rerun packaged runtime tracing. This unit and
  native integration evidence does not replace the accepted Windows trace
  matrix.
