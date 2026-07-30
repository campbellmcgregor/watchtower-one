# Issue 11 ephemeral window state and public lock evidence

Date: 2026-07-30

## Result

Watchtower no longer uses Joplin's root-profile directory for Electron window
state or process locking.

Window geometry and maximize/full-screen behavior use a fresh in-memory state
keeper for each Watchtower application session. Moving or resizing the window
updates that keeper for the lifetime of the managed window, but a new session
starts from safe display-derived defaults. The Watchtower factory has no
persistent storage collaborator. Stock Joplin still uses
`electron-window-state` when no factory is supplied.

The Joplin single-instance lock is relocated to the dedicated
`<Watchtower user data>/runtime` directory prepared before Electron readiness.
Every current Watchtower invocation uses the same `vault.lock`, because
`--profile`, portable, and alternate-instance arguments do not yet select
separate encrypted vaults. Those arguments therefore cannot bypass
single-vault coordination. Joplin's `FileLocker` creates an empty file and
changes only its filesystem timestamps. This opaque coordination marker is
Reviewed Public Runtime State; it contains no profile name or path, note data,
resource data, credential, or window metadata.

The exact public runtime directory is created by the pre-profile host, carried
through `EncryptedJoplinProfileHost`, and supplied to `ElectronAppWrapper`.
Callers cannot silently fall back to Joplin's stock profile path because the
Watchtower profile binding requires this directory.

## Verification

Red-green tests at the desktop runtime-composition seam prove:

- the dedicated public runtime directory is prepared before Electron
  readiness and encrypted-profile startup;
- that exact directory crosses the capability-scoped profile binding;
- the exact `vault.lock` path crosses the encrypted profile binding so all
  current Watchtower modes coordinate access to the selected vault;
- moving and resizing a managed window changes only the current in-memory
  state;
- a new application session receives default window state rather than prior
  usage metadata; and
- the public process lock remains a zero-byte file while active.

Runtime tracing under Issue #7 must still confirm that the packaged application
creates only the reviewed empty lock in this directory.

Issue #11 remains open while plugin files, caches, and general
temporary/editor paths still require encrypted or ephemeral bindings.
