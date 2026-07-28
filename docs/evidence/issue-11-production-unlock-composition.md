# Issue 11 production unlock composition evidence

<!-- cspell:ignore handoff handoffs -->

Date: 2026-07-28

## Result: encrypted unlock selected by the production entry point

The desktop production entry point now creates and assigns a dedicated
`Watchtower One` public-bootstrap root beneath the operating system application
data directory before Electron readiness. It then waits for Electron, creates
the isolated pre-profile unlock view, and constructs encrypted desktop
dependencies only after the user submits a credential. Cancellation before or
during an unlock attempt closes the pre-profile view and quits cleanly. Wrong
credentials remain inside the retry flow, while non-cancellation failures quit
failed closed.

The production composition locates the encrypted SQLCipher database and public
Vault Key Envelope beneath the Watchtower user-data root. It supplies a fresh
memory-only Electron session factory to the encrypted profile host. Passphrases
are passed only through the in-memory unlock command and are cleared by the
existing credential-to-profile handoff; they are not read from command-line
arguments, environment variables, URLs, logs, or persistent renderer state.

Tests at the Application bootstrap seam prove that the dedicated user-data root
is assigned before Electron becomes ready and that the pre-profile view becomes
active before a credential can construct encrypted profile dependencies. A
submitted credential reaches vault access before Joplin profile startup.
Pre-submission cancellation reaches neither dependency construction nor profile
startup, and in-flight cancellation is normalized to the same clean result.

## Deliberate failed-closed handoff

Issue #11 remains open. The production entry point intentionally does not load
stock `joplinMain` after a successful vault unlock. Stock startup still creates
profile-bearing settings, logs, window state, spell-check state, and a
file-backed Electron session. Until those paths consume the encrypted or
ephemeral profile modules, the production Joplin runtime loader throws and Vault
Lifecycle closes the encrypted store rather than falling back to stock
plaintext behavior.

The production-composition test invokes that pending runtime handoff and proves
that Vault Lifecycle closes the already-open encrypted store before returning a
typed `profileStart` failed-closed result.

The next slice must bind the content-bearing Joplin process to the active
Ephemeral Runtime session and replace or route those remaining synchronous
profile writes before enabling Joplin startup.
