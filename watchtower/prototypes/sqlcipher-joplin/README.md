# SQLCipher/Joplin architecture prototype

<!-- cspell:ignore Sqlcipher -->

> Disposable prototype. Do not merge this directory into a production branch.

This answers one question: can Watchtower One run the current Joplin database
migrations through a maintained SQLCipher binding while keeping representative
notes, settings, plugin values, and attachment bytes inside one encrypted
logical vault?

Run it from the repository root:

```powershell
corepack yarn watchtowerPrototypeSqlcipher
```

The command creates a uniquely named `WatchtowerOne-SQLCipher-PROTOTYPE-WIPE-ME`
directory beneath the operating system temporary directory. It never opens a
real Joplin or Watchtower profile. The randomly generated prototype key exists
only for the duration of the process and is not written to disk.

The proof passes only when:

- the current Joplin schema migrates successfully;
- the database rejects a different key;
- note, sensitive setting, plugin value, and attachment BLOB survive reopen;
- a rolled-back value is absent;
- no plaintext canary occurs in the database, WAL, SHM, or journal files.

The prototype intentionally does not yet prove application UI integration,
streaming large BLOB reads, keychain-backed key wrapping, crash recovery,
backup/restore, packaging, or upstream upgrades. Those measurements belong to
the next evidence slices if this seam passes.

## Binding compatibility discovered by the prototype

The stock Signal prebuild is deliberately compiled with `SQLITE_DQS=0` and
FTS5 only. Current Joplin still requires double-quoted string compatibility and
FTS3/FTS4 during both schema migration and search. The prototype therefore
includes an isolated CI recipe that rebuilds the pinned Signal source with:

- `SQLITE_DQS=3`;
- `SQLITE_ENABLE_FTS3`;
- `SQLITE_ENABLE_FTS3_PARENTHESIS`;
- `SQLITE_ENABLE_FTS4`;
- Signal's existing FTS5 and SQLCipher options unchanged.

This is not a request to change Joplin search as part of the encryption work.
If this path is accepted, production must consume reproducible Watchtower
prebuilds from pinned Signal source, publish their source and build recipe, and
track Signal and SQLCipher security releases.
