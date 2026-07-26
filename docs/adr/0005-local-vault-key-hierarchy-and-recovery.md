# ADR-0005: Use independently wrapped, domain-separated Local Vault Keys

<!-- cspell:ignore Argon Argon2id ciphertexts DPAPI HKDF passphrases sqlcipher -->

- Status: Accepted
- Date: 2026-07-26
- Scope: Local key hierarchy, passphrase unlock, user-held recovery, and credential rotation
- Extends: ADR-0003 and ADR-0004

## Context

Watchtower One must unlock its local encrypted profile without a Watchtower
account or service. The local-at-rest key domain must remain independent of
Joplin Sync E2EE, support recovery from a forgotten passphrase, survive
interrupted credential changes, and expose no unencrypted fallback.

A passphrase is not suitable as the content-encryption key. It has
user-dependent entropy and must be processed by a memory-hard derivation
function. Conversely, a randomly generated recovery credential does not need a
password-stretching construction, but it must be printable, verifiable, and
kept entirely by the user.

The key hierarchy must also avoid reusing one cryptographic key across
SQLCipher, resource encryption, private application data, and metadata
authentication. Raw root keys cannot be passed through renderer JavaScript,
plugins, logs, command lines, environment variables, or serialised IPC.

## Decision

### Trust and recovery boundary

Watchtower has no recovery escrow, master key, account recovery, or remote
unlock path. Each vault is recoverable only with either:

- its user-chosen passphrase; or
- its app-generated, user-held Recovery Secret.

Losing both credentials permanently loses access. Watchtower must disclose this
during vault creation and recovery-secret rotation.

The first release supports one Watchtower Profile Vault per installation. A
new vault always receives new key material and a new Recovery Secret. An
encrypted backup of an existing vault retains that vault's wrappers, but the
Recovery Secret is never reusable as an account-wide credential.

### Root key and key schedule

Vault creation generates a 256-bit **Local Vault Key** from the operating
system's cryptographically secure random generator. The Local Vault Key never
directly encrypts application content and is never derived from the passphrase,
Recovery Secret, device identity, or Joplin Sync E2EE keys.

HKDF-SHA-256 derives versioned, purpose-specific 256-bit keys from the Local
Vault Key. Version 1 reserves distinct contexts for at least:

- `watchtower-one/v1/sqlcipher`;
- `watchtower-one/v1/resource-content`;
- `watchtower-one/v1/private-profile-data`; and
- `watchtower-one/v1/vault-metadata-authentication`.

The vault identifier participates in the derivation context. A key for one
purpose is never accepted by another purpose. New domains require a new,
reviewed context string; existing context strings are immutable.

Joplin Sync E2EE keys remain a separate hierarchy and are neither derived from
nor wrapped by the Local Vault Key.

### Passphrase wrapper

The passphrase is accepted in full, encoded as UTF-8 after Unicode NFC
normalisation, and processed with Argon2id version 1.3. Vault creation uses:

- a unique random 128-bit salt;
- a 256 MiB target memory cost;
- no less than 128 MiB on an explicitly supported constrained system;
- four lanes where the selected implementation and available CPU support them;
- a 256-bit output; and
- the greatest pass count that does not exceed an approximately five-second
  calibration target on the creation system, with at least one pass.

The exact algorithm, version, salt, memory, lane, pass, and output parameters
are stored in Public Bootstrap State. Unlock uses the stored parameters; it
does not silently weaken or recalibrate an existing vault. Before performing
the derivation, Watchtower validates all public parameters against supported
algorithm and resource bounds so a corrupt header cannot request unbounded CPU
or memory.

The Argon2id output is domain-separated into a passphrase key-encryption key
with HKDF-SHA-256. That key wraps the Local Vault Key using an approved
authenticated-encryption construction. Version 1 uses AES-256-GCM with a fresh
unpredictable 96-bit nonce and authenticated context containing the vault
identifier, envelope version, wrapper purpose, and wrapper generation. A nonce
must never repeat for the same key.

Version 1 passphrases:

- contain at least 12 Unicode code points and may contain spaces;
- permit at least 128 Unicode code points;
- have no character-class composition rules or periodic-change requirement;
- are checked locally against a reviewed common/compromised-password blocklist;
- may be pasted from a password manager; and
- are never transmitted or written to persistent storage.

