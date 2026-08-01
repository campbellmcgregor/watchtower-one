# Issue 11: public plugin code store evidence

## Implemented boundary

The encrypted profile binding now supplies distinct public directories for
installed plugin packages and their deterministic extracted executable cache.
Watchtower derives both beneath `code/plugins` in its application data root,
structurally separate from:

- the encrypted `vault` directory;
- Joplin's logical profile cache and temporary paths; and
- the lock-only `runtime` directory.

Stock Joplin keeps its existing package and cache paths when no encrypted
profile binding is supplied. In encrypted mode, `PluginService` extracts a
package only under the supplied Public Plugin Code Store and loads its manifest
and executable source from that location.

## Security boundary

This store is public because admitted plugin packages and executable assets are
code, not user data. It may not contain plugin settings, databases, logs,
content, or temporary working files. The distribution must keep ordinary
plugin installation disabled until Issue 18 enforces admission and signatures;
this slice does not make arbitrary plugin packages trusted. The encrypted
profile binding therefore disables arbitrary plugin installation, and the
shared plugin service rejects both repository downloads and manual package
installation before either can admit a package.

## Automated evidence

- `profileStorageBinding.test.ts` proves encrypted mode replaces the stock
  package and extraction-cache constants while refusing stock profile storage.
- `loadPlugins.test.ts` creates a real plugin package and proves extraction and
  loading occur from the supplied public code cache. It also proves repository
  and manual installation fail closed before downloading or reading an
  arbitrary package.
- `runWatchtowerElectronMain.test.ts` proves the code store is derived beside,
  rather than beneath, `vault` and `runtime`.
- The desktop `EncryptedJoplinProfileHost.test.ts` suite proves the paths cross
  the trusted main-to-renderer profile binding unchanged.
- The Windows SQLCipher workflow runs both the encrypted-profile proof and the
  library-level plugin code-path proof.
