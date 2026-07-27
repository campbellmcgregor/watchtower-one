# Issue 11 Joplin renderer profile transport evidence

<!-- cspell:ignore handoffs -->

Date: 2026-07-27

## Result: fail-closed renderer transport contract, issue remains open

The trusted Electron main-process bridge now has a controlled path for the
existing vault-scoped Joplin database and resource binding into the
content-bearing renderer. The renderer bootstrap requires that binding and
supplies it to `BaseApplication.start`; it does not permit the stock database
or resource fallback when the binding is absent.

Only `ProfileStorageBinding` crosses this seam. It contains the logical Joplin
database driver/name and encrypted resource filesystem. The Local Vault Key,
derived SQLCipher key, vault key ring, private-profile storage, and vault
credential do not enter the renderer transport interface.

This is not a renderer sandbox. The trusted Joplin renderer already has Node
filesystem authority, and its resource filesystem retains the stock external
file operations needed for resource import and export. Vault Session
capabilities gate canonical encrypted database and resource-store access; they
do not claim to remove the renderer's existing operating-system file access.

`joplinMain` is now a controlled entrypoint that accepts the encrypted binding
instead of performing eager startup when imported. It publishes the binding
before creating the Joplin window and rejects a missing binding before any
entrypoint side effect. When this entrypoint is selected, the renderer cannot
reach `BaseApplication.start` before the main process has supplied authorised
profile storage.

## Verification

The public application-bootstrap test proves:

- a renderer with no encrypted profile binding rejects startup before invoking
  Joplin; and
- the production `Bridge` class with an encrypted binding passes that exact
  binding and the original process arguments to Joplin startup.

Desktop typechecking verifies the production bridge, controlled main
entrypoint, renderer bootstrap, and existing Joplin `StartOptions` agree on the
transport interface.

## Deliberate handoffs

Issue #11 remains open. This slice does not make `main.ts` user-operable and
does not yet:

- select the controlled `joplinMain` entrypoint from the production vault
  bootstrap because the pre-unlock create, recovery, and unlock interface is
  not connected yet;
- replace stock root-profile settings, plugin data, cache, logs, temporary
  files, Electron state, or crash paths;
- route sensitive plugin persistence through `PrivateProfileData`; or
- prove renderer shutdown and restart against the production Electron process
  tree.

The controlled entrypoint must not be selected as a release startup path until
those persistence paths and lifecycle handoffs are implemented and traced.
