# Tasks

## 1. Line-break helpers

- [x] 1.1 Add pure helpers in `src/renderer/src/editor/multiline.ts`: whether a value is multi-line (contains `\n` or `\r`), its line count (splitting on `\r\n`, `\r` and `\n`), its line-break style (CR LF if it contains `\r\n`, else LF), and restoring a style on text from a text area (LF → CR LF). Verify with unit tests in `multiline.test.ts` written first: single-line, LF, CR LF, a trailing line break, an empty value, and that restoring LF leaves the text unchanged.

## 2. Editor field

- [x] 2.1 In `ValueField` (`AttributeTable.tsx`), render an editable multi-line value as a `<textarea>` with `aria-label="<attribute> value"`, `rows = min(line count, 5)`, vertical resizing only, vertical scrolling, and the input's font, border and focus styles. The field stays a text area once it has been multi-line while the entry is open. `onChange` restores the value's original line-break style. Verify with the e2e tests in 3.1.
- [x] 2.2 Show a locked multi-line value with its line breaks (`whitespace-pre-wrap`, wrapping long lines at word boundaries) instead of `break-all` on one line. Verify with the e2e test in 3.1.

## 3. End-to-end tests and docs

- [x] 3.1 Add e2e tests in `test/e2e/editor.spec.ts`, written before 2.1 and 2.2 and failing first, with `description` values set through the admin client:
  - a six-line value shows as a text area five rows high that scrolls, and a two-line value as two rows
  - a single-line value is still an input
  - after changing one line and saving, the server value has the other lines unchanged
  - a CR LF value keeps CR LF after an edit and save
  - deleting every line break keeps the text area focused and typing continues
  - the text area resizes vertically only (computed `resize` is `vertical`)
  - a multi-line operational or locked value shows its line breaks

  Verify with `pnpm test:e2e` against the running test servers.
- [x] 3.2 Add the new scenarios to `docs/spec-coverage.md` with the tests that cover them. Verify every scenario of "Multi-line text values" and "Line breaks are preserved" in the delta spec has an entry.
- [x] 3.3 Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` (test servers up, so nothing is skipped). Verify all pass.

## 4. Change preview

- [x] 4.1 Show multi-line string values in the change preview (`ReviewDialog` in `EditorPane.tsx`) with their line breaks, each limited to five lines and scrolling on its own, focusable so it scrolls with the keyboard; single-line values stay as they are. Move the five-line limit into `multiline.ts` so the editor and the preview share it. Verify with an e2e test in `editor.spec.ts`, written first and failing first: two eight-line values changed, the preview shows line breaks, and each value's box is five lines high and scrollable. Add the two scenarios to `docs/spec-coverage.md`, and rerun lint, typecheck, unit and the full e2e suite.

## Workflow follow-up

- After implementation, sync the delta into `openspec/specs/entry-editing/spec.md` and archive the change (`/opsx:archive`).
