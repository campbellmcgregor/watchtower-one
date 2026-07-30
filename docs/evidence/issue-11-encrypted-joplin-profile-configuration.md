# Issue 11 encrypted Joplin profile configuration evidence

Date: 2026-07-30

## Result

Watchtower now routes Joplin's profile configuration through the unlocked
encrypted private-data store. Profile names, the active profile identifier,
and the profile list are stored under the `settings/profiles` private-data key
instead of a plaintext `profiles.json` file.

The existing `loadProfileConfig`, migration, validation, and
`saveProfileConfig` APIs remain unchanged for their callers. Watchtower
supplies a `ProfileConfigStorage` binding before `initProfile` in both the
Electron main process and the Joplin application process. This ordering lets
Joplin select the active profile without first reading user-derived data from
the public root-profile directory.

Stock Joplin remains compatible: when no Watchtower profile binding is
supplied, profile configuration continues to use the filesystem path passed to
the existing APIs. Adding, switching, and deleting profiles continue through
those APIs and therefore automatically use the configured encrypted backend.

Malformed encrypted profile configuration remains fail-closed through Joplin's
existing parsing and validation errors. A missing encrypted value produces
Joplin's default profile configuration; it does not fall back to a plaintext
copy.

## Verification

Focused tests prove:

- profile configuration round-trips through supplied private storage while the
  legacy path argument remains unused;
- the private-data adapter stores UTF-8 configuration under
  `settings/profiles`;
- `initProfile` selects the encrypted active profile before resolving its
  directory;
- stock filesystem behavior remains covered by the existing Joplin tests.

The production encrypted Joplin runtime remains deliberately disabled while
logs, lock files, Electron window state, and temporary/runtime paths still need
their encrypted or ephemeral bindings.
