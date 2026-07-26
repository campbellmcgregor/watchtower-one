# Issue 15 Vault Key Envelope core evidence

<!-- cspell:ignore Argon Argon2id ciphertexts handoffs HKDF -->

Date: 2026-07-26

## Result: first credential-lifecycle slice, issue remains open

The trusted desktop main-process vault boundary can now create a versioned
Vault Key Envelope around a random 256-bit Local Vault Key. The envelope
contains independent authenticated passphrase and Recovery Secret wrappers.
It never serialises the passphrase, Recovery Secret, Local Vault Key, wrapper
keys, or derived storage keys.

The implementation uses cryptography supplied by the pinned Node 24 runtime in
both the development environment and Electron 40:

- Argon2id version 1.3 for passphrase derivation;
- HKDF-SHA-256 for wrapper and storage-domain separation;
- AES-256-GCM for authenticated Local Vault Key wrappers;
- 128-bit random salts, 96-bit random nonces, and a 256-bit random Local Vault
  Key; and
- a 256-bit random, Crockford Base32 Recovery Secret with a versioned checksum.

No additional native cryptography dependency was introduced.

## Public seam and verification

`VaultKeyEnvelope` exposes only:

- creation from a passphrase and accepted Argon2id parameters;
- bounded parsing and non-content inspection of serialised Public Bootstrap
  State;
- independent passphrase and Recovery Secret unlock;
- callback-scoped access to purpose-derived Vault Session keys; and
- explicit key-ring disposal.

Focused public-seam tests prove:

- repeated passphrase unlocks derive a stable SQLCipher key;
- resource and SQLCipher keys are domain-separated;
- the generated Recovery Secret independently opens the same hierarchy;
- persisted public state round-trips through the bounded parser;
- pre-unlock inspection reveals only approved technical metadata;
- wrong passphrase and Recovery Secret attempts return the same public error;
- excessive Argon2 resource requests are rejected before derivation;
- authenticated ciphertext corruption fails closed; and
- disposed Vault Session keys cannot be used.

The implementation validates format, version, algorithm, generation, binary
length, canonical encoding, and Argon2 resource bounds before unlock. Owned
passphrase, Recovery Secret, root-key, wrapper-key, and derived-key buffers are
overwritten at their bounded lifetime boundary. JavaScript credential strings
remain subject to ADR-0005's honest runtime-memory limitation.

## Deliberate handoffs

Issue #15 remains open. This slice does not yet:

- calibrate the production five-second/256 MiB Argon2id creation policy;
- implement the local compromised-password blocklist;
- present or fully confirm the Recovery Secret in a user interface;
- persist the public envelope through crash-consistent A/B generations;
- change passphrases or replace Recovery Secrets;
- implement forced-termination-safe wrapper rotation or rollback rejection;
- connect production create, unlock, or recovery operations to the
  pre-profile bootstrap;
- provide page-locked native key custody beyond bounded Node buffers; or
- implement hard lock, credential deletion, vault migration, or encrypted
  backup integration.

Those are subsequent issue #15 slices. Production startup remains failed closed
until the credential lifecycle is complete and runtime-traced.
