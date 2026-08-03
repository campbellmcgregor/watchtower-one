# Issue 12 plaintext-path controls

Date: 2026-08-03

Issue: [#12](https://github.com/campbellmcgregor/watchtower-one/issues/12)

## Implemented boundary

When an encrypted profile binding is active, Watchtower One now:

- disables the stock Simple Backup default while preserving stock Joplin's default outside the binding;
- does not initialise Sentry, its log attachment, local crash-event JSON, or Electron minidump integration, and forces legacy crash-upload configuration off;
- disables deletion-log materialisation;
- retains the existing fail-closed note, resource, external-edit, open-with, and reveal-file policy;
- requires an affirmative warning before export, PDF creation, or printing. Cancel is the default and cancellation occurs before plaintext is produced.

The Simple Backup package remains in the reviewed public code store for upstream packaging compatibility, but it is not enabled for the encrypted Watchtower profile. Issue #16 owns its encrypted automatic-backup replacement.

## Verification

- `@joplin/lib` TypeScript compilation passed.
- `@joplin/app-desktop` TypeScript compilation passed.
- 22 focused policy and integration tests passed across profile binding, backup admission, crash initialisation, diagnostics, external note/resource editing, resource reveal, and explicit egress confirmation.
- A fresh Windows x64 directory package passed the packaged create, use, close, plaintext-canary scan, and reopen proof.
- `plaintext-scan.json` reported no errors and no note-canary matches in any persisted file.

## Remaining release limits

Watchtower does not start an application-owned content-bearing crash reporter. Administrator-configured Windows Error Reporting dumps, the pagefile, hibernation, third-party application residue, and user-confirmed plaintext destinations remain the documented operating-system or Explicit Plaintext Egress limits from ADR-0004.
