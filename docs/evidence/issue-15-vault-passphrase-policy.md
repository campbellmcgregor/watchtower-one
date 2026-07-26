# Issue 15 Vault Passphrase Policy evidence

<!-- cspell:ignore handoffs NCSC Pwned -->

Date: 2026-07-26

## Result: production creation policy, issue remains open

The trusted desktop main-process vault module now exposes a local-only
`VaultPassphrasePolicy` creation boundary. It:

- normalises the complete proposed passphrase to Unicode NFC;
- requires at least 12 Unicode code points without composition rules;
- checks an exact whole-passphrase digest against the pinned offline
  compromised-password blocklist;
- defaults to no memory profile: the caller must explicitly request either
  the 256 MiB `standard` profile or qualified 128 MiB constrained profile;
- calibrates four-lane Argon2id using random non-secret probe bytes;
- confirms the selected pass count is the highest measured count at or below
  the approximately five-second target, capped at 32; and
- returns a fresh parameter value so a caller cannot mutate the cached
  calibration used by later vault creation.

The Argon2id Node adapter is shared with `VaultKeyEnvelope`, keeping the
calibration and actual wrapper derivation on the same implementation boundary.
Unlock continues to use the immutable parameters stored in the envelope and
does not recalibrate.

## Offline blocklist provenance

The source is the NCSC-published top 100,000 passwords derived from Have I Been
Pwned, archived from the former official NCSC response on 2024-11-30. The
source response SHA-256 is:

`42b8ce15a02b1a22e72c1a35daa537ae1722a96373d6591e3f64a15a3a855c59`

The reproducible generator adds six Watchtower product-context entries,
normalises every entry to NFC, hashes with SHA-256, sorts and deduplicates the
first 96 digest bits, and emits 99,877 prefixes. Watchtower ships the resulting
1,198,524-byte binary artifact, not the plaintext corpus. Its SHA-256 is:

`5226b85302d67068c431b3857b06cb5aaafb098a909cc027a07492047eecb7be`

The adjacent JSON manifest pins the source, archive URL, counts, transform,
product-context entries, and output hash. A clean rebuild from the pinned
source produced the same output hash. Runtime policy performs no network
request and verifies the bundled artifact before use.

## Public-seam verification

Focused tests prove:

- exact compromised and Watchtower-context passphrases are rejected locally;
- substrings are not rejected;
- short passphrases fail while 128 Unicode code points are accepted;
- standard and explicitly qualified constrained profiles retain their fixed
  memory and lane parameters with bounded pass counts;
- unknown memory profiles fail closed;
- mutation of returned parameters cannot weaken cached calibration; and
- the refactored shared Argon2id adapter preserves the published envelope
  compatibility vector and independent credential behavior.

Typechecking, lint, spelling, ignored-build-file checks, downstream verification,
and deterministic blocklist reproduction also pass.

## Deliberate handoffs

Issue #15 remains open. This slice does not yet:

- connect policy, envelope and store through the production credential
  lifecycle orchestrator;
- confirm the initially displayed Recovery Secret;
- change passphrases or replace Recovery Secrets with two-generation
  interruption safety;
- implement session-only delays after failed passphrase attempts;
- connect pre-unlock progress and cancellation to the potentially multi-step
  calibration; or
- run packaged forced-termination and plaintext-trace evidence against the
  production credential flow.

Those are subsequent issue #15 slices. The low-level envelope seam still
accepts explicit parameters for compatibility vectors and focused tests;
production creation must enter through the policy-backed lifecycle seam.
