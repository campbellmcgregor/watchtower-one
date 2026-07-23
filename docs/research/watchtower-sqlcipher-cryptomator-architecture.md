# SQLCipher-led storage and Cryptomator feasibility for Watchtower One

<!-- cspell:ignore cryptofs Cryptomator databasesqlite minidumps signalapp SQLCipher WinFsp Zetetic -->

Status: accepted by ADR-0003

Research date: 2026-07-23

## Question

Can Watchtower One provide seamless, cross-platform local encryption by making
SQLCipher the canonical user-data store, rather than mounting a separately
maintained encrypted container? If not, can Cryptomator provide the transparent
whole-profile layer without turning Watchtower into a wrapper around another
desktop application?

## Executive conclusion

Yes. ADR-0003 selects a **SQLCipher-led logical vault**.

This is not “SQLCipher only” in the narrow sense of encrypting Joplin's existing
`database.sqlite` while leaving every other path unchanged. The proposed
architecture makes SQLCipher the canonical encrypted store for notes, metadata,
history, search, settings, plugin persistence and bounded attachment BLOBs.
Content-bearing automatic files are eliminated, redirected into the encrypted
store, kept in memory, or created only as disclosed user-authorised plaintext
egress.

The retired Watchtower prototype already proved the two highest-risk parts of
this approach on packaged Windows Electron:

- a current N-API SQLCipher binding could create, close, reopen, back up and
  integrity-check an encrypted database; and
- SQLCipher BLOB attachments up to 100 MiB met the accepted performance and
  memory budgets with zero plaintext-canary matches in the controlled root.

