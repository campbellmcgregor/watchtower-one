# Issue 11 ephemeral plugin script evidence

Date: 2026-07-30

## Result

Watchtower no longer writes a plugin's JavaScript bundle to
`<profile>/tmp/plugin_<plugin-id>.js` before executing it.

When an encrypted profile binding is active, desktop composition supplies an
`EphemeralPluginScriptLoader`. The loader waits for the plugin's isolated
Electron host page to finish loading, then sends the plugin identifier and
source directly to that window over Electron IPC. The host verifies the
identifier, creates a script element in memory, and attaches a
`plugin://<plugin-id>/index.js` source label for diagnostics.

The loader has no filesystem collaborator or temporary path. A stock
`PluginRunner` caller without the Watchtower loader retains Joplin's existing
file-backed behavior.

## Verification

Red-green tests at the plugin-script loader seam prove:

- source is not transferred until the isolated host page is ready;
- main-window IPC and development `dom-ready` listeners are installed before
  plugin source can execute;
- the payload is scoped to the expected plugin identifier;
- the Watchtower loader receives no filesystem capability; and
- the stock loader still writes and loads Joplin's legacy temporary script.

Desktop TypeScript checking and the production bundle verify both loader
strategies and the plugin host receiver compile and package together.

Packaged runtime tracing under Issue #7 must still prove the absence of
`plugin_<plugin-id>.js` during ordinary plugin startup and forced termination.

Issue #11 remains open. Plugin package extraction, plugin data directories,
general cache and temporary paths, and plugin-provided `fs-extra` access still
require separate encrypted, ephemeral, or fail-closed treatment. Curated-plugin
admission and outside-path egress remain Issues #18 and #19.
