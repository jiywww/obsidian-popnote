import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type PopNotePlugin from '../core/PopNotePlugin';
import { FolderSuggest } from '../ui/FolderSuggest';
import { FileSuggest } from '../ui/FileSuggest';

export class PopNoteSettingTab extends PluginSettingTab {
	plugin: PopNotePlugin;

	constructor(app: App, plugin: PopNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Main title
		containerEl.createEl('h3', { text: 'PopNote Settings' });
		containerEl.createEl('p', {
			text: 'Configure how PopNote creates, manages, and organizes your notes.',
			cls: 'setting-item-description'
		});

		// Pop notes folder
		new Setting(containerEl)
			.setName('PopNote folder')
			.setDesc('Folder where PopNotes will be stored')
			.addText(text => {
				new FolderSuggest(this.app, text.inputEl);
				text
					.setPlaceholder('PopNotes')
					.setValue(this.plugin.settings.popNotesFolder)
					.onChange(async (value) => {
						// Trim and remove trailing slash
						value = value.trim().replace(/\/$/, '');
						this.plugin.settings.popNotesFolder = value;
						await this.plugin.saveSettings();
					});
			});

		// Note naming pattern
		new Setting(containerEl)
			.setName('Note name pattern')
			.setDesc('Pattern for new note names. Available variables: {{date}}, {{time}}, {{timestamp}}, {{year}}, {{month}}, {{day}}, {{hour}}, {{minute}}, {{second}}')
			.addText(text => text
				.setPlaceholder('PopNote {{date}} {{time}}')
				.setValue(this.plugin.settings.noteNamePattern)
				.onChange(async (value) => {
					this.plugin.settings.noteNamePattern = value;
					await this.plugin.saveSettings();
				}));

		// Template file
		new Setting(containerEl)
			.setName('Template file')
			.setDesc('Optional template file for new PopNotes. Available variables: {{title}}, {{date}}, {{time}}, {{timestamp}}, {{year}}, {{month}}, {{day}}, {{hour}}, {{minute}}, {{second}}')
			.addText(text => {
				new FileSuggest(this.app, text.inputEl);
				text
					.setPlaceholder('Templates/PopNote Template.md')
					.setValue(this.plugin.settings.templateFile)
					.onChange(async (value) => {
						this.plugin.settings.templateFile = value;
						await this.plugin.saveSettings();
					});
			});

		// Buffer time
		new Setting(containerEl)
			.setName('Buffer time')
			.setDesc('Time period for reusing the last created note')
			.addDropdown(dropdown => {
				dropdown
					.addOption('none', 'Always create new note')
					.addOption('permanent', 'Always reuse last note')
					.addOption('custom', 'Custom time (minutes)');

				if (this.plugin.settings.bufferTime === 'none' || this.plugin.settings.bufferTime === 'permanent') {
					dropdown.setValue(this.plugin.settings.bufferTime);
				} else {
					dropdown.setValue('custom');
				}

				dropdown.onChange(async (value) => {
					if (value === 'none' || value === 'permanent') {
						this.plugin.settings.bufferTime = value as 'none' | 'permanent';
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide custom time input
					} else {
						this.plugin.settings.bufferTime = 5; // Default to 5 minutes
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide custom time input
					}
				});
			});

		// Custom buffer time input
		if (typeof this.plugin.settings.bufferTime === 'number') {
			new Setting(containerEl)
				.setName('Buffer time (minutes)')
				.setDesc('Number of minutes to reuse the last created note')
				.addText(text => text
					.setPlaceholder('5')
					.setValue(this.plugin.settings.bufferTime.toString())
					.onChange(async (value) => {
						const minutes = parseInt(value);
						if (!isNaN(minutes) && minutes > 0) {
							this.plugin.settings.bufferTime = minutes;
							await this.plugin.saveSettings();
						}
					}));
		}

		// Sort order
		new Setting(containerEl)
			.setName('Sort order')
			.setDesc('How to sort notes in navigation and picker')
			.addDropdown(dropdown => dropdown
				.addOption('created', 'Creation time')
				.addOption('modified', 'Last modified time')
				.setValue(this.plugin.settings.sortOrder)
				.onChange(async (value) => {
					this.plugin.settings.sortOrder = value as 'created' | 'modified';
					await this.plugin.saveSettings();
				}));

		// Window settings
		containerEl.createEl('h3', { text: 'Window Settings' });
		containerEl.createEl('p', {
			text: 'Control how PopNote windows appear and behave.',
			cls: 'setting-item-description'
		});

		// Store references to width and height settings for visibility control
		let widthSetting: Setting;
		let heightSetting: Setting;

		new Setting(containerEl)
			.setName('Window size mode')
			.setDesc('Choose how window sizes are handled')
			.addDropdown(dropdown => dropdown
				.addOption('fixed', 'Fixed - Always use default size')
				.addOption('remember', 'Remember - Use last window size')
				.setValue(this.plugin.settings.windowSizeMode)
				.onChange(async (value) => {
					this.plugin.settings.windowSizeMode = value as 'fixed' | 'remember';
					await this.plugin.saveSettings();
					// Update visibility of default size settings
					if (widthSetting && heightSetting) {
						const display = value === 'fixed' ? 'flex' : 'none';
						widthSetting.settingEl.style.display = display;
						heightSetting.settingEl.style.display = display;
					}
				}));

		widthSetting = new Setting(containerEl)
			.setName('Default window width')
			.setDesc('Width of new PopNote windows (pixels)')
			.addText(text => text
				.setPlaceholder('800')
				.setValue(this.plugin.settings.defaultWindowWidth.toString())
				.onChange(async (value) => {
					const width = parseInt(value);
					if (!isNaN(width) && width > 0) {
						this.plugin.settings.defaultWindowWidth = width;
						await this.plugin.saveSettings();
					}
				}));

		heightSetting = new Setting(containerEl)
			.setName('Default window height')
			.setDesc('Height of new PopNote windows (pixels)')
			.addText(text => text
				.setPlaceholder('600')
				.setValue(this.plugin.settings.defaultWindowHeight.toString())
				.onChange(async (value) => {
					const height = parseInt(value);
					if (!isNaN(height) && height > 0) {
						this.plugin.settings.defaultWindowHeight = height;
						await this.plugin.saveSettings();
					}
				}));

		// Set initial visibility based on current mode
		if (this.plugin.settings.windowSizeMode === 'remember') {
			widthSetting.settingEl.style.display = 'none';
			heightSetting.settingEl.style.display = 'none';
		}

		// Window position setting
		new Setting(containerEl)
			.setName('Window position')
			.setDesc('Where to place the PopNote window')
			.addDropdown(dropdown => dropdown
				.addOption('center', 'Center - Center of screen')
				.addOption('left', 'Left - Left side of screen')
				.addOption('right', 'Right - Right side of screen')
				.addOption('last', 'Last - Remember last position')
				.setValue(this.plugin.settings.windowPosition)
				.onChange(async (value) => {
					this.plugin.settings.windowPosition = value as 'center' | 'left' | 'right' | 'last';
					await this.plugin.saveSettings();
				}));

		// Cursor position setting
		new Setting(containerEl)
			.setName('Cursor position')
			.setDesc('Where to place the cursor when opening a note')
			.addDropdown(dropdown => dropdown
				.addOption('start', 'Start - Beginning of note')
				.addOption('end', 'End - End of note')
				.addOption('last', 'Last - Remember last position')
				.setValue(this.plugin.settings.cursorPosition)
				.onChange(async (value) => {
					this.plugin.settings.cursorPosition = value as 'start' | 'end' | 'last';
					await this.plugin.saveSettings();
				}));

		// Window behavior settings
		containerEl.createEl('h3', { text: 'Window Behavior' });
		containerEl.createEl('p', {
			text: 'Configure how PopNote windows interact with other windows.',
			cls: 'setting-item-description'
		});

		// Window level setting
		const windowLevelSetting = new Setting(containerEl)
			.setName('Window level')
			.setDesc('Choose how PopNote windows behave.')
			.addDropdown(dropdown => dropdown
				.addOption('screen-saver', 'Fullscreen')
				.addOption('floating', 'Floating')
				.addOption('normal', 'Normal')
				.setValue(this.plugin.settings.windowLevel)
				.onChange(async (value) => {
					this.plugin.settings.windowLevel = value as 'screen-saver' | 'floating' | 'normal';
					await this.plugin.saveSettings();
					// Update the visibility of the visibleOnAllWorkspaces setting
					updateFloatingSettingsVisibility();
				}));
		
		// Add detailed description
		const windowLevelDesc = windowLevelSetting.descEl;
		windowLevelDesc.empty();
		windowLevelDesc.createSpan({ text: 'Controls how PopNote windows behave:' });
		windowLevelDesc.createEl('br');
		windowLevelDesc.createEl('br');
		
		// Fullscreen description
		windowLevelDesc.createEl('strong', { text: '• Fullscreen: ' });
		windowLevelDesc.createSpan({ text: 'Appears above fullscreen apps. ' });
		if (process.platform === 'darwin') {
			windowLevelDesc.createSpan({ text: 'May affect dock behavior.', cls: 'mod-warning' });
		}
		windowLevelDesc.createEl('br');
		
		// Floating description
		windowLevelDesc.createEl('strong', { text: '• Floating: ' });
		windowLevelDesc.createSpan({ text: 'Always on top, better OS integration. No fullscreen support.' });
		windowLevelDesc.createEl('br');
		
		// Normal description
		windowLevelDesc.createEl('strong', { text: '• Normal: ' });
		windowLevelDesc.createSpan({ text: 'Standard window behavior, no floating.' });

		// macOS specific setting - only show if always-on-top is enabled and on macOS
		const visibleOnAllWorkspacesSetting = new Setting(containerEl)
			.setName('Visible on all workspaces')
			.setDesc('Required for floating above fullscreen apps on macOS. Prevents desktop space switching when using PopNote with fullscreen applications.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.visibleOnAllWorkspaces)
				.onChange(async (value) => {
					this.plugin.settings.visibleOnAllWorkspaces = value;
					await this.plugin.saveSettings();
				}));

		// Control visibility based on window level
		const updateFloatingSettingsVisibility = () => {
			const windowLevel = this.plugin.settings.windowLevel;
			
			// Show visibleOnAllWorkspaces only on macOS and when using screen-saver level
			if (process.platform === 'darwin' && windowLevel === 'screen-saver') {
				visibleOnAllWorkspacesSetting.settingEl.style.display = 'flex';
			} else {
				visibleOnAllWorkspacesSetting.settingEl.style.display = 'none';
			}
		};

		// Set initial visibility
		updateFloatingSettingsVisibility();

		// Global hotkey section
		containerEl.createEl('h3', { text: 'Global Hotkey' });
		containerEl.createEl('p', {
			text: 'Set up a system-wide hotkey that works even when Obsidian is not focused.',
			cls: 'setting-item-description'
		});

		// Global hotkey setting with improved UI
		const globalHotkeySetting = new Setting(containerEl)
			.setName('Create/open PopNote')
			.setDesc('Configure the global hotkey to create or open a PopNote from anywhere.');
		
		// Create container that spans the full width below the setting
		const hotkeyFullContainer = containerEl.createDiv({ cls: 'popnote-hotkey-full-container' });
		
		// Current hotkey display (at the top)
		const currentHotkeyContainer = hotkeyFullContainer.createDiv({ cls: 'popnote-current-hotkey-container' });
		currentHotkeyContainer.createEl('span', { text: 'Current: ', cls: 'popnote-label' });
		const currentHotkeyDisplay = currentHotkeyContainer.createEl('span', { cls: 'popnote-current-hotkey' });
		
		// Create modifiers container
		const modifiersContainer = hotkeyFullContainer.createDiv({ cls: 'popnote-modifiers-container' });
		modifiersContainer.createEl('span', { text: 'Modifiers: ', cls: 'popnote-label' });
		
		// Platform-specific modifiers
		const isMac = process.platform === 'darwin';
		const modifiers = isMac 
			? [
				{ value: 'Cmd', label: '⌘ Cmd' },
				{ value: 'Ctrl', label: '⌃ Ctrl' },
				{ value: 'Alt', label: '⌥ Option' },
				{ value: 'Shift', label: '⇧ Shift' }
			]
			: [
				{ value: 'Ctrl', label: 'Ctrl' },
				{ value: 'Alt', label: 'Alt' },
				{ value: 'Shift', label: 'Shift' },
				{ value: 'Super', label: 'Super/Win' }
			];
		
		// Keep track of selected modifiers
		const selectedModifiers: Set<string> = new Set();
		
		// Parse current hotkey to set initial state
		const currentHotkey = this.plugin.settings.createNoteHotkey;
		let currentKey = '';
		if (currentHotkey) {
			const parts = currentHotkey.split('+');
			currentKey = parts[parts.length - 1];
			parts.slice(0, -1).forEach(mod => {
				// Handle CmdOrCtrl
				if (mod === 'CmdOrCtrl') {
					selectedModifiers.add(isMac ? 'Cmd' : 'Ctrl');
				} else if (mod === 'Option' && isMac) {
					// Handle Option on macOS (stored as Alt internally)
					selectedModifiers.add('Alt');
				} else {
					selectedModifiers.add(mod);
				}
			});
		}
		
		// Create checkboxes for modifiers
		const modifierCheckboxes: Record<string, HTMLInputElement> = {};
		modifiers.forEach(mod => {
			const label = modifiersContainer.createEl('label', { cls: 'popnote-modifier-label' });
			const checkbox = label.createEl('input', { 
				type: 'checkbox',
				cls: 'popnote-modifier-checkbox'
			});
			checkbox.checked = selectedModifiers.has(mod.value);
			modifierCheckboxes[mod.value] = checkbox;
			label.createSpan({ text: mod.label });
			
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					selectedModifiers.add(mod.value);
				} else {
					selectedModifiers.delete(mod.value);
				}
				updateHotkey();
			});
		});
		
		// Create key input
		const keyContainer = hotkeyFullContainer.createDiv({ cls: 'popnote-key-container' });
		keyContainer.createEl('span', { text: 'Key: ', cls: 'popnote-label' });
		const keyInput = keyContainer.createEl('input', {
			type: 'text',
			placeholder: 'e.g., N, P, Space',
			value: currentKey,
			cls: 'popnote-key-input'
		});
		
		// Add help link for valid key codes
		keyContainer.createEl('a', {
			text: 'Available key codes',
			href: 'https://www.electronjs.org/docs/latest/api/accelerator#available-key-codes',
			cls: 'popnote-key-help-link'
		});
		
		// Function to update the hotkey
		const updateHotkey = async () => {
			const key = keyInput.value.trim();
			if (!key) {
				currentHotkeyDisplay.setText('No hotkey set');
				this.plugin.settings.createNoteHotkey = '';
				await this.plugin.saveSettingsAndReloadHotkeys();
				return;
			}
			
			// Build hotkey string
			const modifiersList = Array.from(selectedModifiers).sort();
			if (modifiersList.length === 0) {
				currentHotkeyDisplay.setText('⚠️ At least one modifier required');
				currentHotkeyDisplay.addClass('mod-warning');
				return;
			}
			
			currentHotkeyDisplay.removeClass('mod-warning');
			
			// Build the hotkey string
			const hotkeyParts = [...modifiersList, key];
			const hotkey = hotkeyParts.join('+');
			
			// Update display - convert Alt to Option on macOS for display
			let displayHotkey = hotkey;
			if (isMac && displayHotkey.includes('Alt')) {
				displayHotkey = displayHotkey.replace(/Alt/g, 'Option');
			}
			currentHotkeyDisplay.setText(displayHotkey);
			
			// Save hotkey
			this.plugin.settings.createNoteHotkey = hotkey;
			if (this.plugin.isValidHotkey(hotkey)) {
				await this.plugin.saveSettingsAndReloadHotkeys();
			}
		};
		
		// Add input listener for key
		keyInput.addEventListener('input', () => {
			// Allow only single keys or special keys
			let value = keyInput.value;
			
			// Handle special keys
			const specialKeys = ['Space', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 
								'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right'];
			
			// If it's not a special key, take only the last character
			if (!specialKeys.some(k => value.toLowerCase() === k.toLowerCase())) {
				value = value.slice(-1).toUpperCase();
			}
			
			keyInput.value = value;
			updateHotkey();
		});
		
		// Initial update
		updateHotkey();
		
		// Add CSS styles if not already added
		if (!document.getElementById('popnote-settings-styles')) {
			const style = document.createElement('style');
			style.id = 'popnote-settings-styles';
			style.textContent = `
				.popnote-hotkey-full-container {
					margin-top: 10px;
					margin-bottom: 20px;
					display: flex;
					flex-direction: column;
					gap: 15px;
				}
				.popnote-current-hotkey-container,
				.popnote-modifiers-container,
				.popnote-key-container {
					display: flex;
					align-items: center;
					gap: 10px;
					flex-wrap: wrap;
				}
				.popnote-modifier-label {
					display: flex;
					align-items: center;
					gap: 5px;
					margin: 0;
				}
				.popnote-modifier-checkbox {
					margin: 0;
				}
				.popnote-key-input {
					width: 100px;
				}
				.popnote-current-hotkey {
					font-family: monospace;
					color: var(--text-muted);
					padding: 8px 12px;
					background: var(--background-modifier-form-field);
					border-radius: 4px;
					white-space: nowrap;
				}
				.popnote-current-hotkey.mod-warning {
					color: var(--text-error);
					background: var(--background-modifier-error);
				}
				.popnote-label {
					font-weight: 500;
					min-width: 80px;
					display: inline-block;
				}
				.popnote-file-suggestion-folder {
					color: var(--text-muted);
					font-size: 0.9em;
				}
				.popnote-key-help-link {
					font-size: 0.85em;
					margin-left: 10px;
				}
			`;
			document.head.appendChild(style);
		}

		// Obsidian hotkeys info
		containerEl.createEl('h3', { text: 'Obsidian Hotkeys' });
		containerEl.createEl('p', {
			text: 'Configure additional hotkeys within Obsidian for navigation and quick actions.',
			cls: 'setting-item-description'
		});
		containerEl.createEl('p', {
			text: 'Go to Obsidian Settings → Hotkeys and search for "PopNote" to find these commands:'
		});

		const hotkeyList = containerEl.createEl('ul');
		hotkeyList.createEl('li', { text: 'PopNote: Navigate to previous PopNote' });
		hotkeyList.createEl('li', { text: 'PopNote: Navigate to next PopNote' });
		hotkeyList.createEl('li', { text: 'PopNote: Show PopNote picker' });

		// Picker keyboard shortcuts
		containerEl.createEl('h3', { text: 'PopNote Picker Shortcuts' });
		containerEl.createEl('p', {
			text: 'Customize keyboard shortcuts for actions within the PopNote picker. Use Cmd (Mac) or Ctrl (Windows/Linux) instead of "Mod". Example: "Cmd+P" or "Ctrl+P"',
			cls: 'setting-item-description'
		});

		new Setting(containerEl)
			.setName('Pin/Unpin shortcut')
			.setDesc('Keyboard shortcut to pin or unpin a note in the picker')
			.addText(text => text
				.setPlaceholder('Cmd+P or Ctrl+P')
				.setValue(this.plugin.settings.pickerPinShortcut)
				.onChange(async (value) => {
					this.plugin.settings.pickerPinShortcut = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Delete shortcut')
			.setDesc('Keyboard shortcut to delete a note in the picker')
			.addText(text => text
				.setPlaceholder('Cmd+D or Ctrl+D')
				.setValue(this.plugin.settings.pickerDeleteShortcut)
				.onChange(async (value) => {
					this.plugin.settings.pickerDeleteShortcut = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Open in new tab shortcut')
			.setDesc('Keyboard shortcut to open a note in a new tab')
			.addText(text => text
				.setPlaceholder('Cmd+Enter or Ctrl+Enter')
				.setValue(this.plugin.settings.pickerOpenInNewTabShortcut)
				.onChange(async (value) => {
					this.plugin.settings.pickerOpenInNewTabShortcut = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Open in PopNote window shortcut')
			.setDesc('Keyboard shortcut to open a note in the PopNote window')
			.addText(text => text
				.setPlaceholder('Alt+Enter')
				.setValue(this.plugin.settings.pickerOpenInNewWindowShortcut)
				.onChange(async (value) => {
					this.plugin.settings.pickerOpenInNewWindowShortcut = value;
					await this.plugin.saveSettings();
				}));

		// Debug settings
		containerEl.createEl('h3', { text: 'Developer Settings' });

		new Setting(containerEl)
			.setName('Debug mode')
			.setDesc('Enable debug logging to console (for troubleshooting)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
					new Notice(value ? 'Debug mode enabled' : 'Debug mode disabled');
				}));
	}
}