An incorrect passphrase produces the same user-visible failure as an invalid
wrapper or unauthorised vault. Repeated failures receive increasing
session-only delays. Failed attempts never erase, mutate, or permanently lock
the vault.

Watchtower does not automatically unlock using Windows credentials, DPAPI, a
PIN, biometrics, or a retained device credential in version 1. The passphrase
is required after every application start.

### Recovery wrapper

Vault creation generates an independent 256-bit random Recovery Secret. A
checksum-protected textual encoding makes truncation and transcription errors
detectable. The exact encoding and word/code presentation are an implementation
format owned by issue #15; they must preserve the complete 256 bits of random
secret and include explicit format versioning.

The user must hide the initially displayed secret and re-enter the complete
value before vault creation succeeds. Recovery cannot be skipped. Watchtower
does not automatically save a plaintext copy beside the vault.

HKDF-SHA-256 derives a recovery key-encryption key from the decoded Recovery
Secret, a unique random wrapper salt, and a versioned recovery context. That
key independently wraps the same Local Vault Key with authenticated encryption
and independently generated nonce and associated data.

Only one Recovery Secret is active per vault. Watchtower retains the wrapper,
salt, nonce, algorithm identifiers, and generation metadata, but never the raw
Recovery Secret or a separately reversible copy. It cannot display the secret
after setup. The authenticated unwrap operation is the verifier; no additional
fast recovery-secret hash is stored.

Recovery may unlock the vault and establish a new passphrase wrapper. If the
user knows the passphrase but has lost the Recovery Secret, an unlocked session
may generate, fully confirm, and atomically activate a replacement. Activating
the replacement invalidates the old recovery wrapper.

### Public Bootstrap State

Before unlock, persistent state may reveal only bounded technical data required
to select and attempt a supported envelope:

- format and schema versions;
- a random vault identifier;
- wrapper algorithms, salts, nonces, parameters, purposes, and generations;
- authenticated ciphertexts of the Local Vault Key; and
- non-content integrity, migration, and active-generation markers.

Vault names, profile names, note/resource metadata, counts, user identities,
timestamps describing user activity, credential hints, and recovery-secret
fragments are not Public Bootstrap State.

Public fields are untrusted until an authenticated wrapper is opened and the
encrypted vault metadata agrees with them. Parsing applies strict size,
algorithm, and resource bounds before any expensive operation. Unknown,
downgraded, malformed, conflicting, or unsupported envelope state fails closed.

### Credential changes and interruption safety

Changing a passphrase or Recovery Secret replaces only its wrapper around the
existing Local Vault Key. It does not re-encrypt SQLCipher pages or resources.

A credential change uses a journalled two-generation transition:

1. retain the active wrapper;
2. write and durably flush the pending wrapper with a higher generation;
3. reopen and verify the pending wrapper using the new credential;
4. atomically commit the new active generation; and
5. retire the old wrapper only after the committed generation is durable.

At every forced-termination point, recovery deterministically selects either
the old committed generation or the fully written and authenticated new
generation. It never guesses, accepts a partially written wrapper, or leaves
both credentials invalid. Rollback to a retired generation is rejected.

Changing the passphrase may be authorised by either the current passphrase or
the Recovery Secret. Replacing the Recovery Secret requires an unlocked Vault
Session established by the passphrase. Credential operations never disclose
the raw Local Vault Key to UI or renderer code.

### Root-key compromise

Version 1 does not perform in-place Local Vault Key rotation. Passphrase and
Recovery Secret rotation address credential loss or compromise only. If the
Local Vault Key itself may be compromised, version 1 creates a new vault with
new root and recovery keys and migrates through a staged, verified encrypted
transfer. The old vault is not reported deleted or securely erased.

### Runtime custody and locking

The Vault Lifecycle module owns root and derived keys in bounded native memory.
It page-locks memory where supported, prevents core/crash-dump inclusion where
the platform permits, and overwrites owned buffers before release. These are
best-effort controls, not a claim that JavaScript, the operating system, an
administrator, or malware cannot observe live plaintext.

The pre-unlock UI receives only opaque operation results. Renderer and plugin
code never receives raw Local Vault Key, wrapper keys, derived storage keys,
passphrases, or Recovery Secrets.

