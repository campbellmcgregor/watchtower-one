# Issue 11 Joplin renderer profile transport evidence

<!-- cspell:ignore handoffs -->

Date: 2026-07-27

## Result: fail-closed renderer transport, issue remains open

The trusted Electron main-process bridge can now carry the existing
capability-scoped Joplin database and resource binding into the content-bearing
renderer. The renderer bootstrap requires that binding and supplies it to
`BaseApplication.start`; it does not permit the stock database or resource
fallback when the binding is absent.

Only `ProfileStorageBinding` crosses this seam. It contains the logical Joplin
database driver/name and encrypted resource filesystem. The Local Vault Key,
derived SQLCipher key, vault key ring, private-profile storage, and vault
credential do not enter the renderer transport interface.

`joplinMain` is now a controlled entrypoint that accepts the encrypted binding
instead of performing eager startup when imported. It publishes the binding
before creating the Joplin window. The renderer therefore cannot reach
`BaseApplication.start` before the main process has supplied authorised profile
storage.

## Verification

The public application-bootstrap test proves:

- a renderer with no encrypted profile binding rejects startup before invoking
  Joplin; and
- a renderer with an encrypted binding passes that exact binding and the
  original process arguments to Joplin startup.

Desktop typechecking verifies the production bridge, controlled main
entrypoint, renderer bootstrap, and existing Joplin `StartOptions` agree on the
transport interface.

## Deliberate handoffs

Issue #11 remains open. This slice does not make `main.ts` user-operable and
does not yet:

- connect the pre-unlock create, recovery, and unlock interface to the
  controlled `joplinMain` entrypoint;
- replace stock root-profile settings, plugin data, cache, logs, temporary
  files, Electron state, or crash paths;
- route sensitive plugin persistence through `PrivateProfileData`; or
- prove renderer shutdown and restart against the production Electron process
  tree.

The controlled entrypoint must not be selected as a release startup path until
those persistence paths and lifecycle handoffs are implemented and traced.
