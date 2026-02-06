[English](README.md) · [中文](README.zh-CN.md)

# Dragger (Obsidian Plugin)

Drag any block (paragraphs, headings, lists, blockquotes, callouts, tables, math blocks, etc.) to rearrange content like Notion.

---

## Features
- Drag block-level content: paragraphs / headings / lists / tasks / blockquotes / callouts / tables / math blocks
- Nested drag: horizontal position controls nesting level, vertical position controls insertion row
- Configurable handle color and indicator color
- Always-show handles option
- Cross-file drag (experimental)

---

## Installation

### Community Plugins
If published: open **Settings → Community plugins → Browse**, search **Dragger**, and install.

### BRAT (Beta)
1. Install BRAT
2. Add your repository URL in BRAT
3. Install the latest Release

### Manual
Copy main.js, manifest.json, and styles.css (if present) into:
`
.obsidian/plugins/dragger
`
Then enable the plugin in Obsidian.

---

## Usage
- Hover on the left side of a block to reveal the handle (or keep it always visible)
- Drag the handle to the target position and release when the indicator shows
- For nested lists/quotes, horizontal position determines nesting depth

---

## Settings
- **Handle color**: follow theme or custom
- **Always show handles**
- **Indicator color**: follow theme or custom
- **Cross-file drag** (experimental)

---

## Compatibility
- Requires Obsidian >= 1.0.0
- Desktop only (isDesktopOnly: true)

---

## Internal Architecture (for contributors)
- `src/editor/drag-handle.ts`: plugin wiring, view lifecycle, event orchestration
- `src/editor/dnd/session.ts`: drag session state and shared visual cleanup
- `src/editor/dnd/selectors.ts`: shared selectors/classes constants
- `src/editor/dnd/table-guard.ts`: rendered table-cell interaction guard
- `src/editor/dnd/line-parser.ts`: quote/list/indent parsing utilities
- `src/editor/dnd/container-policy.ts`: container isolation policy (list/quote/callout)
- `src/editor/dnd/drop-target.ts`: insertion anchor and geometry helpers
- `src/editor/dnd/block-mutation.ts`: block text rewrite and insertion text building

The main rule is: visual decisions and behavioral decisions should come from the same policy path, to avoid “indicator shown but drop blocked” mismatches.

---

## Regression Strategy
- Unit tests (Vitest) live under `src/**/*.spec.ts`
- High-risk policy modules are covered:
  - `line-parser.spec.ts`
  - `table-guard.spec.ts`
  - `container-policy.spec.ts`
  - `block-mutation.spec.ts`
- Recommended local gate before PR:
`
npm run test
npm run typecheck
npm run build
`

---

## Development
`
npm install
npm run dev
`

Build release:
`
npm run build
`

---

## License
MIT

---

## Contributing
PRs and issues are welcome.

If this plugin helps you, a star would mean a lot. ⭐