Version 1 locking closes encrypted stores, revokes the Vault Session, terminates
the complete content-bearing process tree, and then exits Watchtower. A later
unlock starts a new process and requires the passphrase again. There is no
in-process cosmetic lock or background profile access while locked.

## Implementation contract

Issue #15 must implement public seams for:

- create vault and confirm the complete Recovery Secret;
- unlock with passphrase;
- recover with Recovery Secret and set a new passphrase;
- change passphrase;
- replace Recovery Secret;
- inspect supported public format metadata without exposing user content; and
- hard-lock/close with explicit success or failed-closed results.

Tests and packaged evidence must prove:

- independent passphrase and recovery wrappers open the same Local Vault Key;
- neither credential, wrapper key, root key, nor derived key is persisted or
  logged in plaintext;
- wrong, malformed, downgraded, excessive-cost, corrupt, and unsupported inputs
  fail closed before Joplin starts;
- every forced termination during wrapper creation and rotation recovers to a
  committed credential generation;
- old recovery credentials fail after committed replacement;
- passphrase changes do not rewrite encrypted content;
- each domain derives a stable key distinct from every other domain;
- backup restoration preserves the original vault's wrapper behavior;
- closing and locking terminate the content-bearing process tree; and
- runtime plaintext tracing finds no key material in command lines,
  environment variables, logs, crash artifacts, profile files, or temporary
  paths.

Cryptographic implementations require published test vectors, independent
review, dependency provenance, and cross-platform interfaces. Versioned formats
must be parsed before use, and algorithm migration must be additive: open and
authenticate the old format, create and verify the new envelope, commit it
atomically, and only then retire the old format.

## Consequences

- Watchtower cannot recover a vault for the user.
- Recovery works without an account, device-bound secret, or full-vault
  re-encryption.
- A five-second, memory-hard unlock is an intentional security and usability
  cost and requires visible progress and cancellation.
- Domain separation adds one central key-schedule module while preventing
  cross-component key reuse.
- Wrapper rotation is materially cheaper and safer than root-key rotation.
- One-vault and hard-process-lock constraints reduce first-release state and
  recovery complexity.
- A user who loses both credentials permanently loses the vault.

## Rejected alternatives

- **Watchtower or organisation escrow** — contradicts the local-first,
  user-controlled recovery boundary and creates a master recovery target.
- **Derive the content key directly from the passphrase** — couples data
  encryption to a low-entropy credential and makes credential changes require
  full-vault re-encryption.
- **Reuse one raw key for every encrypted component** — removes domain
  separation and increases the impact of component misuse.
- **Device-bound or automatic Windows unlock** — weakens the explicit
  passphrase boundary and is not portable.
- **Optional recovery setup** — permits avoidable, unrecoverable vaults and
  weakens the product's independent-recovery guarantee.
- **Several active recovery credentials** — complicates revocation, rollback
  protection, backup consistency, and user understanding.
- **Persist a fast recovery-code verifier** — creates an unnecessary offline
  oracle; authenticated unwrap already verifies the high-entropy credential.
- **Rotate the Local Vault Key for ordinary credential changes** — expands the
  crash-consistency surface and rewrites all encrypted content unnecessarily.
- **Soft lock a live Joplin process tree** — cannot prove revocation of
  renderer, plugin, worker, or cached key material.

## Evidence

- [RFC 9106: Argon2 Memory-Hard Function](https://www.rfc-editor.org/rfc/rfc9106.html)
- [RFC 5869: HKDF](https://www.rfc-editor.org/rfc/rfc5869.html)
- [NIST SP 800-63B-4: Password Authenticators](https://pages.nist.gov/800-63-4/sp800-63b.html#password-auth)
- [NIST SP 800-38D: AES-GCM](https://csrc.nist.gov/pubs/sp/800/38/d/final)
- [Microsoft CryptProtectMemory limitations and memory clearing](https://learn.microsoft.com/windows/win32/api/dpapi/nf-dpapi-cryptprotectmemory)
- `docs/adr/0003-sqlcipher-logical-profile-vault.md`
- `docs/adr/0004-unlocked-vault-session-at-rest-contract.md`