The Joplin-specific issue #8 prototype then passed the current schema 49
migration, 100 MiB BLOB persistence, wrong-key rejection, encrypted
export/restore, committed and in-flight forced-termination cases, schema 48 to
49 upgrade, Electron 40.8.3 loading, and directory packaging. Its controlled
database, WAL, SHM, journal, backup, and crash-recovery scans found zero
plaintext canary matches. The evidence is recorded in
[the issue #8 proof](../evidence/issue-8-sqlcipher-joplin-architecture-proof.md).

Cryptomator is actively maintained and is the strongest transparent-filesystem
alternative examined. It does not, however, remove the product-integration
burden. Its core is Java, and transparent desktop mounting uses WinFsp on
Windows, macFUSE/FUSE on macOS, and FUSE on Linux, with WebDAV as a fallback.
Embedding it would therefore add a JVM/sidecar plus platform mount integrations
and require an independent SQLite locking, memory-mapping, crash and packaging
qualification. Official Cryptomator material does not claim that arbitrary
SQLite workloads are a supported correctness target.

VeraCrypt is not abandoned: version 1.26.29 was released on 2026-06-09. It is
nevertheless removed from the Watchtower prototype set because it would add an
independent mounted-volume product and driver lifecycle that does not fit the
required seamless ownership model.

## Current support and distribution facts

### SQLCipher

- SQLCipher is maintained by Zetetic. Core release 4.16.0 was published on
  2026-05-12. It is based on SQLite, encrypts complete database pages, supports
  raw 256-bit key material, and maintains cross-platform database compatibility
  within a major format version.
  ([SQLCipher repository](https://github.com/sqlcipher/sqlcipher),
  [SQLCipher API](https://www.zetetic.net/sqlcipher/sqlcipher-api/))
- Community Edition uses a BSD-style licence and requires user-accessible
  attribution. Zetetic also sells Commercial and Enterprise distributions with
  supported packages and private support.
  ([Community Edition](https://www.zetetic.net/sqlcipher/community/),
  [licensing](https://www.zetetic.net/sqlcipher/license/),
  [support](https://www.zetetic.net/sqlcipher/support/))
- Joplin v3.6.15 currently depends on `sqlite3` 5.1.6 and opens the desktop
  database through the small `DatabaseDriverNode` seam. The upstream
  `node-sqlite3` project now describes itself as unmaintained, even though it
  documents custom SQLCipher/Electron builds. Watchtower should therefore not
  make a new native-security dependency by merely rebuilding that abandoned
  binding.
  ([Joplin driver](../../packages/lib/database-driver-node.js),
  [node-sqlite3](https://github.com/TryGhost/node-sqlite3))
- `@signalapp/sqlcipher` is an actively released N-API binding with Windows,
  macOS and Linux binaries. Version 3.3.9 was released on 2026-06-18. It is
  AGPL-3.0, matching the source-availability direction already imposed on the
  downstream Joplin client; exact compatibility and Corresponding Source
  handling still belong in release legal review.
  ([Signal binding](https://github.com/signalapp/node-sqlcipher),
  [release assets](https://github.com/signalapp/node-sqlcipher/releases/tag/v3.3.9))

### Compatibility finding from the Joplin prototype

The stock Signal 3.3.9 Windows prebuild loads correctly and reports SQLCipher
4.10.0 over SQLite 3.50.4. It is not, however, a literal drop-in replacement
for Joplin's current SQLite build:

- it is compiled with `SQLITE_DQS=0`, while Joplin still contains
  double-quoted string literals in schema and runtime SQL; and
- it enables FTS5 but not FTS3/FTS4, while Joplin v3.6.15 migrations and search
  still require FTS4.

The first unmodified migration run reached the accepted FTS fallback at schema
18, but a later migration then failed because `notes_normalized` had never been
created. That rules out shipping the stock Signal binary unchanged.

Signal's binding is still the strongest Windows-first candidate because its
source and release workflow already build N-API binaries for Windows, macOS and
Linux. The prototype is therefore testing a pinned-source compatibility build
that changes only the SQLite compile options to `SQLITE_DQS=3` and enables
FTS3/FTS4 alongside Signal's existing FTS5 support. Production adoption would
require Watchtower-owned reproducible prebuilds, published Corresponding Source,
build provenance and a monitored update path from Signal and Zetetic. Migrating
Joplin's complete search implementation to FTS5 remains a possible later
upstream-aligned project, not a prerequisite for local encryption.

### Cryptomator

- Cryptomator desktop 1.19.3 was released on 2026-06-29. Its `cryptofs` library
  2.10.0 was released on 2026-03-05. It is actively maintained, not a legacy
  project.
  ([Cryptomator desktop](https://github.com/cryptomator/cryptomator),
  [cryptofs](https://github.com/cryptomator/cryptofs))
- `cryptofs` is a Java NIO filesystem provider. The desktop build currently
  requires a JDK and bundles OS-specific dependencies. The library is AGPL-3.0
  for FOSS use and also has a commercial licence.
  ([cryptofs README](https://github.com/cryptomator/cryptofs),
  [desktop build](https://github.com/cryptomator/cryptomator))
- Transparent mounting uses WinFsp on Windows and FUSE-family integrations on
  macOS/Linux. WinFsp is installed with Cryptomator's Windows EXE distribution.
  WebDAV is the cross-platform fallback.
  ([Cryptomator volume types](https://docs.cryptomator.org/desktop/volume-type/),
  [security architecture](https://docs.cryptomator.org/security/architecture/))
- Cryptomator encrypts filenames, directory structure and file contents using a
  documented authenticated chunk format. That is strong evidence for encrypted
  file storage, but not evidence that Joplin's SQLite, WAL/SHM, file locking,
  memory mapping and forced-termination patterns are production-safe through
  every mount adapter.
  ([vault cryptography](https://docs.cryptomator.org/security/vault/))

## What SQLCipher protects in the existing Joplin database

Encrypting Joplin's database correctly protects its most concentrated and
sensitive data:

- note titles and bodies;
- notebook and tag names;
- note history and pre-change item copies;
- FTS/search copies;
- OCR text and resource metadata;
- semantic-search chunks and embeddings;
- conflict and sync-base note copies;
- item and database-backed plugin settings;
- sync state, URLs and other database settings;
- E2EE master-key records and credential fallback material; and
- SQLite journal/WAL/temp page contents when SQLCipher is compiled and
  configured correctly.

The complete source-backed database inventory is in
[the existing plaintext-profile report](joplin-local-plaintext-profile-and-storage-paths.md#what-databasesqlite-exposes).

## What a literal database swap would not protect

| Existing artifact | Likely sensitivity | Required SQLCipher-led treatment |
|---|---|---|
| `resources/<id>.<ext>` | Full attachment bytes; filenames/MIME are often sensitive | Store bounded attachment content as encrypted BLOBs and route preview/sync/export through one resource-content module |
| `settings.json` and invalid `.bak` copies | Sync endpoints, usernames, paths, feature and plugin settings | Split a minimal non-secret bootstrap manifest from encrypted settings; do not retain sensitive JSON fallbacks |
| `profiles.json` | Profile names and usage metadata | Use opaque launcher identifiers, disable multi-profile for v1, or move names into encrypted metadata |
| `plugin-data/` | Arbitrary plugin-controlled user data | Curated plugins use encrypted settings/BLOB persistence; no unrestricted persistent plaintext directory |
| `tmp/`, imports, print intermediates | Notes, OCR text, rendered HTML and attachments | Use memory or encrypted staging; make export/external-open materialisation explicit and bounded |
| `edit-<note-id>.md` and edited-resource copies | Complete note or attachment plaintext | Treat as warned Explicit Plaintext Egress, or disable in v1 |
| Electron `internal/` | Cookies, storage and plugin/webview state | Prefer an ephemeral session; persist only reviewed encrypted values |
| logs and deletion reports | IDs, URLs, paths and potentially content-bearing errors | Structured allowlist logging with no content; encrypted diagnostic export only |
| stock Backup output | Complete recoverable notes, resources and settings | Disable stock Backup and use verified SQLCipher export/encrypted backup |
| crash reports/minidumps | Log tail, paths and possible process memory | Disable content attachment/upload; document OS dump/pagefile limitations |
| user-selected exports and printing | Deliberate complete plaintext copies | Preserve only as explicit warned user action |

SQLCipher therefore cannot be treated as a one-line library substitution. It can
be the single cryptographic persistence boundary only if Watchtower also changes
the listed persistence behaviours.

## Existing Watchtower proof that should be reused

The retired standalone prototype used `@signalapp/sqlcipher` in an Electron
utility process and stored attachments as SQLCipher BLOBs.

At its 100 MiB decision point on a Windows x64 Intel i7-8665U laptop:

| Operation | Measured result |
|---|---:|
| Import | 825.368 ms |
| In-memory preview and hash | 720.748 ms |
| Encrypted backup | 1,288.693 ms |
| Reopen, restore and hash | 752.778 ms |
| Peak process RSS | 524.2 MiB |
| Plaintext canary matches | 0 |

The 500 MiB profile also completed, but peak RSS reached 2,180.4 MiB. The
accepted decision was therefore a user-visible 100 MiB v1 attachment limit.

Primary local evidence:

- [SQLCipher packaging proof](https://github.com/campbellmcgregor/watchtower-one-legacy/blob/main/docs/adr/0001-electron-sqlcipher-packaging-proof.md)
- [SQLCipher BLOB attachment decision](https://github.com/campbellmcgregor/watchtower-one-legacy/blob/main/docs/adr/0004-sqlcipher-blob-attachment-proof.md)
- [Encrypted attachment evidence](https://github.com/campbellmcgregor/watchtower-one-legacy/blob/main/docs/evidence/issue-4-encrypted-attachment-proof.md)

These results do not prove that Joplin's resource call sites have already been
adapted. They prove that the underlying storage, packaging, backup, preview and
bounded-size model is viable enough to prototype against Joplin rather than
starting with a new container dependency.

## Proposed security promise

The SQLCipher-led prototype should test this narrower, user-meaningful promise:

> When Watchtower One is locked or closed, notes, titles, notebook/tag names,
> histories, search projections, attachments, sensitive settings, credentials,
> plugin user data and automatic backups are encrypted at rest. Watchtower does
> not silently create content-bearing plaintext files.

Permitted plaintext should be limited to:

- Watchtower/Joplin binaries and signed curated plugin packages;
- an opaque vault identifier and format/version bootstrap;
- process lock and update markers;
- explicitly reviewed non-content appearance/layout configuration, if retaining
  it outside the encrypted store is necessary;
- reconstructible code/model caches proven not to contain user content; and
- sanitised operational diagnostics.

The promise does not protect plaintext deliberately exported to another
application, RAM while unlocked, OS pagefile/hibernation/crash dumps, antivirus
quarantine, thumbnail databases or another process already controlling the
user's unlocked session. Those are explicit threat-model limits, not reasons to
leave application-owned content plaintext.

## Recommended issue #8 prototype

Prototype the SQLCipher-led logical vault before any mounted filesystem:

1. Replace the desktop database adapter with `@signalapp/sqlcipher` behind the
   existing database-driver seam and require a raw Local Vault Key before the
   first query or migration.
2. Add a Watchtower resource-content module backed by a SQLCipher BLOB table.
   Route one representative note attachment through import, renderer preview,
   sync representation, export and deletion without a persistent plaintext
   resource file.
3. Move one sensitive setting and one curated-plugin persistence value into the
   encrypted database while retaining only an opaque bootstrap manifest.
4. Run packaged clean-start and note/resource/plugin canaries, then force
   termination during database and BLOB writes.
5. Re-run the existing 1/25/100/500 MiB attachment benchmark and enforce the
   previously justified 100 MiB limit unless new measurements support a change.
6. Record every remaining plaintext path as public metadata, reconstructible
   cache, explicit egress, defect or OS limitation.

Keep Cryptomator as the fallback prototype only if Joplin's resource and plugin
file assumptions cannot be isolated behind deep modules without pervasive
downstream patching.

## Production follow-ups

The architecture is selected. Production implementation must still resolve:

- upgrading the proven SQLCipher 4.10.0 core or making a separately reviewed
  supported-package decision;
- whether attachment BLOB access can remain responsive at Joplin's real preview,
  OCR and sync seams with a 100 MiB limit;
- whether v1 disables multi-profile support or introduces encrypted root
  metadata;
- whether curated-plugin persistence can be constrained to encrypted interfaces;
  and
- carrying the accepted logical user-data promise into implementation and
  release acceptance criteria.
