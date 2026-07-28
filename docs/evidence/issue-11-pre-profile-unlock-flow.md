# Issue 11 pre-profile unlock flow evidence

<!-- cspell:ignore handoffs -->

Date: 2026-07-27

## Result: credential-prompt orchestration contract, issue remains open

The desktop bootstrap now has one pre-profile flow for collecting an existing
vault passphrase and submitting it directly to the encrypted desktop startup
boundary. The flow owns retry policy: only `wrongCredential` requests another
passphrase. Cancellation performs no vault access, while missing, corrupt,
unsupported, lifecycle, and profile-start outcomes are terminal. None can
select stock Joplin startup or a plaintext profile fallback.

The credential travels in a mutable, caller-owned command object. Both the
submitted field and command field are cleared after every attempt, including a
failed attempt. JavaScript strings cannot be overwritten in place, so this is
reference-lifetime reduction rather than secure memory erasure. The flow
returns only the unlocked lifecycle or an opaque bootstrap outcome; it never
returns a passphrase, key, key ring, or storage key.

## Verification

The application-bootstrap seam proves that:

- a wrong passphrase starts no Joplin profile, and the test exercises one
  user-driven retry;
- the successful retry starts Joplin exactly once;
- both caller-visible credential fields are empty after submission;
- cancellation closes the pre-profile view without attempting vault access;
  and
- corrupt-vault failure closes the view and does not retry.

The affected desktop bootstrap suite and desktop TypeScript project pass.

## Deliberate handoffs

Issue #11 remains open. This slice defines the trusted orchestration interface
but does not yet:

- implement the isolated Electron unlock window and narrow main-process
  transport that will satisfy `PreProfileUnlockView`;
- select the flow from production `main.ts`;
- provide first-run creation or Recovery Secret screens; or
- complete the remaining settings, plugin, cache, log, temporary-file, and
  Electron-state persistence adapters.

Production startup remains failed closed until the Electron view and controlled
Joplin runtime lifecycle can be selected together.
