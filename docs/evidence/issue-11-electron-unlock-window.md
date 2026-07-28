# Issue 11 Electron unlock-window evidence

<!-- cspell:ignore cleanup handoffs lifecycle -->

Date: 2026-07-28

## Result: isolated pre-profile unlock view, issue remains open

Watchtower now has a concrete Electron implementation of
`PreProfileUnlockView` for existing-vault passphrase unlock. It runs in a fresh
non-`persist:` session with cache disabled and refuses to open if Electron
reports a persistent storage path. The BrowserWindow disables Node integration,
DevTools, webviews, spellcheck, insecure content, and direct renderer access to
Electron. It denies permissions, child windows, navigation, webview attachment,
and every request outside its configured local asset directory.

The preload exposes only `submit`, `cancel`, and opaque feedback subscription.
Main-process listeners authenticate the exact unlock window's `WebContents`
before accepting a submission or cancellation. Listeners exist before the page
can become interactive and are removed on every close path. The window and its
memory-only Electron session are destroyed and cleared after success,
cancellation, user close, or page-load failure.

The renderer clears the password input before sending the submitted value. It
does not write browser storage, form values, URLs, logs, or external requests.
Wrong credentials return only `{ kind: "wrongCredential" }`. The visible
five-second progress message reflects ADR-0005's accepted Argon2id target.

JavaScript strings cannot be overwritten in place. Input and command clearing
therefore reduce reference lifetime; they are not a secure-memory-erasure
claim.

## Verification

At the accepted application-bootstrap and pre-profile view seams, tests prove:

- a fresh memory-only Electron session and hardened window collect the
  passphrase;
- an IPC sender other than that window is ignored;
- authenticated IPC exists before local assets finish loading;
- wrong-credential feedback contains no credential or vault detail;
- cancel and user-close resolve without attempting another unlock;
- cancellation during memory-hard derivation reaches Vault Lifecycle and opens
  neither profile storage nor Joplin;
- unlock-view cleanup failure closes an already-open profile and vault before
  the error is surfaced;
- close removes listeners and clears the isolated session;
- navigation, child windows, webviews, permissions, and network requests are
  denied;
- the context-isolated preload publishes only the three reviewed operations;
- the renderer clears its password field before submission and cancellation;
  and
- the document's CSP permits only its local script and inline styles.

The preload is a dedicated bundle, so its sandboxed runtime requires only
Electron and does not load neighbouring application modules or data files. The
Windows encrypted-profile workflow builds that bundle through its dedicated
preload-only task and runs the unlock-window proof in an isolated Jest
configuration when the view, assets, flow, or bundler changes. The proof does
not require Joplin's stock SQLite binding or unrelated generated desktop assets.

## Deliberate handoffs

Issue #11 remains open. This slice intentionally does not:

- select the Electron view or encrypted dependencies from production
  `main.ts`;
- add first-run creation and Recovery Secret screens;
- connect the controlled Joplin runtime's complete stop/terminate lifecycle;
  or
- complete the remaining settings, plugin, cache, log, temporary-file, and
  Electron-state encrypted persistence adapters.

Production startup remains failed closed. The next slice must compose this view
with the existing unlock flow and production encrypted dependencies without
putting the passphrase in command-line arguments, environment variables, URLs,
logs, or persistent browser state.
