# Spec Delta

## Purpose

Provides the desktop application frame that every feature lives in: the multi-pane workspace layout, light and dark theming, and the security boundary between the user interface and directory access.

## ADDED Requirements

### Requirement: Runs without a Java runtime
The application SHALL be distributed as a self-contained desktop application that installs and runs without a separately installed Java runtime or any other external runtime.

#### Scenario: Fresh machine without Java
- **WHEN** the application is installed on a machine with no Java runtime
- **THEN** the application starts and all features are usable

### Requirement: Multi-pane workspace layout
The main window SHALL present a connections pane, a directory tree pane, an entry editor pane, and a bottom panel with tabs for search results and the operation log.

#### Scenario: Default layout on first launch
- **WHEN** the user launches the application for the first time
- **THEN** the connections and directory tree panes are shown on the left, the entry editor in the main area, and the bottom panel below the editor

#### Scenario: Collapsing the bottom panel
- **WHEN** the user collapses the bottom panel
- **THEN** the entry editor expands to use the freed space

### Requirement: Resizable panes persist across sessions
The user SHALL be able to resize panes, and the application SHALL restore pane sizes, the collapsed state of the bottom panel, and the window size and position on the next launch.

#### Scenario: Pane sizes are restored
- **WHEN** the user resizes the tree pane, quits, and relaunches the application
- **THEN** the tree pane has the size it had before quitting

### Requirement: Light and dark theme
The application SHALL offer light, dark, and system theme modes. In system mode it SHALL follow the operating system's appearance and switch live when it changes. The chosen mode SHALL persist across sessions.

#### Scenario: Following the system theme
- **WHEN** the theme mode is "system" and the operating system switches from light to dark appearance
- **THEN** the application switches to the dark theme without a restart

#### Scenario: Explicit theme choice persists
- **WHEN** the user selects the dark theme and relaunches the application
- **THEN** the application starts in the dark theme regardless of the operating system appearance

### Requirement: Responsive interface during directory operations
Directory operations SHALL NOT block the user interface. While an operation runs, the user SHALL be able to scroll, switch panes, and start or cancel other operations.

#### Scenario: Slow server does not freeze the UI
- **WHEN** a search against a slow server is in progress
- **THEN** the user can still scroll the tree, open other entries that are already loaded, and cancel the search

### Requirement: Isolated user interface process
The user interface SHALL have no direct access to the network, file system, or stored credentials. It SHALL reach directory servers, files, and secrets only through a defined set of application operations.

#### Scenario: Interface cannot read stored secrets
- **WHEN** the user interface requests a connection profile
- **THEN** the returned profile indicates only whether a password is saved and never contains the password or its encrypted form

### Requirement: Operation log
The application SHALL record each directory operation it performs (bind, search, add, modify, modify DN, delete) in the operation log panel with timestamp, connection, operation type, target DN, result code, and duration. Passwords and binary values SHALL NOT appear in the log.

#### Scenario: Failed modify is logged
- **WHEN** a modify operation is rejected by the server
- **THEN** the log shows an entry with the target DN, the server's result code, and its diagnostic message

#### Scenario: Bind password is redacted
- **WHEN** a bind operation is logged
- **THEN** the log entry shows the bind DN but not the password

### Requirement: Keyboard navigation
All primary workflows (selecting a connection, navigating the tree, opening and editing entries, running a search, DN lookup) SHALL be operable with the keyboard alone, and the application SHALL provide shortcuts for the command palette, the Go to DN dialog and the search view.

#### Scenario: Jump to DN lookup
- **WHEN** the user presses the DN lookup shortcut
- **THEN** the Go to DN dialog opens with its field focused

### Requirement: Command palette
The application SHALL provide a command palette, opened by a shortcut or from the top bar, that lists the commands available in the current state (navigation, actions on the open entry, connecting and disconnecting profiles, theme, keyboard shortcuts), filters them by every typed word, and runs the highlighted command with Enter.

#### Scenario: Run a command by typing
- **WHEN** the user opens the command palette, types "log" and presses Enter
- **THEN** the palette closes and the operation log is shown

#### Scenario: Go to DN from the palette
- **WHEN** the user opens the command palette, types "go to" and presses Enter
- **THEN** the Go to DN dialog opens with its field focused
