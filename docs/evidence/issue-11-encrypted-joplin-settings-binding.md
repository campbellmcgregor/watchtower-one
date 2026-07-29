# Issue 11 encrypted Joplin settings binding evidence

<!-- cspell:ignore handoff subprofiles -->

Date: 2026-07-29

## Result: root and profile settings use encrypted private data

Joplin's shared `ProfileStorageBinding` now carries capability-scoped private
settings storage alongside the encrypted database and resource filesystem.
When that binding is present, `Setting.fileHandler` and
`Setting.rootFileHandler` use `PrivateProfileData` records inside the SQLCipher
profile instead of `<profile>/settings.json` or
`<root-profile>/settings.json`.

The handlers preserve Joplin's JSON schema, global/local split, merge behavior,
and reset lifecycle. Default-profile and root settings use distinct private
addresses, while subprofiles receive stable profile-specific addresses.
Malformed encrypted settings fail closed; they are not moved into a plaintext
backup file.

The controlled main-process entrypoint reads `autoUploadCrashDumps` from the
same encrypted root settings record. It no longer probes or parses plaintext
root `settings.json` before creating the Joplin wrapper.

Stock Joplin remains compatible. When no `ProfileStorageBinding` is supplied,
the existing filesystem-backed settings handlers and invalid-file backup
behavior remain unchanged.

## Verification

Public-seam tests prove:

- supplied database, resource, and private settings storage is selected without
  constructing stock profile storage;
- root and default-profile settings persist at distinct encrypted addresses;
- settings remain readable after the ordinary `Setting.reset()` lifecycle; and
- the main-process startup preference reader consumes private root settings.

Shared-library and desktop typechecking verify the storage binding across the
main process, trusted bridge, renderer startup, and Joplin `Setting` model.

## Deliberate failed-closed handoff

Issue #11 remains open and the production Joplin runtime loader remains
unavailable. This slice closes the two `settings.json` paths only. Stock startup
still reads or creates `profiles.json`, log and lock files, window state,
plugin/package data, cache and temporary files, backups, crash artifacts, and
other paths that have not yet been routed through encrypted or ephemeral
modules.

Those paths require focused adapters and runtime/forced-termination evidence
before production Joplin startup can be enabled.
