# Proposal

## Why

Some text attributes hold several lines, for example YAML-style configuration such as

```
foo:
  - bar
hello:
  - world
```

The entry editor shows every text value in a single-line input, which collapses such a value onto one line. That makes it unreadable, and editing it risks losing the line breaks, since a single-line input can't hold them.

## What Changes

- Text values that contain line breaks are edited in a multi-line text area instead of a single-line input. Single-line values keep the input they have today.
- The text area shows up to five lines by default and scrolls beyond that. The user can drag it taller or shorter (vertical resizing only).
- Line breaks survive editing and saving exactly as they are, including Windows-style `\r\n`.
- Read-only multi-line values (locked attributes, read-only connections) show their line breaks too, instead of running together.
- The change preview shows multi-line values with their line breaks, each limited to five lines and scrollable on its own.

Not part of this change: turning a single-line value into a multi-line one in the editor (for example with Shift+Enter), syntax highlighting, and multi-line display in search results and the log.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `entry-editing`: adds requirements for showing multi-line text values and keeping their line breaks.

## Impact

- `src/renderer/src/editor/AttributeTable.tsx`: `ValueField` picks a text area for multi-line values and keeps line breaks in the read-only view.
- `src/renderer/src/editor/EditorPane.tsx`: the change preview shows line breaks and limits each value's height.
- `test/e2e/editor.spec.ts`: new end-to-end test with a multi-line value.
- `docs/spec-coverage.md`: covers the new scenarios.
- No change to IPC, the LDAP layer, or how values are saved: values are already plain strings that keep their line breaks.
