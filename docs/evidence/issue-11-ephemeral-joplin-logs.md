# Issue 11 ephemeral Joplin log evidence

Date: 2026-07-30

## Result

Watchtower now routes Joplin file-log targets into the unlocked profile's
session-scoped ephemeral artifact store. Ordinary renderer logs, main-process
logs, sync-debug logs, and clipper logs retain Joplin's existing `Logger`
callers, levels, and formatting without creating their stock plaintext files.

The `ProfileStorageBinding` carries a narrow append-only log filesystem. The
Watchtower adapter maps each requested log path to its filename and stores the
bytes under the `log` artifact category. The main process installs this sink
before constructing `ElectronAppWrapper`; `BaseApplication` installs it before
creating any renderer file-log target. Stock Joplin supplies no Watchtower
binding and retains its normal filesystem logger.

Each ephemeral log is bounded to 5 MiB and retains its newest valid UTF-8 data.
Incoming source text and retained byte ranges are bounded before encoding and
concatenation, so the adapter does not construct an unbounded encoded or
combined log buffer. During failed startup and application teardown, queued
log writes drain before the prior process logger is restored. The main-process
logger uses a target-scoped sink and does not replace the process-global
filesystem. The encrypted profile storage clears all ephemeral artifacts
during graceful close and forced termination. Watchtower skips stock rotating
log filesystem maintenance when this session sink is active because no durable
log file exists.

## Verification

Red-green tests at the public binding seam prove:

- unchanged Joplin file-log targets append multiple messages through the
  session-scoped artifact interface;
- Windows profile paths are reduced to non-path log keys;
- log artifacts remain in the `log` category;
- each logical log remains bounded while retaining its newest entries; and
- bounded suffixes remain valid UTF-8;
- teardown drains the session sink and restores the prior process logger; and
- stock profile storage resolution remains available without the Watchtower
  binding.

This slice does not define persistent diagnostic export. Any user-directed
diagnostic materialisation and sanitisation belongs to Issue #12.

The production encrypted Joplin runtime remains deliberately disabled while
lock files, Electron window state, and general temporary/runtime paths still
need reviewed public or ephemeral bindings.
