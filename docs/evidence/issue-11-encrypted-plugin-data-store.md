# Issue 11 encrypted plugin-data store evidence

<!-- cspell:ignore POSIX -->

Date: 2026-07-31

## Result

The Canonical Encrypted Store now supports hierarchical curated-plugin data
keys. Records are separated into `plugin:<id>` namespaces, and file-like keys
use normalized forward-slash relative paths such as
`indexes/search/state.json`.

Plugin data remains inside the SQLCipher-backed
`watchtower_private_profile_data` table. The storage boundary rejects absolute,
empty, dot, parent-traversal, backslash, and otherwise invalid path segments.
Listing one namespace does not include keys stored under another namespace.

## Verification

The red-green test at the `PrivateProfileData` seam proves:

- nested plugin-data keys round-trip through the encrypted store;
- listing is deterministic and separated by plugin identifier;
- removal updates the namespace;
- parent traversal is rejected before storage access; and
- Windows drive-absolute and POSIX absolute keys are rejected.

The native SQLCipher profile proof also writes a nested plugin-data canary,
closes and reopens the vault, reads and lists the canary through the public
storage interface, and scans the database artifacts to ensure the plaintext
canary is absent.

## Remaining boundary

This slice deliberately does not return an operating-system path to a plugin.
Joplin's stock `joplin.plugins.dataDir()` and plugin-provided `fs-extra`
capabilities are still path-based and must be adapted to this encrypted store
before Watchtower enables plugins that depend on them.

The storage interface accepts a namespace explicitly; it does not authenticate
a plugin caller. The later plugin-host adapter must bind one admitted plugin
identity to one namespace and expose no cross-plugin scope selector.

Issue #11 remains open for that plugin-host adapter, plugin package extraction,
and the remaining general cache and temporary paths. Plugin admission and
outside-path runtime tracing remain Issues #18 and #19.
