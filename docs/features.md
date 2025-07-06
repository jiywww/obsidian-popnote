# PopNote Features Guide

This comprehensive guide explains all features available in PopNote, designed for users of all experience levels.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Global Hotkey System](#global-hotkey-system)
3. [Pop Note Creation](#pop-note-creation)
4. [Window Management](#window-management)
5. [Note Navigation](#note-navigation)
6. [PopNote Picker](#popnote-picker)
7. [File Organization](#file-organization)
8. [Advanced Features](#advanced-features)
9. [Troubleshooting](#troubleshooting)

## Core Concepts

### What is a Pop Note?

A **Pop Note** is a quick-access note that opens in a separate floating window. Think of it as a digital sticky note that:
- Can be summoned instantly from anywhere on your computer
- Stays separate from your main Obsidian workspace
- Persists your thoughts without disrupting your workflow

### Key Benefits

1. **Non-intrusive**: Pop notes don't interfere with your main Obsidian window
2. **Always Available**: Access from any application using global hotkeys
3. **Persistent**: Notes are saved automatically and can be accessed later
4. **Organized**: All pop notes are stored in a dedicated folder

## Global Hotkey System

### What is a Global Hotkey?

A global hotkey is a keyboard shortcut that works **system-wide**, meaning it responds even when Obsidian is minimized or hidden behind other applications.

### Global Hotkey

The global hotkey can be customized in the plugin settings.

### How It Works

1. Press the hotkey from any application
2. If a PopNote window exists, it appears instantly
3. If no window exists, a new one is created
4. The window gains focus, ready for input

### Customizing the Global Hotkey

1. Go to Settings → PopNote
2. Find "Global Hotkey" section
3. Click in the hotkey field
4. Press your desired key combination

**Available Modifiers:**
- `Ctrl` (Windows/Linux) or `Cmd` (macOS)
- `Alt` (Windows/Linux) or `Option` (macOS) 
- `Shift`
- `CmdOrCtrl` (automatically uses Cmd on macOS, Ctrl elsewhere)

**Valid Examples:**
- `CmdOrCtrl+Shift+P`
- `Alt+Shift+N`
- `Ctrl+Alt+Space`

**Important:** Choose a combination not used by your operating system or other applications.

## Pop Note Creation

### Buffer Time System

The buffer time determines whether pressing the global hotkey creates a new note or reuses a recent one.

#### Buffer Time Options

1. **Always Create New Note**
   - Every hotkey press creates a fresh note
   - Best for: Users who want separate notes for each thought
   - Risk: May create many small notes

2. **Always Reuse Last Note**
   - Always opens the most recent pop note
   - Best for: Maintaining a single "capture" note
   - Risk: May mix unrelated content

3. **Custom Time (Minutes)**
   - Reuses the last note if created within X minutes
   - Configurable in minutes
   - Best for: Capturing related thoughts in bursts
   - Example: Set to 30 minutes for meeting notes

### Note Naming Patterns

Customize how your pop notes are named using variables:

#### Available Variables

- `{{date}}` - Current date (YYYY-MM-DD)
- `{{time}}` - Current time (HH-mm-ss)
- `{{year}}` - 4-digit year
- `{{month}}` - 2-digit month
- `{{day}}` - 2-digit day
- `{{hour}}` - 2-digit hour (24-hour format)
- `{{minute}}` - 2-digit minute
- `{{second}}` - 2-digit second

#### Pattern Examples

- `PopNote {{date}} {{time}}` → "PopNote 2024-01-15 14-30-45"
- `Quick Thought {{date}}` → "Quick Thought 2024-01-15"
- `Meeting {{year}}-{{month}}-{{day}}` → "Meeting 2024-01-15"

### Template Support

Templates let you start new pop notes with predefined content.

#### Setting Up Templates

1. Create a template file in your vault
2. Go to Settings → PopNote
3. Click "Select" next to "Template file"
4. Choose your template

#### Template Example

```markdown
## {{date}}

### Quick Thoughts
- 

### Action Items
- [ ] 

### References
- 
```

## Window Management

### Window Behavior

PopNote uses a **hide/show pattern** instead of closing and recreating windows. This means:

- **Faster Access**: Windows appear instantly when summoned
- **State Preservation**: Window size, position, and content remain intact
- **Better Performance**: No overhead from creating new windows

### Window Size Options

#### Fixed Size Mode
- Windows always open at the specified dimensions
- Configurable dimensions
- Best for: Consistent workspace layouts

#### Remember Last Size
- Windows remember their size from the last session
- Automatically saves when you resize
- Best for: Flexible workflows

### Window Position Options

1. **Center**
   - Opens in the center of your screen
   - Best for: Focused note-taking

2. **Left**
   - Opens on the left side of your screen
   - Best for: Reference notes while working

3. **Right**
   - Opens on the right side of your screen
   - Best for: Note-taking alongside other apps

4. **Last Position**
   - Remembers where you last placed the window
   - Best for: Consistent workflows

### Floating Window Features


#### Window Level Options

1. **Normal**
   - Standard window behavior
   - No always-on-top functionality
   - Can be covered by other windows
   - Best for: Users who don't need floating windows

2. **Floating**
   - Always-on-top behavior
   - Better integration with macOS dock
   - Cannot appear above fullscreen apps
   - Best for: Most users who want floating notes

3. **Fullscreen (Screen-saver level)**
   - Maximum visibility priority
   - Appears above fullscreen applications
   - Works with presentations and games
   - Best for: Users who need notes visible everywhere
   - **macOS Note:** May cause dock icon issues when main window is minimized

#### Visible on All Workspaces (macOS)

This macOS-specific feature makes PopNote available on all virtual desktops/spaces.

**Benefits:**
- Access notes from any desktop space
- No need to switch spaces
- Works with fullscreen applications

**Important:** Only available when using the Fullscreen window level.

## Note Navigation

### Navigation Methods

#### Keyboard Navigation

1. **Previous Note** (configure hotkey in Obsidian)
   - Navigates to older notes
   - Based on your sort order preference

2. **Next Note** (configure hotkey in Obsidian)
   - Navigates to newer notes
   - At the newest note? Creates a new one

#### Sort Order Options

1. **Creation Time**
   - Orders by when notes were first created
   - Best for: Chronological workflows

2. **Modified Time**
   - Orders by last edit time
   - Best for: Finding recently worked-on notes

### Cursor Position Management

#### Cursor Position Options

1. **Start**
   - Places cursor at beginning of note
   - Best for: Reading/reviewing notes

2. **End**
   - Places cursor at end of note
   - Best for: Appending new content

3. **Last Position**
   - Remembers where you left off
   - Best for: Continuing work
   - Persists even after file renames

## PopNote Picker

The picker provides a visual interface for managing all your pop notes.

### Opening the Picker

- Configure in Obsidian hotkeys
- Or use Command Palette: "Show PopNote picker"

### Picker Features

#### Fuzzy Search
- Type any part of a note name
- Searches through all pop notes
- Instant results as you type

#### Keyboard Shortcuts

All shortcuts are customizable in settings:

- **Navigate**: Arrow keys (↑↓)
- **Open in Current Tab**: Enter
- **Open in New Tab**: `Cmd/Ctrl+Enter`
- **Open in PopNote Window**: `Alt+Enter`
- **Pin/Unpin**: `Cmd/Ctrl+P`
- **Delete**: `Cmd/Ctrl+D`
- **Close**: Escape

#### Pinned Notes

Pinning keeps important notes at the top of the picker.

**Use Cases:**
- Daily journal entries
- Project dashboards
- Frequently referenced notes

**Visual Indicator:** Pinned notes show a 📌 icon

### Deleting Notes

1. Select a note in the picker
2. Press your delete shortcut
3. Confirm deletion in the dialog

**Warning:** Deletion is permanent and cannot be undone.

## File Organization

### Storage Location

All pop notes are stored in a dedicated folder.

**Benefits:**
- Easy to find all quick notes
- Can be excluded from graph view if desired
- Simple backup/export

### File Tracking System

PopNote uses **creation time (ctime)** to track files internally.

**Why This Matters:**
- Notes can be renamed without breaking references
- Navigation history remains intact
- Cursor positions are preserved

### Integration with Obsidian Features

Pop notes are regular Obsidian files, so they support:
- Backlinks and tags
- Search functionality
- Sync services
- Community plugins
- Version control

## Advanced Features

### Session Persistence

PopNote windows **reconnect** after Obsidian restarts instead of closing.

**Benefits:**
- Continue where you left off
- No lost window states
- Seamless workflow continuation

### Multi-Monitor Support

- Windows remember their monitor
- Position options work across all displays
- Size is preserved per monitor

### Performance Optimization

#### Hide/Show Pattern
Instead of destroying windows, PopNote hides them. This provides:
- Instant window appearance
- Lower CPU usage
- Better responsiveness

#### Smart File Loading
- Only loads files when needed
- Caches cursor positions
- Minimal memory footprint

## Troubleshooting

### Common Issues

#### Global Hotkey Not Working

**Possible Causes:**
1. Another application uses the same hotkey
2. Hotkey contains invalid combination
3. Obsidian lacks system permissions

**Solutions:**
1. Try a different key combination
2. Ensure hotkey has actual keys (not just modifiers)
3. Check system accessibility permissions

#### Window Not Appearing

**Possible Causes:**
1. Window is hidden off-screen
2. Window is minimized
3. Multiple monitor setup issues

**Solutions:**
1. Change window position to "Center" in settings
2. Restart Obsidian
3. Disable and re-enable the plugin

#### Notes Not Saving

**Possible Causes:**
1. Invalid folder path
2. File permissions issues
3. Sync conflicts

**Solutions:**
1. Check PopNotes folder exists
2. Verify write permissions
3. Check sync service status

### Debug Mode

Enable debug mode to troubleshoot issues:

1. Settings → PopNote → Developer Settings
2. Toggle "Debug mode"
3. Check developer console for detailed logs

## Best Practices

### Workflow Tips

1. **Daily Capture**: Set buffer time to "permanent" for a daily scratch pad
2. **Meeting Notes**: Use custom buffer time (30-60 minutes)
3. **Quick References**: Pin frequently used notes
4. **Project Notes**: Use specific naming patterns per project

### Performance Tips

1. **Folder Cleanup**: Periodically archive old pop notes
2. **Template Efficiency**: Keep templates lightweight
3. **Window Management**: Use "remember last position" for consistency

### Organization Tips

1. **Naming Conventions**: Include project prefixes in patterns
2. **Tag System**: Add tags via templates for easy filtering
3. **Regular Reviews**: Use picker to review and clean up notes

## Conclusion

PopNote transforms quick note-taking in Obsidian by providing instant access, flexible organization, and powerful window management. Whether you're capturing fleeting thoughts or managing project notes, PopNote adapts to your workflow.

For technical details and settings reference, see the [Settings Reference Guide](./settings.md).