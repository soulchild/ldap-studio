# Design

## Context

`ValueField` in `src/renderer/src/editor/AttributeTable.tsx` renders every editable text value as an `<input>` with the label `<attribute> value`, and every locked text value as a `<span>` with `break-all`. Text values are plain strings from main to save, so line breaks already reach the renderer and go back unchanged when nobody edits them. Only the editor's display and editing lose them.

## Goals / Non-Goals

**Goals:**

- Choose the field per value, without the user switching modes.
- Keep focus and the cursor while the user types, even when the typing adds or removes line breaks.
- Keep the field's accessible name, so locators and existing tests keep working.

**Non-Goals:**

- No new setting, toggle, or per-attribute configuration.
- No editor component (CodeMirror or similar) for values. A plain text area is enough.

## Decisions

**A value is multi-line if it contains a line break, and once a row shows a text area it keeps it while the entry is open.**
Deciding on every keystroke would swap the text area for an input when the user deletes the last line break. React would then mount a new element, so focus and the cursor would be lost mid-edit. The field therefore remembers that it has been multi-line (state in `ValueField`, set when the value contains `\n` or `\r`, never cleared while mounted). Opening another entry mounts new rows (the table is keyed per entry), so the choice starts fresh there.
_Alternative:_ re-decide on blur. Rejected: the row would still change height and type under the user's eyes after they leave it, for no benefit.

**Height comes from `rows = min(line count, 5)`, with `resize: vertical` and `overflow-y: auto`.**
The text area grows line by line up to five lines and then scrolls. Once the user drags the handle, the browser's inline height takes over, which is the resizing the user asked for.
_Alternative:_ CSS `field-sizing: content` with `max-height`. Rejected: `max-height` would also cap how far the user can drag, and the drag handle and content sizing work against each other.

**Restore CR LF line breaks on edit.**
A text area's `value` normalizes every line break to LF. When the original value uses CR LF, `onChange` converts LF back to CR LF before it updates the working copy. The style is detected from the value as it was when the field first showed it: CR LF if it contains `\r\n`, otherwise LF. A value nobody edits never passes through `onChange`, so it is saved byte for byte unchanged. Line counting splits on `\r\n`, `\r` and `\n`.
_Alternative:_ always store LF. Rejected: it would change every line of a value the user only touched once, which shows up as a full replace in the change preview and on the server.

**Same accessible name, same look.**
The text area gets `aria-label="<attribute> value"` like the input, and the same border, focus and font classes (monospace, `text-sm`), so the two kinds of field look the same apart from their height. The read-only `<span>` switches from `break-all` to `whitespace-pre-wrap break-words` for multi-line values.

## Risks / Trade-offs

- [Pasting multi-line text into a single-line input drops the line breaks, as browsers do for inputs] → Out of scope (see proposal). A later change can add a way to make a value multi-line.
- [Mixed line endings in one value (some CR LF, some LF) become all CR LF after an edit] → Rare in directory data; accepted. Unedited values are untouched.
- [A tall text area makes the attribute rows uneven] → Capped at five lines by default. The value column already allows rows of different heights (binary values, images).
