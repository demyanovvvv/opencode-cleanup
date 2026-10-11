---
name: opencode-tui-development
description: Develop and verify this project's integrated OpenCode command-palette dialogs using the actual installed TUI API.
---

# OpenCode TUI development

1. Verify `@opencode-ai/plugin/tui` types for the target host. Current baseline:
   OpenCode 1.18.34, OpenTUI 0.4.5, SolidJS 1.9.12.
2. Export a default `{ id: "opencode-cleanup", tui }` from the `./tui` entrypoint.
   A TUI module must not also export `server`.
3. Use `api.keymap.registerLayer` with `namespace: "palette"`. Ctrl+P belongs
   to the host. Use `api.ui.dialog.replace`, `api.ui.DialogSelect` and actual
   Solid/OpenTUI JSX for integrated screens. No browser or LLM prompt is needed.
4. Every sub-screen has a clickable Back action. Use compact terminal layouts,
   scrollable content, host theme colors and loading/error/empty states.
5. Cleanup registrations and subprocesses with component cleanup and the host's
   lifecycle. Do not leave refresh intervals running while dialogs are closed.
6. Compile Solid with `babel-preset-solid`, `generate: "universal"`, moduleName
   `@opentui/solid`; do not bundle a second host Solid runtime.
7. Exercise the built entrypoint and command callbacks, then use the real OpenTUI
   test renderer for frame output, Back navigation and narrow terminal layouts.

Authoritative references:
- https://github.com/anomalyco/opencode/blob/dev/packages/opencode/specs/tui-plugins.md
- https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/tui.ts
- https://opencode.ai/tui.json
- https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/SKILL.md
- https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/core-concepts/testing.mdx

The official OpenTUI skill is the layout/testing reference. Older community
server-plugin skills often describe pre-TUI limitations; confirm against host
types before adopting their advice.
