# ADR-0003: Use a SQLCipher-led logical profile vault

<!-- cspell:ignore campbellmcgregor cleanup Cryptomator cryptomator signalapp SQLCipher Sqlcipher Zetetic -->

- Status: Accepted
- Date: 2026-07-23
- Scope: Local-at-rest storage architecture
- Supersedes: ADR-0001's requirement for a transparent whole-root-profile layer

## Context

ADR-0001 selected Joplin as the mature note-taking foundation and required local
encryption around its complete root profile. Source inventory then showed that a
literal SQLCipher replacement for `database.sqlite` would leave attachment
files, JSON settings, plugin data, Electron state, logs, temporary files,
backups, external-editor copies, and crash artifacts outside that database.

Mounted container candidates would preserve those file assumptions, but would
add a second application/runtime and platform mount stack. Cryptomator is
maintained, but embedding it would add Java plus WinFsp/FUSE/WebDAV integration
and would still require independent qualification of SQLite locking, crash, and
packaging behavior. VeraCrypt is also maintained, but its volume and driver
lifecycle does not fit Watchtower's seamless product ownership.

The issue #8 prototype tested a SQLCipher-led logical vault against the pinned
Joplin v3.6.15 baseline. A Joplin-compatible rebuild of Signal's N-API SQLCipher
binding ran the complete schema, stored a 100 MiB attachment as a BLOB, survived
close/reopen and forced termination, exported and restored an encrypted backup,
upgraded schema 48 to 49, loaded under Electron 40.8.3, and loaded from a
directory-packaged application. No plaintext canary occurred in controlled
database, WAL, SHM, journal, backup, or forced-termination artifacts.

## Decision

Watchtower One will use a **SQLCipher-led logical profile vault**, not a mounted
whole-profile container.

SQLCipher is the canonical encrypted store for:

- notes, notebooks, tags, history, conflicts, search projections, OCR text and
  embeddings already held in Joplin's database;
- sensitive settings and credential fallback material;
- curated-plugin user persistence;
- bounded attachment content stored using SQLite's BLOB storage class; and
- automatic encrypted backup state.

The v1 attachment limit remains 100 MiB unless later release evidence supports a
change.

The product promise is:

> When Watchtower One is locked or closed, app-managed notes, metadata,
> histories, search data, attachments, sensitive settings, credentials,
> curated-plugin user data, and automatic backups are encrypted at rest.
> Watchtower One does not silently create content-bearing plaintext files.

This is a logical user-data promise. It does not claim that every file shipped
with or created near the application is encrypted. Binaries, signed plugin
packages, opaque format/bootstrap identifiers, process locks, reconstructible
non-content caches, and sanitised operational diagnostics may remain public
after explicit review. RAM while unlocked, OS pagefile/hibernation/crash dumps,
antivirus quarantine, filesystem metadata outside Watchtower's ownership, and
user-authorised Explicit Plaintext Egress are stated threat-model limits.

Joplin sync E2EE remains the remote-sync protection layer. The Local Vault Key
and Joplin sync keys remain separate key domains.

## Deep modules and seams

Production implementation will concentrate downstream knowledge in these deep
modules:

1. **Vault Lifecycle module** — owns create, unlock, recover, rotate, lock, and
   close. Its interface never exposes an unencrypted mode. Raw key material is
   passed only through an internal seam to the open encrypted store.
2. **Encrypted Profile Database adapter** — sits at Joplin's existing
   database-driver seam. It applies the key before the first schema read, checks
   required SQLCipher/SQLite compile options, fails closed on key or integrity
   errors, and owns encrypted export.
3. **Resource Content module** — its interface imports, reads/streams, exports,
   and deletes resource bytes by resource identifier. It does not expose a
   persistent plaintext path or the underlying SQL table to callers.
4. **Encrypted Settings module** — owns sensitive application settings and
   curated-plugin persistence. Only a reviewed Public Bootstrap State may exist
   before unlock.
5. **Plaintext Egress module** — owns disclosed export, print, external-edit, and
   open-with materialisation plus bounded cleanup. Background code cannot create
   equivalent plaintext files directly.

The existing stock SQLite adapter remains a second adapter for upstream Joplin
and its tests; the Watchtower SQLCipher adapter is selected only by the
Watchtower distribution. Tests and runtime evidence exercise behavior at these
interfaces rather than reaching past them.

Resource bytes are bound as binary values. The Watchtower resource table uses a
Joplin-compatible `TEXT` column declaration because Joplin's schema-field
registry rejects a declared `BLOB` type during upgrades; the module verifies the
actual SQLite storage class is `blob`. This is an implementation detail hidden
from callers.

## Native binding decision

The stock `@signalapp/sqlcipher` 3.3.9 prebuild is not Joplin-compatible because
it is compiled with `SQLITE_DQS=0` and without FTS3/FTS4. Watchtower will consume
reproducible compatibility prebuilds from pinned Signal source with:

- `SQLITE_DQS=3`;
- `SQLITE_ENABLE_FTS3`;
- `SQLITE_ENABLE_FTS3_PARENTHESIS`;
- `SQLITE_ENABLE_FTS4`; and
- Signal's existing FTS5 and SQLCipher options.

This does not authorize an opaque permanent binary fork. Every distributed
binary requires its pinned upstream source, minimal patch, build recipe,
dependency versions, artifact hash, notices, and exact Corresponding Source.
Signal and Zetetic releases must enter the downstream update monitor.

The prototype's SQLCipher 4.10.0 core is not automatically the release version.
Production must update and qualify the core or make a separately reviewed
supported-package decision.

## Consequences

- Watchtower avoids a JVM, filesystem mount, driver installation, and a second
  user-managed encryption application.
- Joplin's note model, database schema, FTS4 search, sync formats, and sync E2EE
  remain intact.
- Resource and plugin file assumptions must be isolated behind the selected
  modules. Encryption is not complete merely when `database.sqlite` opens.
- Pre-unlock bootstrap must be smaller than stock Joplin's current settings and
  Electron initialization.
- Stock plaintext backup, logging, crash, temporary, and external-edit behavior
  must remain disabled until replaced or routed through Plaintext Egress.
- Windows is proven first. The design is cross-platform, but macOS and Linux
  support is not claimed until their compatibility prebuilds and runtime
  evidence pass.
- Upstream Joplin synchronization must rerun database migration, resource,
  forced-termination, backup, package, and plaintext-trace evidence.

## Rejected alternatives

- **Encrypt only Joplin's existing database** — rejects attachment and ancillary
  plaintext outside the database.
- **Cryptomator-embedded profile mount** — maintained but adds Java and
  platform-specific mount dependencies without removing qualification work.
- **VeraCrypt volume** — maintained but introduces a separately managed volume
  and driver lifecycle that does not fit the product.
- **Windows-only filesystem encryption** — cannot satisfy the intended
  cross-platform architecture.
- **Rewrite Joplin search to FTS5 as part of encryption** — broadens the
  downstream patch unnecessarily; a minimal binding compatibility build keeps
  upstream search behavior.

## Evidence

- `docs/research/watchtower-sqlcipher-cryptomator-architecture.md`
- `docs/research/joplin-local-plaintext-profile-and-storage-paths.md`
- `docs/evidence/issue-8-sqlcipher-joplin-architecture-proof.md`
- [SQLCipher compatibility build](https://github.com/campbellmcgregor/watchtower-one/actions/runs/30025458251)
- `campbellmcgregor/watchtower-one-legacy` attachment and packaged SQLCipher
  proofs referenced by the issue #8 research
