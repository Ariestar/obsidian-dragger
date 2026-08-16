# External Note Targets and Native Selection Drag

**Status:** Approved design

**Date:** 2026-08-16

**Repositories:** `Ariestar/md-dragger`, `Ariestar/obsidian-dragger`

## Goal

Restore and modernize the intended cross-note workflow without reintroducing a parallel drag controller:

1. Drag selected Markdown blocks onto an Obsidian internal link or File Explorer note and append them to that note.
2. Use a native CodeMirror text selection spanning semantic blocks as the drag source when the user drags a handle inside that selection.
3. Preserve current positional drops between open editors and the engine's long-press/handle multi-selection workflow.
4. Keep selected handles recognizable as drag grips instead of rendering them as checkbox-like controls.

The implementation must follow the 2.0 layering rule: generic selection, target, and commit extensibility belongs in `md-dragger`; Obsidian link, workspace, and vault knowledge remains in `obsidian-dragger`.

## Non-goals

- No changes to Obsidian itself.
- No restoration of the pre-2.0 `ExternalFileDropController` or a second drag state machine.
- No positional insertion into a note represented only by a link or sidebar item; those targets append to the end.
- No new settings or dependencies.
- No copy semantics: a successful external drop moves the source blocks.

## Repository and PR structure

### PR 1: `md-dragger`

Add narrow, platform-neutral engine hooks:

- A press-selection hook that can return a semantic `BlockSelection` for the pressed source. The default remains `selectOne(detectedBlock)`.
- A target-location hook that may resolve a pointer to a `DropPosition` backed by a document not owned by a registered CodeMirror view.
- A commit hook that receives planned `DocEdit[]` and may apply edits to non-CodeMirror documents. The existing CodeMirror commit behavior remains the default.

The engine must not import or name Obsidian concepts such as `TFile`, vaults, internal links, or File Explorer nodes.

### PR 2: `obsidian-dragger`

Consume the new hooks to provide:

- CodeMirror native-selection to semantic-block translation.
- Internal-link and File Explorer target resolution through Obsidian APIs.
- Append-at-end drop positions for unopened Markdown files.
- Commit routing to open CodeMirror views or unopened vault files.
- Grip-preserving selected-handle styling.

The plugin PR depends on the engine PR and updates the pinned `md-dragger` version only after the engine release exists. Local development uses the documented sibling checkout link.

## Interaction behavior

### Native editor selection

When a desktop CodeMirror selection is non-empty and spans more than one semantic block:

1. Convert every selection range to complete Markdown blocks using engine domain helpers.
2. Merge overlapping and adjacent block ranges.
3. Use the resulting block selection only if the pressed handle belongs to it.
4. Start the group drag using the normal movement threshold, without requiring the engine's additional multi-select hold delay.

An empty selection, a selection resolving to one ordinary block, or a handle outside the selection follows existing single-block behavior. Engine-created persistent multi-selection remains unchanged.

### Internal-link target

During an active drag, the plugin recognizes Obsidian internal-link elements. It:

1. Reads and safely decodes the link path.
2. Removes aliases and heading/block subpaths before file resolution.
3. Resolves the destination relative to the note containing the link through `metadataCache.getFirstLinkpathDest`.
4. Accepts Markdown files only.
5. Produces an append position at the end of the destination document.

Same-note link drops use one CodeMirror transaction when the note is open. They must not duplicate or lose content.

### File Explorer target

During an active drag, the plugin recognizes `.nav-file-title[data-path]`, resolves its path to a Markdown `TFile`, and produces the same append-at-end target. Folders and non-Markdown files are ignored.

### Commit ordering and failure safety

For a destination not owned by an open CodeMirror view:

1. Re-read the destination through `vault.process` at commit time.
2. Recalculate the append edit against that current text.
3. Persist the destination insertion first.
4. Delete the source only after the destination write succeeds.

If destination resolution or persistence fails, the engine cancels the drop and leaves the source untouched. Cross-file undo cannot be atomic across an unopened vault file; that limitation must be documented in the PR.

Open-editor destinations continue through CodeMirror transactions and retain their editor undo behavior.

## Visual feedback

- Internal-link and File Explorer elements receive a temporary target-highlight class only while they are valid active targets.
- The highlight is cleared on drop, cancel, pointer leave, view destruction, and plugin unload.
- Selected blocks retain the current CodeMirror line decoration.
- Selected handles retain the configured grip icon and gain an accent state; they do not transform into checkmarks or task-style checkboxes.

## Engine API constraints

- New hooks are optional and preserve current behavior when omitted.
- Hooks return domain values rather than platform objects.
- No duplicate controller, adapter wrapper, fallback path, or stale cached target is introduced.
- The CodeMirror adapter remains the owner of default live-view hit testing and commits.
- External targets are resolved fresh during drag-over and again on release.

## Testing

### `md-dragger`

- Default press still selects one detected block when no hook exists.
- A supplied press-selection hook starts a drag with its composite selection.
- A supplied external locate hook can return a non-live document target.
- A supplied commit hook receives the complete planned source and destination edits.
- Rejected external targets produce no commit.
- Existing CodeMirror adapter behavior remains green.

### `obsidian-dragger`

- Native text selection spanning paragraphs moves all resolved blocks.
- Native selection works when the pressed handle is a nested list handle.
- A handle outside the native selection moves only its own block.
- Internal links resolve aliases, headings, block subpaths, relative paths, and encoded paths.
- File Explorer Markdown files resolve; folders and non-Markdown files do not.
- Link and sidebar drops append with correct newline formatting.
- Failed destination writes leave the source unchanged.
- Same-file append is one dispatch without overlapping changes.
- Existing open-editor cross-file, single-block, long-press selection, list renumbering, and mobile behavior remain green.

Both repositories must pass their full tests, type checks, lint checks, and production builds before either PR is proposed.

## Acceptance criteria

- Dropping selected blocks on an internal note link moves them to the end of the linked note.
- Dropping selected blocks on a File Explorer note moves them to the end of that note.
- Dragging a handle inside a native multi-block text selection moves the complete semantic selection.
- Positional dragging into another open editor remains unchanged.
- Long-press/handle multi-selection remains available.
- Selected handles remain visibly draggable grips.
- No Obsidian-specific type or behavior enters `md-dragger`.
- No parallel drag controller is added to `obsidian-dragger`.
