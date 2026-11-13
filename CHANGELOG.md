# Changelog

All notable changes to LDAP Studio.

## 0.0.1 (2026-11-13)

### Added

- Add a command palette, make Go to DN a dialog, and mark attributes with icons

### Changed

- Release from a workflow that tags only after CI and the end-to-end tests pass
- Archive the MVP change and sync its specs to openspec/specs
- Set userPassword values in a password dialog
- Put Reload before Delete in the entry actions menu
- Expand the root when the DN chooser opens at it
- Collapse attributes with more than 10 values to their count
- Open a search result with a single click
- Choose the search base in the DN chooser instead of the tree
- Search all subtrees in the DN chooser
- Keep the entry path on one line and scroll it sideways
- Reload an entry from the entry actions menu
- Show the app icon in development, including in the About panel
- Confirm copies with a green check
- Make the end-to-end tests in CI optional
- Show a hint instead of the search form when not connected
- Sign the macOS app ad hoc so it can be opened
- Upgrade the GitHub Actions to their current major versions
- Give the 100,000-node flattening test a 30 s timeout
- Reveal entries the server left out of an incomplete list
- Separate panes as cards, scroll the class tags, and choose DN values from a tree
- Raise the contrast of attribute names in the entry editor
- Highlight the selected segment with the primary colour
- Give the entry path its own bar and consistent padding
- Make scrollbars quieter, in the spirit of macOS overlay scrollbars
- Replace the per-node tree filter with a server-side filter bar
- Make the add-attribute field scrollable and easy to dismiss
- Keep entry attributes in a fixed, grouped order
- Give the UI more character and tighten spacing slightly
- Name the app LDAP Studio in the menu bar and About panel
