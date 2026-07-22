# Joplin downstream licensing and distribution obligations

**Research ticket:** [Validate fork, plugin, trademark, and distribution obligations](https://github.com/campbellmcgregor/watchtower-one/issues/31)

**Checked:** 2026-07-22

**Upstream snapshot reviewed:** Joplin `dev` at [`5df269104ef233d78c535e9df8abd1061c49233c`](https://github.com/laurent22/joplin/tree/5df269104ef233d78c535e9df8abd1061c49233c)

**Status:** planning evidence, not legal advice

## Executive answer

There is no licensing blocker to a commercially distributed, rebranded Watchtower One client based on Joplin, provided the modified client and its Corresponding Source are distributed under AGPL-3.0-or-later and the release does not use Joplin's protected name, logos, or icons without permission. The encryption implementation, client-side integration code, and other modifications that form part of the client must be treated as open-source client code, not proprietary code.

The material boundaries are:

| Proposed boundary | Result | Reason |
| --- | --- | --- |
| Rebranded Windows client fork, source published for every binary | **Go, with compliance controls** | Joplin client code defaults to AGPL-3.0-or-later; the AGPL permits modified distribution when its source, notices, and downstream freedoms are supplied. |
| Open client plugin connecting over a narrow documented protocol to an independently written proprietary service | **Plausible go, with counsel review of the interface** | A genuinely separate service is not automatically part of the client work. Keep the client connector source-available under an AGPL-compatible license and keep service implementation out of the client/plugin. |
| Closed Watchtower plugin loaded through Joplin's plugin API | **Hold / default no-go** | Joplin has no reviewed plugin-license exception. Its plugins are separate processes, but use a bidirectional host API and IPC. The FSF's GPL guidance treats this fact pattern as capable of forming one combined program. Obtain qualified advice or written permission before shipping a proprietary JPL. |
| Commercial Watchtower Sync built from `packages/server` | **No-go without a separate written commercial licence** | `packages/server` is expressly excluded from the root AGPL and is governed by the Joplin Server Personal Use License, which restricts commercial use and modification. |
| Joplin name, logos, icons, or upstream app identity used as Watchtower product branding | **No-go without permission** | Joplin states that `Joplin®` is its registered trademark and that its logos/icons and `Assets/` are all rights reserved. |
| Dynamically downloaded JPL plugins in a future iOS build | **No-go under the current App Store route** | Apple's current rule 2.5.2 disallows downloading/executing code that changes app functionality; Joplin therefore limits iOS to recommended plugins. Curated plugins should be bundled and submitted with the app, subject to app-review and licensing review. |

This is a **go for the Windows-first fork** if Watchtower treats the client as an AGPL product, replaces upstream branding assets, omits Joplin Server, and keeps any proprietary service across a deliberately separate network boundary. The only immediate legal-design blocker is a plan to keep a tightly integrated client plugin closed.

## What is licensed under what

### Client and shared code

Joplin's root [`LICENSE`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/LICENSE) says all repository code is AGPL-3.0-or-later unless a directory contains its own `LICENSE` or `LICENSE.md`. The current desktop and mobile package manifests independently identify both [`@joplin/app-desktop`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/app-desktop/package.json) and [`@joplin/app-mobile`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/app-mobile/package.json) as AGPL-3.0-or-later.

For Watchtower this means:

- the forked desktop app and changes inside it must be conveyed as one AGPL-covered work;
- modified source releases must say that Watchtower changed the work and give relevant dates;
- recipients must receive the AGPL rights to copy, modify, and redistribute the covered work; an umbrella EULA, installer term, or service contract must not take those rights away; and
- encryption, recovery, plugin-policy enforcement, update integration, and branding changes implemented in the client are part of the client source release.

Those conclusions follow from AGPL section 5's modified-work requirements and whole-work licensing rule, section 6's object-code/source rules, and section 10's prohibition on further restrictions in the [authoritative AGPL text](https://www.gnu.org/licenses/agpl-3.0.html).

### Material directory exceptions

The root rule makes a per-release path inventory mandatory. At the reviewed commit, the most relevant exceptions are:

| Path | Governing terms | Watchtower action |
| --- | --- | --- |
| [`Assets/`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/Assets/LICENSE) | Laurent Cozic copyright; all rights reserved; permission required | Replace upstream logos, icons, and images. Do not copy these into Watchtower release artefacts. |
| [`packages/server/`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/server/LICENSE.md) | Joplin Server Personal Use License | Exclude from the commercial client plan. Obtain a written commercial licence before basing a paid or business service on it. |
| [`packages/generator-joplin/`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/generator-joplin/LICENSE) | MIT | May be used to scaffold plugins with MIT notice retained. This does not create a runtime-linking exception for a plugin. |
| [`packages/onenote-converter/`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/onenote-converter/LICENSE) | MPL-2.0 | Preserve the MPL notices and source availability for modified covered files if the converter ships. |
| `packages/fork-htmlparser2`, `packages/fork-uslug`, `packages/react-native-alarm-notification`, `packages/react-native-saf-x`, `packages/turndown*`, vendored `whisper.cpp` | MIT | Retain copyright and permission notices. See each licence in the [pinned repository tree](https://github.com/laurent22/joplin/tree/5df269104ef233d78c535e9df8abd1061c49233c/packages). |
| [`packages/fork-sax/`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/fork-sax/LICENSE) | ISC | Retain copyright and permission notice. |
| [`packages/app-desktop/build/7zip/`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/app-desktop/build/7zip/license.txt) | LGPL, LGPL plus unRAR restriction, and BSD-3-Clause by component | Ship the full supplied licence information with Windows binaries. The file expressly requires it for binary redistribution. |
| [`packages/editor/ProseMirror/vendor/icons/`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/editor/ProseMirror/vendor/icons/LICENSE) | Apache-2.0 | Retain licence and any applicable notices. |

This table is not a substitute for a dependency scan. Joplin includes a [`packages/tools/licenses`](https://github.com/laurent22/joplin/tree/5df269104ef233d78c535e9df8abd1061c49233c/packages/tools/licenses) report builder that collects production dependency licences and notices, and its own source warns that the output must be reviewed for correctness. Run and review an equivalent report for every Watchtower release, including newly added native encryption dependencies.

### Joplin Server is not part of the client grant

The [`packages/server/LICENSE.md`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/server/LICENSE.md) exception grants noncommercial use and expressly lists charging users, business-operated access, income generation, and commercial exploitation as prohibited without prior written authorisation. It also restricts modification and derivative works absent permission. Joplin's official [Server Business page](https://joplinapp.org/help/apps/joplin_server_business/) directs commercial users to request a quote.

Therefore, the planned future Watchtower Sync service must either:

1. be independently implemented against a documented sync protocol without copying Joplin Server code; or
2. obtain a written commercial licence from JOPLIN SAS before development or operation based on `packages/server`.

Calling that future service “open source upstream” or publishing local changes would not cure a breach of the separate Personal Use License.

## Binary distribution and source correspondence

AGPL section 6 allows network distribution of object code when equivalent no-charge access to Corresponding Source is offered from the same place, with clear directions if source is hosted elsewhere. “Corresponding Source” includes the preferred source for modification plus the scripts needed to generate, install, and run the object code; section 5 also requires modification notices and dates. See [AGPL sections 1, 5, and 6](https://www.gnu.org/licenses/agpl-3.0.html).

The lowest-risk Watchtower release pattern is:

1. Tag every binary release with an immutable Watchtower version and commit.
2. Publish the exact source tree for that binary, including Watchtower patches, generated-source inputs, lockfiles, build/install scripts, packaging configuration, and any modified vendored component source.
3. Put a conspicuous **Source code for this exact version** link next to every installer, portable archive, and automatic-update payload. Do not point only to a moving default branch.
4. Keep the matching source downloadable for as long as the corresponding object code remains downloadable or is served by the updater.
5. Include the complete AGPL text, upstream and Watchtower copyright notices, no-warranty notices, modification notices/dates, and reviewed third-party notices in the installed app and distribution archive.
6. Preserve an in-app `Legal` or `About` entry that exposes those notices and the exact-version source link. This also gives a safe implementation of AGPL section 13's source offer if a modified client feature permits remote network interaction.
7. Keep reproducible release records: source commit, dependency lock, build runner/toolchain version, artefact hashes, signing identity, third-party licence report, and source URL.
8. Do not add click-through terms that forbid reverse engineering, redistribution, modification, or use of modified clients. Separate service terms should explicitly carve out the AGPL client and its licence rights.

The root [`LICENSE`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/LICENSE) is a short project notice and SPDX pointer, not the complete licence text; Watchtower should include the complete AGPL text in each distribution as AGPL section 4 requires.

Charging for the Windows client or for a separate service does not by itself remove these obligations. The commercial value can live in hosting, support, managed integrations, and independently implemented services, but recipients retain AGPL rights in the client they receive.

## Plugin licensing and service separation

### Facts from Joplin's own plugin system

Joplin's official [plugin architecture](https://joplinapp.org/help/dev/spec/plugins/) says a desktop plugin script is loaded in a separate process, but calls a Joplin API wrapper through a sandbox proxy; the proxy serialises API calls over IPC to the plugin host, and host events are translated back into plugin callbacks. The API wraps Joplin internal functions and services. This is more integrated than a standalone executable merely exchanging a simple file format.

Joplin's official generator instructions say the public plugin repository automatically ingests npm packages that use the `joplin-plugin-` name prefix and keyword and contain the built JPL/manifest files. Those [publishing conditions](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/generator-joplin/generators/app/templates/GENERATOR_DOC.md) do not state a plugin licence requirement or grant a special exception from the client's AGPL. Likewise, the [plugin manifest](https://joplinapp.org/help/api/references/plugin_manifest/) makes `repository_url` optional. Neither silence is permission to distribute a proprietary combined work.

The FSF's official [GNU licence FAQ on plugins](https://www.gnu.org/licenses/gpl-faq.en.html#GPLPlugins) says process boundaries are not decisive: intimate communication, function calls, shared complex structures, or complex IPC can make a main program and plugin one combined program. Its [plugin-licensing answer](https://www.gnu.org/licenses/gpl-faq.en.html#GPLAndPlugins) says that if they form one combined program, the plugin must use the GPL or a GPL-compatible free-software licence and be distributed with source in a compliant way. This FAQ is guidance, not a court ruling, and the result can depend on jurisdiction and exact implementation.

### Recommended Watchtower boundary

For the first release:

- license first-party JPL plugins under AGPL-3.0-or-later or a GPL/AGPL-compatible permissive licence, publish their preferred source, and include dependency notices;
- keep secret credentials and proprietary business logic on an independently written remote service;
- make the open plugin communicate with that service through a versioned, ordinary network protocol using serialised requests/responses;
- do not import Joplin client packages or copy Joplin/Joplin Server implementation into the proprietary service;
- distribute the client and open plugin independently from the service terms, and avoid a single EULA that purports to close either component; and
- document the data boundary, protocol, authentication, and deployment topology for legal review before monetisation.

Do **not** ship a closed Watchtower JPL merely because it runs in another Electron process. If proprietary client-side code is commercially essential, obtain an opinion based on the actual API calls and packaging, or negotiate a written exception/alternative licence with the relevant copyright holders.

## Trademark, naming, assets, and attribution

Joplin's root [`LICENSE`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/LICENSE) states that `Joplin®` is a JOPLIN SAS EU trademark (filing 018544315) and that Joplin logos and icons may not be used without permission. [`Assets/LICENSE`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/Assets/LICENSE) separately reserves all rights in the directory's logos, icons, and images. The public [brand guidelines](https://joplinapp.org/brand/) describe presentation but do not override those permission requirements.

Before the first public Watchtower build:

- replace the product name, application ID, executable/installer names, publisher identity, update endpoints, protocol handlers, icons, splash art, screenshots, and store metadata;
- replace every file sourced from upstream `Assets/` unless JOPLIN SAS supplies written permission for that exact use;
- retain factual copyright/licence attribution in `Legal` and source documentation—rebranding does not mean erasing authorship;
- avoid product-page wording, search metadata, or visual trade dress that suggests Watchtower is an official Joplin product or endorsed by JOPLIN SAS; and
- have counsel approve any nominative phrase such as “based on Joplin” and the placement of the Joplin word mark in acknowledgements.

The current desktop package metadata still contains upstream identifiers such as product name `Joplin`, app ID `net.cozic.joplin-desktop`, publisher `Joplin`, and Joplin icon paths in [`packages/app-desktop/package.json`](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/app-desktop/package.json). A rebrand audit should search beyond visible UI strings.

## App-store and mobile distribution notes

This is not a Windows v1 blocker, but it is a future mobile constraint:

- Apple's current [App Review Guideline 2.5.2](https://developer.apple.com/app-store/review/guidelines/#software-requirements) says App Store apps may not download, install, or execute code that introduces or changes functionality. Joplin's own [plugin documentation](https://joplinapp.org/help/apps/plugins/) consequently allows only recommended plugins on iOS, while desktop and Android support manual JPL installation.
- A Watchtower iOS build should bundle every allowed executable plugin with the reviewed app and disable arbitrary JPL installation. The app, bundled plugins, notices, and exact source offer must be evaluated together before submission.
- App Store acceptance of upstream Joplin is evidence of practical feasibility, not a licence or guarantee for Watchtower. Review the then-current Apple developer agreement, App Review Guidelines, payment rules, code-signing terms, and AGPL “further restrictions” implications with qualified counsel before an iOS release.
- Use Watchtower's own developer accounts, signing identities, bundle IDs, store listing, privacy disclosures, and branding assets. Upstream's account, certificates, trademarks, and store listing are not conveyed by the source licence.

## Actionable release checklist

### Before code import

- [ ] Record the exact upstream commit/tag and archive its root and per-directory licences.
- [ ] Exclude `packages/server` from the commercial client scope.
- [ ] Create a replacement inventory for all upstream `Assets/`, Joplin names, app IDs, publisher strings, endpoints, icons, screenshots, and protocol handlers.
- [ ] Adopt AGPL-3.0-or-later for the modified client repository and ensure every contributor agrees their changes can be distributed on those terms.
- [ ] Decide that first-party client plugins are source-available under AGPL-compatible terms unless counsel approves a specific exception.

### During development

- [ ] Keep Watchtower client changes in the source tree; do not hide encryption or policy implementation in unavailable generated artefacts.
- [ ] Add prominent Watchtower modification notices and dates without removing upstream copyright/licence notices.
- [ ] Maintain a machine-readable dependency inventory and review every new dependency's licence, especially native database/encryption libraries and bundled binaries.
- [ ] Preserve all component-specific licence/NOTICE files; treat Joplin's licence-report tool as a starting point that requires human review.
- [ ] Put proprietary service logic behind a documented network boundary and prohibit proprietary service code from importing/copying Joplin client or server code.
- [ ] Keep service terms and client/plugin licences visibly separate.

### For every binary release

- [ ] Tag the exact source commit and produce an immutable source archive.
- [ ] Publish equivalent no-charge access to that exact Corresponding Source next to every binary/update download.
- [ ] Include build/install scripts, lockfiles, packaging inputs, modified vendored sources, and all material needed to rebuild the covered object code.
- [ ] Bundle the full AGPL text, upstream/Watchtower notices, modification dates, no-warranty notice, and reviewed third-party licences/notices.
- [ ] Add in-app `Legal` and exact-version `Source code` links.
- [ ] Archive artefact hashes, source URL, build environment, dependency report, and signing record.
- [ ] Test that no EULA, installer, updater, account condition, or service term removes recipients' AGPL rights in the client.
- [ ] Verify the artefacts contain no Joplin logos/icons, upstream signing identity, or accidental official-product representation.

### Before a proprietary service or mobile release

- [ ] Obtain counsel's written conclusion on the actual open-plugin/proprietary-service interface.
- [ ] Obtain a commercial licence before using any Joplin Server code commercially.
- [ ] Re-run the app-store and licence compatibility review against rules current on the submission date.
- [ ] Bundle curated iOS plugins and disable downloaded executable plugins unless the store grants a documented permitted path.

## Questions for qualified counsel

1. Given Joplin's separate-process JPL runner, bidirectional callback translation, host API calls, and IPC data structures, would a particular Watchtower plugin and the AGPL client be one combined work in the intended distribution jurisdictions?
2. Does bundling a plugin in the installer, signing it with Watchtower's key, restricting the client to that plugin, or making it essential to paid functionality change that analysis?
3. Is the proposed client-plugin-to-service protocol sufficiently arm's-length for the independently written service to remain a separate work? Review actual schemas, SDKs, shared packages, and deployment—not only the architecture diagram.
4. Is the planned source-download and auto-update arrangement sufficient for AGPL sections 5, 6, 10, and 13, including retention of old exact-version source?
5. Do proposed service terms, account controls, code signing, or plugin allowlisting impose a prohibited restriction on recipients' exercise of AGPL rights in copies they possess?
6. Is proposed wording such as “Watchtower One is based on Joplin” a permissible factual acknowledgement, and what separation/disclaimer is required to avoid trademark confusion?
7. Does every selected new encryption/database dependency have terms compatible with distribution of the combined AGPL client?
8. Before iOS or store distribution, can the then-current store agreement and technical controls be satisfied without imposing terms inconsistent with the AGPL?
9. If Watchtower Sync later reuses any Joplin Server source, what written commercial/derivative-work permission is required from JOPLIN SAS?

## Primary sources

- [Joplin root licence at the reviewed commit](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/LICENSE)
- [Joplin Server Personal Use License](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/server/LICENSE.md)
- [Joplin assets licence](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/Assets/LICENSE)
- [GNU Affero General Public License v3](https://www.gnu.org/licenses/agpl-3.0.html)
- [GNU licence FAQ: plugin combination and licensing](https://www.gnu.org/licenses/gpl-faq.en.html#GPLPlugins)
- [Joplin plugin architecture](https://joplinapp.org/help/dev/spec/plugins/)
- [Joplin plugin generator and publishing instructions](https://github.com/laurent22/joplin/blob/5df269104ef233d78c535e9df8abd1061c49233c/packages/generator-joplin/generators/app/templates/GENERATOR_DOC.md)
- [Joplin plugin installation documentation](https://joplinapp.org/help/apps/plugins/)
- [Joplin plugin manifest](https://joplinapp.org/help/api/references/plugin_manifest/)
- [Joplin brand guidelines](https://joplinapp.org/brand/)
- [Joplin Server Business](https://joplinapp.org/help/apps/joplin_server_business/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
