# Issue 11: encrypted plugin host filesystem evidence

## Implemented boundary

Watchtower's encrypted profile mode now replaces the persistent plugin data
directory exposed through `joplin.plugins.dataDir` with an operating-system
independent virtual root. Calls made through the plugin host's supported
`fs-extra` interface are routed to a plugin-scoped namespace in the Canonical
Encrypted Store.

- The plugin receives `/watchtower-plugin-data/<plugin-id>`, not a host path.
- File bytes, empty-directory markers, and plugin settings remain in SQLCipher.
- The host selects the storage namespace from the registered plugin identity;
  a request cannot select another plugin's namespace.
- Electron IPC routing binds a claimed plugin identity to its registered
  `webContents` sender before forwarding a message.
- Stock Joplin behavior remains available when the encrypted profile binding is
  absent, preserving the downstream compatibility seam.

The adapter currently provides the asynchronous operations required by the
curated plugin seam: `ensureDir`, `outputFile`, `pathExists`, `readFile`,
`readJson`, directory listing, `remove`, `stat`, `writeFile`, and `writeJson`.
Native plugin SQLite is rejected in encrypted mode until a SQLCipher-backed
plugin database adapter is available; it cannot fall through to a plaintext
database beside the virtual root.

## Security boundary

This is encrypted persistence, not a sandbox. A Curated Plugin remains trusted
profile-capable code, and its admission, signing, revocation, and runtime
plaintext tracing remain separate release requirements. Persistent plugin
package extraction and other cache or temporary paths also remain separate
Issue 11 slices until they are proven ephemeral, reconstructible, or encrypted.

## Automated evidence

- `EncryptedPluginDataFileSystem.test.ts` proves plugin-scoped persistence,
  directory semantics, metadata, and removal without an operating-system path.
- `PluginDataFsProxy.test.ts` proves path confinement and the supported
  asynchronous `fs-extra` surface presented inside the plugin process.
- `PluginMessageRouter.test.ts` proves that one plugin cannot claim another
  plugin's IPC identity.
- `PluginModulePolicy.test.ts` proves native plugin SQLite fails closed in
  encrypted mode while the stock compatibility seam remains unchanged.
- `PluginRunner.test.ts` proves encrypted-mode selection and host-side binding
  to the running plugin identity.
- The Watchtower encrypted-profile proof workflow includes all four seams on
  Windows x64 with the pinned SQLCipher binding.
