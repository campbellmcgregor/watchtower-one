# Issues 13 and 15 Vault Credential Lifecycle evidence

Date: 2026-08-03

## Result

The trusted desktop main-process vault module now composes passphrase policy,
the Vault Key Envelope, and its atomic store through a production credential
lifecycle. It supports:

- create followed by mandatory full Recovery Secret confirmation;
- passphrase unlock;
- Recovery Secret unlock followed by a new passphrase;
- current-passphrase-authorised passphrase change;
- current-passphrase-authorised Recovery Secret replacement followed by
  mandatory full confirmation; and
- strict missing, corrupt, stale-attempt, wrong-credential, policy-rejection,
  and failed-closed results.

Credential changes rewrap the existing Local Vault Key. They increment the
active wrapper generation but do not rewrite SQLCipher content, resources, or
other encrypted profile data. The published generation-one compatibility
vector remains valid.

The pending file is a journal record, never an alternate profile or plaintext
fallback. After flushing, the lifecycle reopens and authenticates the actual
pending bytes with the new credential before atomic activation. Restart reads
only the committed envelope. Corrupt committed state cannot be treated as a
missing vault and cannot trigger creation.

## Forced-termination evidence

Tests launch a real child process and terminate it at these barriers:

- before initial Recovery Secret confirmation;
- after the initial pending envelope is flushed;
- after the initial envelope is atomically committed;
- after a recovered passphrase replacement is flushed;
- after a recovered passphrase replacement is committed;
- after a replacement Recovery Secret wrapper is flushed; and
- after a replacement Recovery Secret wrapper is committed.

At every barrier, a fresh lifecycle instance observes exactly the old
committed generation or the complete new generation. The tests prove there is
always one working passphrase after an interrupted passphrase rewrap, a
replacement Recovery Secret is not active before durable commit, and no
persisted artifact contains the test passphrase.

The forced-termination worker generates and retains Recovery Secrets inside
the child process. Raw credentials are not passed through command-line
arguments, environment variables, or IPC.

## Deliberate boundaries

This is lifecycle and filesystem evidence at the production vault seam. It
does not claim physical secure erasure on SSDs.

The packaged forced-termination and corrupt-envelope cases are recorded in
`issue-13-packaged-crash-consistency.md`. UI progress/cancellation and wiring
credential replacement commands into the pre-unlock host remain Issue #15
work. Hard lock/close remains owned by the pre-profile process lifecycle rather
than by the credential-envelope module. Rejecting restoration of a previously copied,
otherwise authentic envelope requires the independent retirement marker in
authenticated encrypted metadata; the envelope file alone cannot prove
freshness after an offline rollback.
