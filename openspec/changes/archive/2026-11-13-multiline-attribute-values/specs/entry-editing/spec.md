# Spec Delta

## ADDED Requirements

### Requirement: Multi-line text values
The editor SHALL show a text value that contains a line break in a multi-line field, and a value without one in a single-line field. The multi-line field SHALL show up to five lines without scrolling, SHALL scroll when the value is longer, and SHALL let the user change its height but not its width. A read-only multi-line value SHALL be shown with its line breaks.

#### Scenario: Multi-line value
- **WHEN** an entry has a "description" value of six lines
- **THEN** the value is shown in a multi-line field that shows five lines and scrolls to the sixth

#### Scenario: Short multi-line value
- **WHEN** a value has two lines
- **THEN** the multi-line field is two lines high

#### Scenario: Single-line value
- **WHEN** a value has no line break
- **THEN** it is shown in a single-line field, as before

#### Scenario: Resize vertically
- **WHEN** the user drags the multi-line field's resize handle
- **THEN** the field gets taller or shorter, and its width stays the same

#### Scenario: Read-only multi-line value
- **WHEN** a multi-line value cannot be edited
- **THEN** it is shown with its line breaks, not run together on one line

### Requirement: Line breaks are preserved
A multi-line value the user does not edit SHALL be saved byte for byte unchanged. An edited value SHALL keep its line-break style: Windows line breaks (CR LF) stay CR LF, and Unix line breaks (LF) stay LF.

#### Scenario: Edit one line
- **WHEN** the user changes one line of a multi-line value and saves
- **THEN** the server stores the value with all its other lines and line breaks unchanged

#### Scenario: Windows line breaks are kept
- **WHEN** the user edits a multi-line value whose lines end in CR LF and saves
- **THEN** the server stores the value with CR LF line breaks

### Requirement: Multi-line values in the change preview
The change preview SHALL show multi-line values with their line breaks. Each value SHALL show up to five lines and SHALL scroll on its own when it is longer, so that several long values do not make the preview unreadable.

#### Scenario: Review a multi-line change
- **WHEN** the user reviews a change to a multi-line value
- **THEN** the preview shows the value with its line breaks

#### Scenario: Long values scroll
- **WHEN** the preview lists two changed values of eight lines each
- **THEN** each value shows five lines and can be scrolled to the rest, also with the keyboard
