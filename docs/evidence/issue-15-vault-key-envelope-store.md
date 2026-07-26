# Issue 15 Vault Key Envelope store evidence

<!-- cspell:ignore handoffs -->

Date: 2026-07-26

## Result: atomic initial-envelope persistence, issue remains open

The trusted desktop main-process vault module can now durably commit and reopen
the strictly parsed Public Bootstrap Vault Key Envelope. The
`VaultKeyEnvelopeStore` interface exposes only:

- `commit(publicState)` to validate, stage, flush, and atomically activate an
  envelope; and
- `loadCommitted()` to reopen only the bounded committed envelope.

The implementation writes a permission-restricted pending file, flushes its
contents, atomically renames it over the committed file, and requests a
directory flush where the platform supports directory handles. An interrupted
replacement leaves restart with either the prior committed envelope or the
complete replacement, never a partially parsed pending file. Temporary file
names and filesystem failures are not exposed through the public error.

The store refuses to replace a committed envelope with a different vault
identifier. A corrupt existing committed file therefore cannot be silently
overwritten as a new vault.

## Public-seam verification

Focused tests use a real temporary filesystem and prove:

- a committed envelope reopens through a new store instance and independently
  unlocks its SQLCipher domain key;
- a filesystem failure at atomic replacement preserves the prior committed
  envelope after restart; and
- an unrelated vault identity cannot replace the committed vault.

## Deliberate handoffs

Issue #15 remains open. This slice does not yet:

- persist and verify two wrapper generations during passphrase or Recovery
  Secret rotation;
- reject rollback against authenticated metadata in the Canonical Encrypted
  Store;
- confirm the initially displayed Recovery Secret;
- connect the envelope store to production pre-profile create, unlock, or
  recovery commands;
- calibrate the production Argon2id policy; or
- run packaged forced-termination and plaintext-trace evidence against a
  production credential flow.

Those capabilities require the credential lifecycle orchestrator and
pre-unlock interface, rather than additional methods on the envelope store.
