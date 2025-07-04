# Obsidian PopNote

A powerful Obsidian plugin that enables system-wide pop note creation and management through global hotkeys.

## Features

### Global Pop Note Creation
- **System-wide hotkey** (default: `Ctrl+Shift+N` / `Cmd+Shift+N`) to create or open pop notes from anywhere, even when Obsidian is not focused
- Notes open in separate popup windows, keeping your main workspace undisturbed
- Smart window management prevents duplicate windows for the same note

### Intelligent Note Management
- **Buffer Time System**: 
  - Reuse recently created notes within a configurable time window
  - Options: Always create new, Always reuse last, or Custom duration (in minutes)
- **Custom Note Naming**: Flexible naming patterns with variables like `{{date}}`, `{{time}}`, `{{year}}`, `{{month}}`, etc.
- **Template Support**: Apply templates automatically to new pop notes

### Navigation Features
- **Previous/Next Navigation**: Quickly navigate between your pop notes using keyboard shortcuts
- **Smart Navigation**: When at the newest note, pressing "next" prompts to create a new note
- **Sort Options**: Order notes by creation time or last modified time

### Pop Notes Picker
- **Native Obsidian interface** using the built-in fuzzy search modal
- **Keyboard-driven workflow** with configurable shortcuts:
  - `Enter`: Open in current tab
  - `Cmd/Ctrl+Enter`: Open in new tab (configurable)
  - `Opt/Alt+Enter`: Open in new window (configurable)
  - `Cmd/Ctrl+P`: Pin/unpin note (configurable)
  - `Cmd/Ctrl+D`: Delete note (configurable)
- **Pin important notes** to keep them at the top of the list
- **Smart sorting**: Pinned notes appear first, followed by others in your preferred order

### Smart Window Behavior
- **Three window management modes**:
  - **Off**: Never minimize the main window
  - **Dynamic** (default): Only minimize if main window was hidden before creating pop note
  - **Always**: Always minimize main window after closing pop notes
- Preserves your workflow by respecting the main window state

## Installation

### From Obsidian Community Plugins (Coming Soon)
1. Open Settings → Community Plugins
2. Search for "PopNote"
3. Install and enable the plugin

### Manual Installation
1. Download the latest release from GitHub
2. Extract files to your vault: `VaultFolder/.obsidian/plugins/popnote/`
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## Configuration

### Pop Notes Settings
- **Pop notes folder**: Specify where to store your pop notes (default: "PopNotes")
- **Note name pattern**: Customize how notes are named
- **Template file**: Select a template to apply to new notes
- **Buffer time**: Configure note reuse behavior
- **Sort order**: Choose between creation time or modification time

### Window Settings
- **Default window size**: Set preferred dimensions for popup windows
- **Main window behavior**: Choose how the main window behaves when closing pop notes

### Hotkeys
- **Global hotkey**: System-wide shortcut for creating/opening pop notes
- **Navigation hotkeys**: Configure through Obsidian's Hotkeys settings:
  - PopNote: Navigate to previous pop note
  - PopNote: Navigate to next pop note
  - PopNote: Show pop notes picker
- **Picker shortcuts**: Customize keyboard shortcuts within the picker:
  - Pin/unpin, delete, open in new tab/window
  - Configure in plugin settings under "Pop Notes Picker Shortcuts"

## Usage

### Creating Pop Notes
1. Press your configured global hotkey (`Ctrl/Cmd+Shift+N` by default) from anywhere
2. A new pop note opens in a popup window
3. Start typing immediately - the note is automatically saved

### Navigating Notes
- Use navigation hotkeys to move between notes in chronological order
- At the newest note? Press "next" again to create a new note
- Use the picker (`Ctrl/Cmd+Shift+P`) for visual browsing

### Managing Notes
- Use the Pop Notes Picker (`Cmd/Ctrl+Shift+P`) for a native Obsidian experience
- Navigate with arrow keys and use Enter to open in current tab
- Pin frequently used notes with your configured shortcut (default: `Cmd/Ctrl+P`)
- Delete notes quickly with your configured shortcut (default: `Cmd/Ctrl+D`)
- Open in new tab (`Cmd/Ctrl+Enter`) or new window (`Opt/Alt+Enter`)
- Pop notes follow your vault's normal sync and backup rules

## Tips & Tricks

1. **Pop Capture Workflow**: Set buffer time to "permanent" to maintain a single daily capture note
2. **Project Notes**: Use different note patterns for different projects by changing settings
3. **Window Management**: Use "Dynamic" mode to preserve your workspace when actively using Obsidian
4. **Template Variables**: Create rich templates with date/time variables for automatic timestamps

## Requirements

- Obsidian v1.6.0 or higher
- Desktop only (uses Electron APIs for global hotkeys)

## Support

If you find this plugin helpful, consider supporting its development:
- [GitHub Sponsors](https://github.com/sponsors/jiywww)
- Report issues on [GitHub](https://github.com/jiywww/obsidian-popnote/issues)

## License

MIT License - see LICENSE file for details

## Credits

Built with ❤️ for the Obsidian community by jiywww