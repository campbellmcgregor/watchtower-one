# Issue #8 SQLCipher/Joplin architecture proof

<!-- cspell:ignore signalapp Sqlcipher -->

- Date: 2026-07-23
- Prototype branch: `codex/issue-8-encryption-architecture-prototype`
- Completed disposable harness commit: `aaa15d181`
- Joplin baseline: v3.6.15
- Decision point: 100 MiB attachment
- Result: pass with production prerequisites

## Binding compatibility

The stock `@signalapp/sqlcipher` 3.3.9 Windows prebuild loaded successfully but
could not run Joplin's complete migration chain. Signal deliberately compiles
with `SQLITE_DQS=0` and FTS5 only, while current Joplin still needs
double-quoted SQL compatibility and FTS3/FTS4.

The prototype rebuilt Signal's immutable v3.3.9 source commit
`14e0f5e74e6bcd26d3462b48546473de5fd3a1fc` with only these compatibility
changes:

- `SQLITE_DQS=3`;
- `SQLITE_ENABLE_FTS3`;
- `SQLITE_ENABLE_FTS3_PARENTHESIS`; and
- `SQLITE_ENABLE_FTS4`.

Signal's existing FTS5 and SQLCipher options remained enabled.

The corrected Windows x64 build and compile-option verification passed in
[GitHub Actions run 30025458251](https://github.com/campbellmcgregor/watchtower-one/actions/runs/30025458251).

| Artifact fact | Value |
|---|---|
| Binding | `@signalapp/sqlcipher` 3.3.9 compatible rebuild |
| SQLCipher | 4.10.0 Community |
| SQLite | 3.50.4 |
| Windows x64 N-API binary size | 2,178,560 bytes |
| SHA-256 | `4482644E4DB61926A2C04173DBE1CF86C8D3C7B54323D9F61E6CFC22070F0D0C` |
| Missing required compile options | none |

## Joplin logical-vault proof

One command exercised a fresh encrypted profile through Joplin's compiled
`JoplinDatabase` and the prototype SQLCipher adapter:

```powershell
$env:WATCHTOWER_SQLCIPHER_PREBUILD_ROOT = 'C:\path\to\verified-artifact'
corepack yarn watchtowerPrototypeSqlcipher --attachment-mib 100
```

| Check | Result |
|---|---:|
| Fresh Joplin migration | schema 49, pass |
| Migration time | 137 ms |
| Note persistence after close/reopen | pass |
| Sensitive database setting persistence | pass |
| Curated-plugin value persistence | pass |
| Attachment storage class | SQLite `blob`, pass |
| Attachment size | 104,857,600 bytes |
| Attachment insert | 3,466 ms |
| Reopen and verification | 4,128 ms |
| Wrong-key rejection | pass |
| Transaction rollback | pass |
| Encrypted export, reopen and content verification | pass |
| Backup wrong-key rejection and integrity | pass |
| Committed write after forced termination | pass |
| In-flight write rollback after forced termination | pass |
| Integrity after both forced terminations | pass |
| Encrypted schema 48 to 49 upgrade | pass |
| Plaintext canary matches in database/WAL/SHM/journal | 0 |
| Plaintext canary matches in encrypted backup | 0 |
| Plaintext canary matches after forced termination | 0 |
| Prototype key written to disk | no |

Joplin's schema-field refresh accepts only its historical `INT`, `TEXT`, and
`NUMERIC` declarations. The prototype therefore declares the resource-content
column as `TEXT` but binds a binary value and verifies SQLite reports the actual
storage class as `blob`. This keeps the Watchtower table compatible with Joplin
schema upgrades without changing Joplin's global field registry.

The SQLCipher error messages emitted during the proof are expected negative-test
evidence from deliberately attempting to open the databases with a wrong key.

## Electron and directory-package proof

The same verified N-API binary loaded under Joplin's Electron runtime and under
a disposable directory-packaged Electron application.

| Check | Development runtime | Directory package |
|---|---:|---:|
| Electron | 40.8.3 | 40.8.3 |
| Node | 24.14.0 | 24.14.0 |
| `app.isPackaged` | not asserted | `true` |
| SQLCipher | 4.10.0 Community | 4.10.0 Community |
| DQS/FTS compatibility | pass | pass |
| Close/reopen | pass | pass |
| Raw canary matches | 0 | 0 |
| Exit code | 0 | 0 |

The packaged proof used a production-style renamed executable and loaded the
native binary from the packaged `resources` tree, outside the source repository.

## What this proves

- SQLCipher can be the canonical encrypted store behind Joplin's existing
  desktop database-driver seam.
- Current Joplin migrations and FTS4 search schema remain usable without a
  search-engine rewrite.
- Notes, settings, curated-plugin persistence, and bounded attachment BLOBs can
  share one encrypted logical store.
- SQLCipher export, crash recovery, the latest schema upgrade, Electron loading,
  and directory packaging are feasible on the Windows baseline.

## What remains production work

- Replace the prototype key with the accepted Local Vault Key hierarchy,
  passphrase wrapping, recovery, rotation, and zeroisation design.
- Build and publish reproducible Watchtower compatibility binaries for every
  shipped architecture, with exact Corresponding Source and provenance.
- Upgrade the bundled SQLCipher core from 4.10.0 or document and accept a
  supported alternative before release.
- Route Joplin resource preview, OCR, sync, import, export, and deletion through
  one Resource Content module; the prototype exercises persistence, not every
  call site.
- Move sensitive JSON settings, plugin files, backup, logs, Electron state,
  temporary files, and external-edit paths behind encrypted modules or Explicit
  Plaintext Egress.
- Re-run full Joplin UI, sync E2EE, antivirus, installer, upstream-tag upgrade,
  and runtime plaintext-trace qualification.
- Build and qualify macOS and Linux adapters before claiming those platforms.

This is sufficient to select the architecture. It is not sufficient to ship the
encryption implementation.

The harness commit and its branch are retained as throwaway design evidence and
must not be merged into the production branch.
