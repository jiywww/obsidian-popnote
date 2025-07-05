# PopNote Settings Reference

This document provides a complete reference for all PopNote settings, including detailed explanations, use cases, and potential risks.

## Table of Contents

1. [Pop Notes Settings](#pop-notes-settings)
2. [Window Settings](#window-settings)
3. [Floating Window Settings](#floating-window-settings)
4. [Global Hotkey](#global-hotkey)
5. [Obsidian Hotkeys](#obsidian-hotkeys)
6. [PopNote Picker Shortcuts](#popnote-picker-shortcuts)
7. [Developer Settings](#developer-settings)
8. [Settings Storage](#settings-storage)

## Pop Notes Settings

### Pop Notes Folder

**Type:** Text field  
**Default:** `PopNotes`  
**Description:** The folder where all pop notes are stored within your vault.

**Details:**
- Path is relative to your vault root
- Folder is created automatically if it doesn't exist
- Can use nested paths (e.g., `Notes/Quick/PopNotes`)

**Use Cases:**
- Organize pop notes separately from main notes
- Create project-specific pop note folders
- Integrate with existing folder structure

**Risks:**
- Changing this moves future notes to the new location
- Existing notes remain in the old folder
- May break external tools expecting specific paths

### Note Name Pattern

**Type:** Text field  
**Default:** `PopNote {{date}} {{time}}`  
**Description:** Pattern for naming new pop notes using variables.

**Available Variables:**
| Variable | Format | Example |
|----------|---------|---------|
| `{{date}}` | YYYY-MM-DD | 2024-01-15 |
| `{{time}}` | HH-mm-ss | 14-30-45 |
| `{{year}}` | YYYY | 2024 |
| `{{month}}` | MM | 01 |
| `{{day}}` | DD | 15 |
| `{{hour}}` | HH | 14 |
| `{{minute}}` | mm | 30 |
| `{{second}}` | ss | 45 |

**Examples:**
- `Meeting {{date}}` → "Meeting 2024-01-15"
- `Quick Note {{hour}}-{{minute}}` → "Quick Note 14-30"
- `{{year}}/{{month}}/Note {{day}}` → Creates in subfolder

**Risks:**
- Too simple patterns may cause naming conflicts
- Complex patterns may be hard to search
- Special characters may cause file system issues

### Template File

**Type:** File selector  
**Default:** None  
**Description:** Template applied to new pop notes.

**How It Works:**
1. When creating a new pop note
2. Template content is copied
3. Variables in template are processed
4. Note opens with pre-filled content

**Template Variables:**
- All note name pattern variables work in templates
- Additional Obsidian template variables may work

**Use Cases:**
- Pre-structured meeting notes
- Daily journal templates
- Project note templates

**Risks:**
- Large templates may slow creation
- Complex templates may cause parsing errors
- Template file deletion breaks functionality

### Buffer Time

**Type:** Dropdown + number field  
**Default:** 5 minutes  
**Description:** Time period for reusing the last created note.

**Options:**

#### Always Create New Note
- Every hotkey press creates a fresh note
- No reuse of existing notes
- Best for: Discrete, unrelated captures

#### Always Reuse Last Note
- Always opens the most recent pop note
- Never creates new notes automatically
- Best for: Single capture document

#### Custom Time (Minutes)
- Reuses if last note created within X minutes
- Range: 1-1440 minutes (24 hours)
- Best for: Session-based note-taking

**How Buffer Time Works:**
1. Press global hotkey
2. System checks last created note timestamp
3. If within buffer time → opens existing note
4. If outside buffer time → creates new note

**Risks:**
- Too short: Many small notes
- Too long: Unrelated content mixed
- "Permanent": May accumulate too much content

### Sort Order

**Type:** Dropdown  
**Default:** Modified  
**Options:** Created, Modified  
**Description:** How notes are ordered in navigation and picker.

**Created Time:**
- Orders by original creation timestamp
- Never changes after creation
- Best for: Chronological review

**Modified Time:**
- Orders by last edit timestamp
- Changes when note is edited
- Best for: Recent activity focus

**Impact Areas:**
- Previous/Next navigation order
- PopNote picker default order
- File tracking system

## Window Settings

### Window Size Mode

**Type:** Dropdown  
**Default:** Fixed  
**Options:** Fixed, Remember  
**Description:** How PopNote window sizes are determined.

#### Fixed Mode
- Always uses default width/height
- Consistent window sizes
- Ignores manual resizing

#### Remember Mode
- Saves size when window is resized
- Restores last used size
- Per-session persistence

**Risks:**
- Remember mode may restore inappropriate sizes
- Fixed mode ignores user preferences
- Very small sizes may hide content

### Default Window Width/Height

**Type:** Number fields  
**Default:** 800×600 pixels  
**Visible When:** Window Size Mode = Fixed  
**Description:** Initial dimensions for new PopNote windows.

**Recommendations:**
- Minimum: 400×300 (usability)
- Maximum: Your screen resolution
- Common: 800×600, 1024×768, 1280×720

**Considerations:**
- Smaller = Less intrusive
- Larger = More content visible
- Match your typical note length

### Window Position

**Type:** Dropdown  
**Default:** Center  
**Options:** Center, Left, Right, Last  
**Description:** Where PopNote windows appear on screen.

#### Position Details

**Center:**
- Exactly centered on primary display
- Consistent, predictable placement
- Best for: Focus mode

**Left:**
- Left side with 50px margin
- Vertically centered
- Best for: Reference while working

**Right:**
- Right side with 50px margin
- Vertically centered
- Best for: Note-taking alongside apps

**Last:**
- Remembers exact position
- Persists between sessions
- Best for: Multi-monitor setups

**Multi-Monitor Behavior:**
- Positions relative to primary display
- "Last" remembers specific monitor
- Manual movement updates "last" position

### Cursor Position

**Type:** Dropdown  
**Default:** Start  
**Options:** Start, End, Last  
**Description:** Where the text cursor appears when opening notes.

#### Cursor Options

**Start:**
- Beginning of document
- Line 0, Character 0
- Best for: Reading/reviewing

**End:**
- End of last line
- Ready to append
- Best for: Continuous capture

**Last:**
- Exact position when last edited
- Per-file memory
- Survives renames
- Best for: Resuming work

**Technical Details:**
- Positions stored by file path
- Updates on window hide/close
- Cleared if file deleted

## Floating Window Settings

### Always On Top

**Type:** Toggle  
**Default:** Off  
**Description:** Makes PopNote windows float above other windows.

**When Enabled:**
- PopNote stays visible over other apps
- Cannot be covered by normal windows
- Follows window level setting

**Use Cases:**
- Live transcription
- Reference notes
- Stream overlays
- Presentation notes

**Risks:**
- May block important content
- Can be distracting
- Some apps may override

### Window Level

**Type:** Dropdown  
**Default:** Fullscreen (screen-saver)  
**Options:** Fullscreen, Floating, Normal  
**Visible When:** Always On Top = On  
**Description:** Controls how PopNote windows interact with other windows.

#### Window Levels

**Fullscreen (screen-saver level):**
- Maximum visibility priority
- Appears above fullscreen applications
- Works with presentations and games
- **macOS Note:** May cause dock icon issues when main window is minimized

**Floating:**
- Always-on-top behavior
- Better integration with macOS dock
- Cannot appear above fullscreen apps
- Good balance for most workflows

**Normal:**
- Standard window behavior
- No always-on-top functionality
- Behaves like regular application windows
- Best for users who don't need floating windows

**Platform Differences:**
- **Windows:** All levels provide similar always-on-top behavior
- **macOS:** Significant differences between levels, especially with dock and spaces
- **Linux:** Behavior varies by window manager

**Choosing the Right Level:**
- Need to see notes over fullscreen apps? → Use **Fullscreen**
- Want floating notes with good OS integration? → Use **Floating**
- Don't need always-on-top? → Use **Normal**

### Visible on All Workspaces

**Type:** Toggle  
**Default:** Off  
**Platform:** macOS only  
**Visible When:** Always On Top = On AND Window Level = Fullscreen  
**Description:** Shows PopNote on all virtual desktops/spaces.

**Benefits:**
- Access from any space
- No space switching needed
- Works with fullscreen apps
- Mission Control compatible

**Requirements:**
- Must be enabled for fullscreen coverage
- May affect space switching behavior
- Requires macOS 10.9+

**Side Effects:**
- Window appears in all Exposé views
- Cannot be assigned to specific space
- May interfere with space-specific workflows

## Global Hotkey

### Create/Open PopNote

**Type:** Hotkey field  
**Default:** `CmdOrCtrl+Shift+N`  
**Description:** System-wide shortcut to summon PopNote.

**Hotkey Format:**
```
[Modifier+][Modifier+]Key
```

**Available Modifiers:**
- `CmdOrCtrl` - Cmd on macOS, Ctrl elsewhere
- `Cmd` - Command key (macOS)
- `Ctrl` - Control key
- `Alt` - Alt/Option key
- `Shift` - Shift key

**Valid Examples:**
- `CmdOrCtrl+Shift+P`
- `Alt+Space`
- `Ctrl+Alt+N`
- `Shift+F1`

**Invalid Examples:**
- `Ctrl+` (no key)
- `Space` (no modifier for global)
- `Cmd+Cmd` (duplicate modifier)

**Validation:**
- Red highlight = Invalid combination
- Must include at least one modifier
- Must include exactly one regular key

**Conflicts:**
- OS shortcuts take precedence
- Other apps may intercept
- Some combinations reserved by system

## Obsidian Hotkeys

These commands are available in Obsidian's Hotkeys settings. Search for "PopNote" to find them.

### Navigate to Previous PopNote

**Default:** None (user must set)  
**Scope:** Obsidian only  
**Action:** Opens previous note based on sort order

### Navigate to Next PopNote

**Default:** None (user must set)  
**Scope:** Obsidian only  
**Action:** Opens next note or creates new if at newest

### Show PopNote Picker

**Default:** None (user must set)  
**Scope:** Obsidian only  
**Action:** Opens the PopNote picker modal

**Setting Hotkeys:**
1. Settings → Hotkeys
2. Search "PopNote"
3. Click the ⊕ button
4. Press desired combination
5. Resolve any conflicts

## PopNote Picker Shortcuts

Keyboard shortcuts active within the PopNote picker modal.

### Pin/Unpin Shortcut

**Type:** Text field  
**Default:** `Mod+P`  
**Description:** Toggle pin status of selected note

### Delete Shortcut

**Type:** Text field  
**Default:** `Mod+D`  
**Description:** Delete selected note (with confirmation)

### Open in New Tab Shortcut

**Type:** Text field  
**Default:** `Mod+Enter`  
**Description:** Open selected note in new Obsidian tab

### Open in PopNote Window Shortcut

**Type:** Text field  
**Default:** `Alt+Enter`  
**Description:** Open selected note in PopNote window

**Shortcut Format:**
- Use `Mod` for Cmd/Ctrl
- Combine with `+` symbol
- Case insensitive

**Examples:**
- `Mod+P` → Cmd+P (macOS) or Ctrl+P (Windows/Linux)
- `Alt+D` → Alt+D on all platforms
- `Shift+Enter` → Shift+Enter

**Customization Tips:**
- Avoid conflicts with OS shortcuts
- Keep consistent with platform conventions
- Test in picker after changing

## Developer Settings

### Debug Mode

**Type:** Toggle  
**Default:** Off  
**Description:** Enables detailed logging for troubleshooting.

**When Enabled:**
- Logs to browser console
- Creates debug file in vault
- Shows window events
- Tracks file operations

**Debug Output Includes:**
- Global hotkey triggers
- Window lifecycle events
- File tracking updates
- Cursor position saves
- Navigation actions

**Performance Impact:**
- Minimal for console logs
- File writes may add latency
- Increases memory usage slightly

**Privacy Note:**
- Logs may contain note titles
- No note content is logged
- Safe to share logs for support

## Settings Storage

### Settings File Location

```
[Vault]/.obsidian/plugins/popnote/data.json
```

### Settings Structure

```json
{
  "popNotesFolder": "PopNotes",
  "templateFile": "",
  "bufferTime": 5,
  "sortOrder": "modified",
  "noteNamePattern": "PopNote {{date}} {{time}}",
  "createNoteHotkey": "CmdOrCtrl+Shift+N",
  "defaultWindowWidth": 800,
  "defaultWindowHeight": 600,
  "pinnedNotes": [],
  "windowSizeMode": "fixed",
  "lastUsedWindowSize": null,
  "lastCreatedNote": null,
  "pickerPinShortcut": "Mod+P",
  "pickerDeleteShortcut": "Mod+D",
  "pickerOpenInNewTabShortcut": "Mod+Enter",
  "pickerOpenInNewWindowShortcut": "Alt+Enter",
  "alwaysOnTop": false,
  "windowLevel": "screen-saver",
  "visibleOnAllWorkspaces": false,
  "cursorPosition": "start",
  "cursorPositions": {},
  "windowPosition": "center",
  "lastWindowPosition": null,
  "fileTracking": {
    "fileIdToPath": {},
    "pathToFileId": {}
  },
  "debugMode": false
}
```

### Manual Settings Editing

**Warning:** Only edit when Obsidian is closed

1. Close Obsidian completely
2. Open `data.json` in text editor
3. Make changes carefully
4. Save and restart Obsidian

**Common Fixes:**
- Reset corrupted settings: Delete `data.json`
- Clear cursor positions: Empty `cursorPositions` object
- Reset file tracking: Empty `fileTracking` objects

## Best Practices

### Performance Optimization

1. **Buffer Time**: Balance between note reuse and organization
2. **Window Size**: Smaller windows render faster
3. **Debug Mode**: Disable when not troubleshooting
4. **File Tracking**: Periodically clean orphaned entries

### Workflow Optimization

1. **Hotkeys**: Choose memorable, ergonomic combinations
2. **Window Position**: Match your screen layout
3. **Sort Order**: Align with your mental model
4. **Cursor Position**: Match your capture style

### Troubleshooting Settings

1. **Global Hotkey Issues**: Try different combinations
2. **Window Problems**: Reset position to center
3. **Performance Issues**: Disable debug mode
4. **Sync Conflicts**: Check settings file integrity

## Conclusion

PopNote's extensive settings allow you to customize every aspect of your quick note-taking workflow. Start with defaults and adjust based on your needs. Remember that settings sync with your vault, so your configuration follows you across devices.

For usage instructions and feature explanations, see the [Features Guide](./features.md).