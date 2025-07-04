import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath, MarkdownView, Vault, FuzzySuggestModal, FuzzyMatch, Modifier, TextComponent } from 'obsidian';

// Access Electron APIs
const { remote } = require('electron');
const { globalShortcut, BrowserWindow, getCurrentWindow, app } = remote;

interface PopNoteSettings {
	popNotesFolder: string;
	templateFile: string;
	bufferTime: 'none' | 'permanent' | number; // number represents minutes
	sortOrder: 'created' | 'modified';
	noteNamePattern: string;
	createNoteHotkey: string; // Global hotkey for creating notes
	defaultWindowWidth: number;
	defaultWindowHeight: number;
	pinnedNotes: string[]; // Array of note paths
	autoMinimizeMode: 'off' | 'dynamic' | 'always'; // How to handle main window when closing pop notes
	windowSizeMode: 'fixed' | 'remember'; // Whether to use fixed size or remember last used size
	lastUsedWindowSize: {
		width: number;
		height: number;
	} | null;
	lastCreatedNote: {
		path: string;
		timestamp: number;
	} | null;
	// Picker keyboard shortcuts
	pickerPinShortcut: string;
	pickerDeleteShortcut: string;
	pickerOpenInNewTabShortcut: string;
	pickerOpenInNewWindowShortcut: string;
}

const DEFAULT_SETTINGS: PopNoteSettings = {
	popNotesFolder: 'PopNotes',
	templateFile: '',
	bufferTime: 5, // 5 minutes default
	sortOrder: 'modified',
	noteNamePattern: 'PopNote {{date}} {{time}}',
	createNoteHotkey: 'CmdOrCtrl+Shift+N',
	defaultWindowWidth: 800,
	defaultWindowHeight: 600,
	pinnedNotes: [],
	autoMinimizeMode: 'dynamic',
	windowSizeMode: 'fixed',
	lastUsedWindowSize: null,
	lastCreatedNote: null,
	// Picker keyboard shortcuts
	pickerPinShortcut: 'Mod+P',
	pickerDeleteShortcut: 'Mod+D',
	pickerOpenInNewTabShortcut: 'Mod+Enter',
	pickerOpenInNewWindowShortcut: 'Alt+Enter'
}

// Modal for selecting template files
class TemplateFileSelectorModal extends FuzzySuggestModal<TFile> {
	plugin: PopNotePlugin;
	onSelect: (file: TFile) => void;

	constructor(app: App, plugin: PopNotePlugin, onSelect: (file: TFile) => void) {
		super(app);
		this.plugin = plugin;
		this.onSelect = onSelect;
		this.setPlaceholder('Select a template file...');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(file);
	}
}

export default class PopNotePlugin extends Plugin {
	settings: PopNoteSettings;
	private registeredHotkeys: string[] = [];
	private openWindows: Map<string, any> = new Map();
	private lastNavigationTimestamp: number = 0;
	private shouldCreateNewNote: boolean = false;
	private popNoteWindowIds: Set<number> = new Set();
	private minimizeScheduled: boolean = false;
	private mainWindowVisibleBeforePopNote: Map<number, boolean> = new Map();

	async onload() {
		await this.loadSettings();

		// Check if globalShortcut is available
		if (!globalShortcut) {
			console.error('globalShortcut is not available');
			new Notice('PopNote: Global shortcuts are not available. Plugin may not work correctly.');
		} else {
			console.log('globalShortcut is available');

			// Clean up any previously registered hotkeys before registering new ones
			if (this.settings.createNoteHotkey) {
				try {
					if (globalShortcut.isRegistered(this.settings.createNoteHotkey)) {
						console.log(`Found previously registered hotkey ${this.settings.createNoteHotkey}, cleaning up...`);
						globalShortcut.unregister(this.settings.createNoteHotkey);
					}
				} catch (error) {
					console.error('Error cleaning up previous hotkeys:', error);
				}
			}
		}

		// Register all global hotkeys
		this.registerGlobalHotkeys();

		// Add command for creating pop notes (also accessible from command palette)
		this.addCommand({
			id: 'create-pop-note',
			name: 'Create or open PopNote',
			callback: () => {
				this.createOrOpenPopNote();
			}
		});

		// Add command for navigating to previous note
		this.addCommand({
			id: 'navigate-previous-pop-note',
			name: 'Navigate to previous PopNote',
			callback: () => {
				this.navigateNote('previous');
			}
		});

		// Add command for navigating to next note
		this.addCommand({
			id: 'navigate-next-pop-note',
			name: 'Navigate to next PopNote',
			callback: () => {
				this.navigateNote('next');
			}
		});

		// Add command for showing picker
		this.addCommand({
			id: 'show-pop-notes-picker',
			name: 'Show PopNote picker',
			callback: () => {
				new PopNotePickerModal(this.app, this).open();
			}
		});

		// Add settings tab
		this.addSettingTab(new PopNoteSettingTab(this.app, this));

		// Clean up closed windows from our tracking
		this.registerInterval(
			window.setInterval(() => {
				this.cleanupClosedWindows();
			}, 5000)
		);

		// Check for scheduled minimize
		this.registerInterval(
			window.setInterval(() => {
				if (this.minimizeScheduled) {
					this.checkAndMinimizeMainWindow();
				}
			}, 100)
		);

		// Listen for window close events
		this.registerEvent(
			this.app.workspace.on('window-close', (workspaceWindow) => {
				console.log('Window close event detected');
				if (this.settings.autoMinimizeMode !== 'off') {
					// Schedule minimize with a longer delay
					setTimeout(() => {
						this.handleMainWindowAfterPopNoteClose();
					}, 500);
				}
			})
		);
	}

	onunload() {
		console.log('PopNote plugin unloading...');

		// Unregister all global hotkeys
		this.unregisterGlobalHotkeys();

		// Extra cleanup - unregister the specific hotkey even if not in our list
		if (globalShortcut && this.settings.createNoteHotkey) {
			try {
				if (globalShortcut.isRegistered(this.settings.createNoteHotkey)) {
					globalShortcut.unregister(this.settings.createNoteHotkey);
					console.log(`Extra cleanup: unregistered ${this.settings.createNoteHotkey}`);
				}
			} catch (error) {
				console.error('Error in extra cleanup:', error);
			}
		}

		console.log('PopNote plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Re-register hotkeys when settings change
		this.unregisterGlobalHotkeys();
		this.registerGlobalHotkeys();
	}

	private registerGlobalHotkeys() {
		if (!globalShortcut) {
			console.error('globalShortcut is not available, skipping global hotkey registration');
			return;
		}

		console.log('Registering global hotkey for creating PopNotes...');

		// Only register the create note hotkey globally
		if (this.settings.createNoteHotkey && this.isValidHotkey(this.settings.createNoteHotkey)) {
			try {
				// First check if the hotkey is already registered
				if (globalShortcut.isRegistered(this.settings.createNoteHotkey)) {
					console.log(`Hotkey ${this.settings.createNoteHotkey} is already registered, unregistering first...`);
					globalShortcut.unregister(this.settings.createNoteHotkey);
				}

				const success = globalShortcut.register(this.settings.createNoteHotkey, () => {
					console.log('Global create note hotkey triggered');
					this.createOrOpenPopNote();
				});

				if (success) {
					this.registeredHotkeys.push(this.settings.createNoteHotkey);
					console.log(`Successfully registered global hotkey: ${this.settings.createNoteHotkey}`);
				} else {
					console.error(`Failed to register global hotkey: ${this.settings.createNoteHotkey}`);
					new Notice('Failed to register global hotkey. It may be already in use by another application.');
				}
			} catch (error) {
				console.error(`Error registering global hotkey:`, error);
				new Notice('Error registering global hotkey. Check console for details.');
			}
		}
	}

	isValidHotkey(hotkey: string): boolean {
		// Basic validation to ensure hotkey is properly formatted
		if (!hotkey || hotkey.trim().length === 0) {
			return false;
		}

		// Check if hotkey ends with a modifier key (incomplete)
		const incompletePatterns = ['+', 'Ctrl+', 'Cmd+', 'Alt+', 'Shift+', 'CmdOrCtrl+'];
		for (const pattern of incompletePatterns) {
			if (hotkey.endsWith(pattern)) {
				return false;
			}
		}

		// Check if hotkey contains at least one actual key (not just modifiers)
		const modifiers = ['ctrl', 'cmd', 'alt', 'shift', 'cmdorctrl', 'option', 'command', 'control'];
		const parts = hotkey.toLowerCase().split('+');
		const hasActualKey = parts.some(part => !modifiers.includes(part.trim()));

		return hasActualKey;
	}

	private unregisterGlobalHotkeys() {
		if (!globalShortcut) {
			console.log('globalShortcut not available, skipping unregister');
			return;
		}

		console.log('Unregistering global hotkeys...');
		this.registeredHotkeys.forEach(hotkey => {
			try {
				if (globalShortcut.isRegistered(hotkey)) {
					globalShortcut.unregister(hotkey);
					console.log(`Successfully unregistered hotkey: ${hotkey}`);
				} else {
					console.log(`Hotkey ${hotkey} was not registered`);
				}
			} catch (error) {
				console.error(`Failed to unregister hotkey ${hotkey}:`, error);
			}
		});
		this.registeredHotkeys = [];
	}

	async createOrOpenPopNote() {
		console.log('createOrOpenPopNote called');

		// Check buffer time logic
		const shouldReuseNote = this.shouldReuseLastNote();
		console.log('Should reuse note:', shouldReuseNote);

		let noteFile: TFile;
		if (shouldReuseNote && this.settings.lastCreatedNote) {
			// Try to find the existing note
			const existingFile = this.app.vault.getAbstractFileByPath(this.settings.lastCreatedNote.path);
			if (existingFile && existingFile instanceof TFile) {
				noteFile = existingFile;
			} else {
				// If note doesn't exist anymore, create new one
				noteFile = await this.createNewPopNote();
			}
		} else {
			noteFile = await this.createNewPopNote();
		}

		// Open in new window
		await this.openNoteInNewWindow(noteFile);
	}

	private shouldReuseLastNote(): boolean {
		if (!this.settings.lastCreatedNote) return false;

		if (this.settings.bufferTime === 'none') return false;
		if (this.settings.bufferTime === 'permanent') return true;

		// Check if within buffer time (in minutes)
		const bufferMs = this.settings.bufferTime * 60 * 1000;
		const timeSinceLastNote = Date.now() - this.settings.lastCreatedNote.timestamp;

		return timeSinceLastNote < bufferMs;
	}

	private async createNewPopNote(): Promise<TFile> {
		// Ensure pop notes folder exists
		const folderPath = normalizePath(this.settings.popNotesFolder);
		if (!this.app.vault.getAbstractFileByPath(folderPath)) {
			await this.app.vault.createFolder(folderPath);
		}

		// Generate note name from pattern
		const noteName = this.generateNoteName();
		const notePath = normalizePath(`${folderPath}/${noteName}.md`);

		// Get template content
		let content = '';
		if (this.settings.templateFile) {
			// Normalize the template file path
			const normalizedTemplatePath = normalizePath(this.settings.templateFile);
			const templateFile = this.app.vault.getAbstractFileByPath(normalizedTemplatePath);

			if (templateFile && templateFile instanceof TFile) {
				try {
					content = await this.app.vault.read(templateFile);
					// Process template variables
					content = this.processTemplate(content);
					console.log('Template applied successfully from:', normalizedTemplatePath);
				} catch (error) {
					console.error('Error reading template file:', error);
					new Notice(`Failed to read template file: ${this.settings.templateFile}`);
				}
			} else {
				console.warn('Template file not found:', normalizedTemplatePath);
				// Don't show notice for empty template setting
				if (this.settings.templateFile.trim()) {
					new Notice(`Template file not found: ${this.settings.templateFile}`);
				}
			}
		}

		// Create the note
		const noteFile = await this.app.vault.create(notePath, content);

		// Update last created note
		this.settings.lastCreatedNote = {
			path: noteFile.path,
			timestamp: Date.now()
		};
		await this.saveSettings();

		return noteFile;
	}

	private generateNoteName(): string {
		const now = new Date();
		const replacements: Record<string, string> = {
			'{{date}}': now.toISOString().split('T')[0],
			'{{time}}': now.toTimeString().split(' ')[0].replace(/:/g, '-'),
			'{{timestamp}}': now.getTime().toString(),
			'{{year}}': now.getFullYear().toString(),
			'{{month}}': (now.getMonth() + 1).toString().padStart(2, '0'),
			'{{day}}': now.getDate().toString().padStart(2, '0'),
			'{{hour}}': now.getHours().toString().padStart(2, '0'),
			'{{minute}}': now.getMinutes().toString().padStart(2, '0'),
			'{{second}}': now.getSeconds().toString().padStart(2, '0')
		};

		let name = this.settings.noteNamePattern;
		for (const [key, value] of Object.entries(replacements)) {
			name = name.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), value);
		}

		return name;
	}

	private processTemplate(template: string): string {
		const now = new Date();
		const replacements: Record<string, string> = {
			'{{date}}': now.toLocaleDateString(),
			'{{time}}': now.toLocaleTimeString(),
			'{{title}}': this.generateNoteName(),
			'{{timestamp}}': now.getTime().toString(),
			'{{year}}': now.getFullYear().toString(),
			'{{month}}': (now.getMonth() + 1).toString().padStart(2, '0'),
			'{{day}}': now.getDate().toString().padStart(2, '0'),
			'{{hour}}': now.getHours().toString().padStart(2, '0'),
			'{{minute}}': now.getMinutes().toString().padStart(2, '0'),
			'{{second}}': now.getSeconds().toString().padStart(2, '0'),
			'{{weekday}}': now.toLocaleDateString('en-US', { weekday: 'long' }),
			'{{monthname}}': now.toLocaleDateString('en-US', { month: 'long' })
		};

		let processed = template;
		for (const [key, value] of Object.entries(replacements)) {
			processed = processed.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), value);
		}

		return processed;
	}

	async openNoteInNewWindow(file: TFile) {
		// Check if file is already open in a window
		const existingWindow = this.openWindows.get(file.path);
		if (existingWindow && !existingWindow.isDestroyed()) {
			existingWindow.focus();
			return;
		}

		// Record main window visibility before creating popout
		let mainWindowVisible = false;
		try {
			const allWindows = BrowserWindow.getAllWindows();
			const mainWindow = allWindows.find((w: any) =>
				!w.isDestroyed() &&
				!this.popNoteWindowIds.has(w.id) &&
				w.isVisible()
			);
			mainWindowVisible = !!mainWindow;
			console.log('Main window visible before PopNote:', mainWindowVisible);
		} catch (error) {
			console.error('Error checking main window visibility:', error);
		}

		// Determine window size based on settings
		let width: number;
		let height: number;

		if (this.settings.windowSizeMode === 'remember' && this.settings.lastUsedWindowSize) {
			// Use last remembered size
			width = this.settings.lastUsedWindowSize.width;
			height = this.settings.lastUsedWindowSize.height;
		} else {
			// Use default fixed size
			width = this.settings.defaultWindowWidth;
			height = this.settings.defaultWindowHeight;
		}

		// Create new popout window with specified size
		const windowData = {
			size: {
				width: width,
				height: height
			}
		};
		const leaf = this.app.workspace.openPopoutLeaf(windowData);

		// Open the file
		await leaf.openFile(file);

		// Track the window and set up auto-minimize
		setTimeout(() => {
			try {
				// Get all windows and find the newest one
				const allWindows = BrowserWindow.getAllWindows();
				console.log('All windows count:', allWindows.length);

				// Find the newest window (should be the popout)
				let newWindow: any = null;

				// First try to find a window that's not the main window
				for (let i = allWindows.length - 1; i >= 0; i--) {
					const w = allWindows[i];
					if (!w.isDestroyed()) {
						const url = w.webContents.getURL();
						console.log(`Window ${i} URL:`, url);

						// Popout windows often have about:blank URL initially
						if (url === 'about:blank' || (url && !url.includes('index.html'))) {
							newWindow = w;
							break;
						}
					}
				}

				// Fallback to the last window
				if (!newWindow) {
					newWindow = allWindows[allWindows.length - 1];
				}

				if (newWindow) {
					this.openWindows.set(file.path, newWindow);
					this.popNoteWindowIds.add(newWindow.id);
					this.mainWindowVisibleBeforePopNote.set(newWindow.id, mainWindowVisible);
					console.log('Tracked PopNote window:', file.path, 'ID:', newWindow.id);

					// Add resize listener if in remember mode
					if (this.settings.windowSizeMode === 'remember') {
						newWindow.on('resize', () => {
							const [newWidth, newHeight] = newWindow.getSize();
							this.settings.lastUsedWindowSize = {
								width: newWidth,
								height: newHeight
							};
							this.saveSettings();
							console.log(`Saved new window size: ${newWidth}x${newHeight}`);
						});
					}

					// Use 'close' event instead of 'closed'
					newWindow.on('close', () => {
						console.log('PopNote window closing, setting up auto-minimize...');
						const wasMainWindowVisible = this.mainWindowVisibleBeforePopNote.get(newWindow.id) || false;

						this.popNoteWindowIds.delete(newWindow.id);
						this.openWindows.delete(file.path);
						this.mainWindowVisibleBeforePopNote.delete(newWindow.id);

						// Handle main window based on settings and previous state
						this.scheduleMainWindowMinimize(wasMainWindowVisible);
					});
				} else {
					console.log('Could not find new window to track');
				}
			} catch (error) {
				console.error('Failed to track window:', error);
			}
		}, 500); // Increased delay to ensure window is created
	}

	private navigateNote(direction: 'previous' | 'next') {
		console.log('navigateNote called:', direction);

		// Find current note from window
		const currentPath = this.getCurrentNotePathFromWindow();
		if (!currentPath) {
			console.log('No current note found');
			return;
		}

		// Get sorted pop notes
		this.getPopNotesSorted().then(async notes => {
			const currentIndex = notes.findIndex(note => note.path === currentPath);
			if (currentIndex === -1) return;

			let targetIndex: number;
			const now = Date.now();

			// Fix logic: "next" should go to newer notes (lower index), "previous" to older notes (higher index)
			if (direction === 'next') {
				// Going to newer note
				if (currentIndex === 0) {
					// Already at the newest note
					if (this.shouldCreateNewNote && (now - this.lastNavigationTimestamp) < 3000) {
						// User pressed again within 3 seconds, create new note
						console.log('Creating new note from navigation');
						const newNote = await this.createNewPopNote();
						const activeLeaf = this.app.workspace.getLeaf();
						if (activeLeaf) {
							await activeLeaf.openFile(newNote);
						}
						this.shouldCreateNewNote = false;
						return;
					} else {
						// Show notice and set flag
						new Notice('You are at the newest note. Press again to create a new note.');
						this.shouldCreateNewNote = true;
						this.lastNavigationTimestamp = now;
						return;
					}
				} else {
					targetIndex = currentIndex - 1;
					this.shouldCreateNewNote = false;
				}
			} else {
				// Going to older note
				if (currentIndex === notes.length - 1) {
					// Already at the oldest note
					new Notice('You are at the oldest note.');
					return;
				} else {
					targetIndex = currentIndex + 1;
					this.shouldCreateNewNote = false;
				}
			}

			const targetNote = notes[targetIndex];
			if (targetNote) {
				// Open target note in current window
				const activeLeaf = this.app.workspace.getLeaf();
				if (activeLeaf) {
					await activeLeaf.openFile(targetNote);
				}
			}
		});
	}

	private getCurrentNotePathFromWindow(): string | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file) {
			return activeView.file.path;
		}
		return null;
	}

	async getPopNotesSorted(): Promise<TFile[]> {
		const folder = this.app.vault.getAbstractFileByPath(this.settings.popNotesFolder);
		if (!folder || !(folder instanceof TFolder)) return [];

		const notes: TFile[] = [];
		Vault.recurseChildren(folder, (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				notes.push(file);
			}
		});

		// Sort by creation or modification time
		notes.sort((a, b) => {
			const timeA = this.settings.sortOrder === 'created' ? a.stat.ctime : a.stat.mtime;
			const timeB = this.settings.sortOrder === 'created' ? b.stat.ctime : b.stat.mtime;
			return timeB - timeA; // Newest first
		});

		// Move pinned notes to top
		const pinnedNotes = notes.filter(note => this.settings.pinnedNotes.includes(note.path));
		const unpinnedNotes = notes.filter(note => !this.settings.pinnedNotes.includes(note.path));

		return [...pinnedNotes, ...unpinnedNotes];
	}

	private cleanupClosedWindows() {
		for (const [path, window] of this.openWindows.entries()) {
			if (window.isDestroyed()) {
				this.openWindows.delete(path);
			}
		}
	}

	private scheduleMainWindowMinimize(wasMainWindowVisible: boolean = false) {
		console.log('Schedule minimize - Mode:', this.settings.autoMinimizeMode, 'Was visible:', wasMainWindowVisible);

		// Check settings
		if (this.settings.autoMinimizeMode === 'off') {
			return;
		}

		// Dynamic mode: only minimize if main window wasn't visible before
		if (this.settings.autoMinimizeMode === 'dynamic' && wasMainWindowVisible) {
			console.log('Dynamic mode: Main window was visible before, not minimizing');
			return;
		}

		// Always mode or dynamic mode with hidden main window
		console.log('Scheduling main window minimize...');
		this.minimizeScheduled = true;

		// Set timeout to stop checking after a few seconds
		setTimeout(() => {
			this.minimizeScheduled = false;
		}, 3000);
	}

	private checkAndMinimizeMainWindow() {
		try {
			const allWindows = BrowserWindow.getAllWindows();

			// Find a visible main window
			const mainWindow = allWindows.find((w: any) => {
				if (w.isDestroyed() || !w.isVisible()) return false;

				// Check if this is a main window (not a pop note)
				const isPopNote = this.popNoteWindowIds.has(w.id);
				if (isPopNote) return false;

				// For now, return true for any non-pop-note window
				return true;
			});

			if (mainWindow) {
				console.log('Found main window to minimize');
				mainWindow.minimize();
				this.minimizeScheduled = false;

				// Show notice
				new Notice('Main window minimized. Use the taskbar or dock to restore it.');
			}
		} catch (error) {
			console.error('Error checking/minimizing main window:', error);
		}
	}

	private handleMainWindowAfterPopNoteClose() {
		if (this.settings.autoMinimizeMode === 'off') {
			return;
		}

		// For always mode, just minimize
		if (this.settings.autoMinimizeMode === 'always') {
			this.forceMinimizeMainWindow();
			return;
		}

		// For dynamic mode, we rely on the window-specific tracking
		// The scheduleMainWindowMinimize will be called with the correct state
	}

	private forceMinimizeMainWindow() {
		if (this.settings.autoMinimizeMode === 'off') {
			return;
		}

		try {
			console.log('Force minimizing main window...');
			const allWindows = BrowserWindow.getAllWindows();

			// Try multiple strategies to find and minimize main window
			allWindows.forEach((w: any) => {
				if (w.isDestroyed()) return;

				try {
					const bounds = w.getBounds();
					const url = w.webContents.getURL();
					const isVisible = w.isVisible();

					console.log(`Window check - Visible: ${isVisible}, Size: ${bounds.width}x${bounds.height}, URL: ${url}`);

					// If it's visible and not a small window (pop notes are usually smaller)
					if (isVisible && !this.popNoteWindowIds.has(w.id)) {
						console.log('Minimizing window ID:', w.id);
						w.minimize();

						// Only show notice once
						if (!this.minimizeScheduled) {
							new Notice('Main window minimized. Use the taskbar or dock to restore it.');
							this.minimizeScheduled = true;

							// Reset flag after a delay
							setTimeout(() => {
								this.minimizeScheduled = false;
							}, 2000);
						}
					}
				} catch (err) {
					console.error('Error processing window:', err);
				}
			});
		} catch (error) {
			console.error('Error in forceMinimizeMainWindow:', error);
		}
	}


	async deletePopNote(file: TFile) {
		// Remove from pinned notes if present
		const pinnedIndex = this.settings.pinnedNotes.indexOf(file.path);
		if (pinnedIndex > -1) {
			this.settings.pinnedNotes.splice(pinnedIndex, 1);
			await this.saveSettings();
		}

		// Close window if open
		const window = this.openWindows.get(file.path);
		if (window && !window.isDestroyed()) {
			window.close();
		}
		this.openWindows.delete(file.path);

		// Delete the file
		await this.app.vault.delete(file);
	}

	togglePinNote(notePath: string) {
		const index = this.settings.pinnedNotes.indexOf(notePath);
		if (index > -1) {
			this.settings.pinnedNotes.splice(index, 1);
		} else {
			this.settings.pinnedNotes.push(notePath);
		}
		this.saveSettings();
	}
}

interface PopNoteItem {
	file: TFile;
	displayText: string;
	metadata: string;
	isPinned: boolean;
}

class PopNotePickerModal extends FuzzySuggestModal<PopNoteItem> {
	// Add the required abstract method
	onChooseItem(item: PopNoteItem, evt: MouseEvent | KeyboardEvent): void {
		// Check for modifier keys in the event
		if (evt instanceof KeyboardEvent) {
			console.log('onChooseItem KeyboardEvent:', evt.key, 'Modifiers:', {
				ctrl: evt.ctrlKey,
				meta: evt.metaKey,
				alt: evt.altKey,
				shift: evt.shiftKey
			});

			// Handle keyboard shortcuts directly here as a fallback
			const isMod = evt.ctrlKey || evt.metaKey;
			if (isMod && evt.key.toLowerCase() === 'enter') {
				evt.preventDefault();
				this.openInNewTab(item);
				return;
			} else if (evt.altKey && evt.key === 'Enter') {
				evt.preventDefault();
				this.close();
				// Use setTimeout to ensure modal is closed before opening new window
				setTimeout(() => {
					this.plugin.openNoteInNewWindow(item.file);
				}, 50);
				return;
			}
		}

		// Default action: open in current tab
		this.openInCurrentTab(item);
	}

	plugin: PopNotePlugin;
	private notes: TFile[];
	private currentSelected: PopNoteItem | null = null;

	constructor(app: App, plugin: PopNotePlugin) {
		super(app);
		this.plugin = plugin;
		this.notes = [];

		// Set placeholder text
		this.setPlaceholder('Search PopNotes...');

		// Alternative approach: Override keydown handler
		// Use capturing phase to intercept events before they reach child elements
		this.keydownHandler = this.handleKeyDown.bind(this);
		this.modalEl.addEventListener('keydown', this.keydownHandler, true);

		// Also add a mutation observer to track selection changes
		this.setupSelectionObserver();
	}

	private keydownHandler: (evt: KeyboardEvent) => void;
	private observer: MutationObserver | null = null;

	private setupSelectionObserver() {
		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
					const target = mutation.target as HTMLElement;
					if (target.hasClass('is-selected')) {
						// Find the corresponding item
						const suggestionEl = target.querySelector('.popnote-suggestion');
						if (suggestionEl) {
							const titleEl = suggestionEl.querySelector('.popnote-suggestion-title');
							if (titleEl) {
								const displayText = titleEl.textContent || '';
								const items = this.getItems();
								const item = items.find(i => i.displayText === displayText);
								if (item) {
									this.currentSelected = item;
									console.log('Selection changed to:', displayText);
								}
							}
						}
					}
				}
			}
		});

		// Start observing when the results container is available
		setTimeout(() => {
			// @ts-ignore - accessing private property
			const resultsEl = this.resultContainerEl;
			if (resultsEl && this.observer) {
				this.observer.observe(resultsEl, {
					attributes: true,
					attributeFilter: ['class'],
					subtree: true
				});
			}
		}, 100);
	}

	private handleKeyDown(evt: KeyboardEvent) {
		console.log('Modal keydown event:', evt.key, 'Modifiers:', {
			ctrl: evt.ctrlKey,
			meta: evt.metaKey,
			alt: evt.altKey,
			shift: evt.shiftKey
		});

		// Try multiple ways to get selected item
		let selected = this.getSelectedItem();
		if (!selected && this.currentSelected) {
			console.log('Using currentSelected from renderSuggestion');
			selected = this.currentSelected;
		}

		if (!selected) {
			console.log('No item selected - trying to get first visible item');
			// As a last resort, try to get the first item if there's only one
			const items = this.getItems();
			if (items.length === 1) {
				selected = items[0];
				console.log('Using first item as fallback');
			} else {
				return;
			}
		}

		// Check if current key combination matches any configured shortcuts
		const currentShortcut = this.getShortcutFromEvent(evt);
		console.log('Current shortcut:', currentShortcut);

		// Pin/Unpin
		if (currentShortcut === this.plugin.settings.pickerPinShortcut) {
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();
			console.log('Pin shortcut detected via keydown');
			this.togglePin(selected);
			return;
		}

		// Delete
		if (currentShortcut === this.plugin.settings.pickerDeleteShortcut) {
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();
			console.log('Delete shortcut detected via keydown');
			this.deleteNote(selected);
			return;
		}

		// Open in new tab
		if (currentShortcut === this.plugin.settings.pickerOpenInNewTabShortcut) {
			evt.preventDefault();
			evt.stopPropagation();
			console.log('Open in new tab shortcut detected');
			this.openInNewTab(selected);
			return;
		}

		// Open in new window
		if (currentShortcut === this.plugin.settings.pickerOpenInNewWindowShortcut) {
			evt.preventDefault();
			evt.stopPropagation();
			console.log('Open in new window shortcut detected');
			this.close();
			// Use setTimeout to ensure modal is closed before opening new window
			setTimeout(() => {
				if (selected) {
					this.plugin.openNoteInNewWindow(selected.file);
				}
			}, 50);
			return;
		}
	}

	private getShortcutFromEvent(evt: KeyboardEvent): string {
		const parts: string[] = [];

		// Add modifiers in consistent order
		if (evt.ctrlKey || evt.metaKey) parts.push('Mod');
		if (evt.altKey) parts.push('Alt');
		if (evt.shiftKey) parts.push('Shift');

		// Add the key
		if (evt.key === 'Enter') {
			parts.push('Enter');
		} else {
			parts.push(evt.key.toUpperCase());
		}

		return parts.join('+');
	}

	async onOpen() {
		super.onOpen();
		console.log('PopNotePickerModal opened');
		console.log('Scope available:', !!this.scope);

		// Load notes
		this.notes = await this.plugin.getPopNotesSorted();

		// Set instructions based on current settings
		this.updateInstructions();

		// Force initial display of all items
		// @ts-ignore - accessing private property
		this.inputEl.value = '';
		// @ts-ignore - accessing private method
		this.onInput();

		// Focus on the input element to ensure keyboard events are captured
		// @ts-ignore - accessing private property
		if (this.inputEl) {
			this.inputEl.focus();
		}

		// Register custom keymaps based on settings
		setTimeout(() => {
			// Delay registration slightly to ensure modal is fully initialized
			this.registerShortcuts();
		}, 100);
	}

	onClose() {
		// Clean up event listener
		if (this.keydownHandler) {
			this.modalEl.removeEventListener('keydown', this.keydownHandler, true);
		}
		// Clean up observer
		if (this.observer) {
			this.observer.disconnect();
		}
		super.onClose();
	}

	getItems(): PopNoteItem[] {
		// Sort pinned notes first
		const pinnedNotes: PopNoteItem[] = [];
		const unpinnedNotes: PopNoteItem[] = [];

		this.notes.forEach(file => {
			const isPinned = this.plugin.settings.pinnedNotes.includes(file.path);
			const date = new Date(this.plugin.settings.sortOrder === 'created' ? file.stat.ctime : file.stat.mtime);
			const item: PopNoteItem = {
				file,
				displayText: file.basename,
				metadata: date.toLocaleString(),
				isPinned
			};

			if (isPinned) {
				pinnedNotes.push(item);
			} else {
				unpinnedNotes.push(item);
			}
		});

		return [...pinnedNotes, ...unpinnedNotes];
	}

	getItemText(item: PopNoteItem): string {
		return item.displayText;
	}

	renderSuggestion(value: FuzzyMatch<PopNoteItem>, el: HTMLElement) {
		const item = value.item;

		// Track selected item when rendering
		if (el.parentElement?.hasClass('is-selected')) {
			this.currentSelected = item;
		}

		el.addClass('popnote-suggestion');

		// Create container
		const container = el.createDiv({ cls: 'popnote-suggestion-content' });

		// Create title container that includes pin icon and name
		const titleContainer = container.createDiv({ cls: 'pop-note-suggestion-title' });

		// Pin indicator
		if (item.isPinned) {
			titleContainer.createSpan({ text: '📌 ', cls: 'popnote-pin-indicator' });
		}

		// Note name
		titleContainer.createSpan({ text: item.displayText });

		// Metadata
		const metadata = container.createDiv({ cls: 'popnote-suggestion-metadata' });
		metadata.setText(item.metadata);
	}

	private getSelectedItem(): PopNoteItem | null {
		// @ts-ignore - accessing private property
		const selectedIndex = this.chooser?.selectedItem;
		console.log('getSelectedItem - selectedIndex:', selectedIndex);
		if (selectedIndex !== undefined && selectedIndex >= 0) {
			// @ts-ignore - accessing private property
			const values = this.chooser?.values;
			console.log('getSelectedItem - values:', values?.length);
			if (values && values[selectedIndex]) {
				const item = values[selectedIndex].item;
				console.log('getSelectedItem - found item:', item.displayText);
				return item;
			}
		}
		console.log('getSelectedItem - no item found');
		return null;
	}


	private async openInCurrentTab(item: PopNoteItem) {
		let leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
		// If no active markdown view (empty tab), use the most recent leaf
		if (!leaf) {
			const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
			if (mostRecentLeaf) {
				leaf = mostRecentLeaf;
			}
		}
		// If still no leaf, get one
		if (!leaf) {
			leaf = this.app.workspace.getLeaf();
		}
		if (leaf) {
			await leaf.openFile(item.file);
			this.close();
		}
	}

	private async openInNewTab(item: PopNoteItem) {
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(item.file);
		this.close();
	}

	private togglePin(item: PopNoteItem) {
		this.plugin.togglePinNote(item.file.path);
		// Update the item's pinned status
		item.isPinned = !item.isPinned;
		// Close and reopen to refresh the display
		this.close();
		new PopNotePickerModal(this.app, this.plugin).open();
	}

	private async deleteNote(item: PopNoteItem) {
		const confirmDelete = await this.confirmDelete(item.displayText);
		if (confirmDelete) {
			await this.plugin.deletePopNote(item.file);
			// Remove from notes array
			this.notes = this.notes.filter(note => note.path !== item.file.path);
			// Close and reopen to refresh the display
			if (this.notes.length > 0) {
				this.close();
				new PopNotePickerModal(this.app, this.plugin).open();
			} else {
				this.close();
			}
		}
	}

	private updateInstructions() {
		// Format shortcut for display
		const formatShortcut = (shortcut: string) => {
			return shortcut
				.replace(/Mod\+/g, 'cmd+')
				.replace(/Ctrl\+/g, 'ctrl+')
				.replace(/Cmd\+/g, 'cmd+')
				.replace(/Alt\+/g, 'opt+')
				.replace(/Shift\+/g, 'shift+')
				.replace(/Enter/g, '↵')
				.toLowerCase();
		};

		this.setInstructions([
			{ command: '↑↓', purpose: 'navigate' },
			{ command: '↵', purpose: 'open in current tab' },
			{ command: formatShortcut(this.plugin.settings.pickerOpenInNewTabShortcut), purpose: 'open in new tab' },
			{ command: formatShortcut(this.plugin.settings.pickerOpenInNewWindowShortcut), purpose: 'open in new window' },
			{ command: formatShortcut(this.plugin.settings.pickerPinShortcut), purpose: 'pin/unpin' },
			{ command: formatShortcut(this.plugin.settings.pickerDeleteShortcut), purpose: 'delete' },
			{ command: 'esc', purpose: 'close' }
		]);
	}

	private async confirmDelete(noteName: string): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
			modal.titleEl.setText('Delete PopNote');
			modal.contentEl.createEl('p', {
				text: `Are you sure you want to delete "${noteName}"?`
			});

			const buttonContainer = modal.contentEl.createDiv({ cls: 'modal-button-container' });

			const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
			cancelButton.addEventListener('click', () => {
				modal.close();
				resolve(false);
			});

			const deleteButton = buttonContainer.createEl('button', {
				text: 'Delete',
				cls: 'mod-warning'
			});
			deleteButton.addEventListener('click', () => {
				modal.close();
				resolve(true);
			});

			modal.open();
		});
	}


	private registerShortcuts() {
		// Parse shortcut string to get modifiers and key
		const parseShortcut = (shortcut: string): { modifiers: Modifier[], key: string } => {
			const parts = shortcut.split('+');
			// Handle key - convert 'Enter' to lowercase, but keep single letters as-is
			let key = parts[parts.length - 1];
			if (key.toLowerCase() === 'enter') {
				key = 'Enter';
			} else if (key.length === 1) {
				// For single letter keys, use the exact case from settings
				// This handles both uppercase and lowercase properly
				key = key;
			}

			const modifierStrings = parts.slice(0, -1);
			const modifiers: Modifier[] = modifierStrings.map(mod => {
				switch (mod.toLowerCase()) {
					case 'mod':
					case 'cmd':
					case 'ctrl':
						return 'Mod' as Modifier;
					case 'alt':
					case 'opt':
						return 'Alt' as Modifier;
					case 'shift':
						return 'Shift' as Modifier;
					case 'meta':
						return 'Meta' as Modifier;
					default:
						return 'Mod' as Modifier;
				}
			});
			return { modifiers, key };
		};

		// Register pin shortcut
		const pinShortcut = parseShortcut(this.plugin.settings.pickerPinShortcut);
		console.log('Registering pin shortcut:', pinShortcut.modifiers, pinShortcut.key);
		this.scope.register(pinShortcut.modifiers, pinShortcut.key, (evt: KeyboardEvent) => {
			console.log('Pin shortcut triggered');
			evt.preventDefault();
			evt.stopPropagation();
			const selected = this.getSelectedItem();
			if (selected) {
				console.log('Toggling pin for:', selected.displayText);
				this.togglePin(selected);
			} else {
				console.log('No item selected');
			}
			return false;
		});

		// Register delete shortcut
		const deleteShortcut = parseShortcut(this.plugin.settings.pickerDeleteShortcut);
		this.scope.register(deleteShortcut.modifiers, deleteShortcut.key, (evt: KeyboardEvent) => {
			evt.preventDefault();
			evt.stopPropagation();
			const selected = this.getSelectedItem();
			if (selected) {
				this.deleteNote(selected);
			}
			return false;
		});

		// Register open in new tab shortcut
		const newTabShortcut = parseShortcut(this.plugin.settings.pickerOpenInNewTabShortcut);
		this.scope.register(newTabShortcut.modifiers, newTabShortcut.key, (evt: KeyboardEvent) => {
			evt.preventDefault();
			evt.stopPropagation();
			const selected = this.getSelectedItem();
			if (selected) {
				this.openInNewTab(selected);
			}
			return false;
		});

		// Register open in new window shortcut
		const newWindowShortcut = parseShortcut(this.plugin.settings.pickerOpenInNewWindowShortcut);
		this.scope.register(newWindowShortcut.modifiers, newWindowShortcut.key, (evt: KeyboardEvent) => {
			evt.preventDefault();
			evt.stopPropagation();
			const selected = this.getSelectedItem();
			if (selected) {
				this.plugin.openNoteInNewWindow(selected.file);
				this.close();
			}
			return false;
		});
	}
}

class PopNoteSettingTab extends PluginSettingTab {
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
			.addText(text => text
				.setPlaceholder('PopNotes')
				.setValue(this.plugin.settings.popNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.popNotesFolder = value;
					await this.plugin.saveSettings();
				}));

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
		const templateSetting = new Setting(containerEl)
			.setName('Template file')
			.setDesc('Optional template file for new PopNotes. Available variables: {{title}},{{date}}, {{time}}, {{timestamp}}, {{year}}, {{month}}, {{day}}, {{hour}}, {{minute}}, {{second}}');

		// Store reference to text input for later use
		let textInput: any;

		// Add button first
		templateSetting.addButton(button => {
			button
				.setButtonText('Select')
				.setCta()
				.onClick(() => {
					new TemplateFileSelectorModal(this.app, this.plugin, (file) => {
						if (textInput) {
							textInput.setValue(file.path);
						}
						this.plugin.settings.templateFile = file.path;
						this.plugin.saveSettings();
					}).open();
				});
		});

		// Add text input after button
		templateSetting.addText(text => {
			textInput = text;
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

		new Setting(containerEl)
			.setName('Main window behavior')
			.setDesc('How to handle the main window when closing PopNotes')
			.addDropdown(dropdown => dropdown
				.addOption('off', 'Off - Never minimize')
				.addOption('dynamic', 'Dynamic - Only minimize if main window was hidden')
				.addOption('always', 'Always - Always minimize main window')
				.setValue(this.plugin.settings.autoMinimizeMode)
				.onChange(async (value) => {
					this.plugin.settings.autoMinimizeMode = value as 'off' | 'dynamic' | 'always';
					await this.plugin.saveSettings();
				}));

		// Global hotkey section
		containerEl.createEl('h3', { text: 'Global Hotkey' });
		containerEl.createEl('p', {
			text: 'Set up a system-wide hotkey that works even when Obsidian is not focused.',
			cls: 'setting-item-description'
		});

		const globalHotkeySetting = new Setting(containerEl)
			.setName('Create/open PopNote')
			.setDesc('Global hotkey to create or open a PopNote from anywhere. ');

		// Add link to description
		const descEl = globalHotkeySetting.descEl;
		descEl.createEl('a', {
			text: 'See available modifiers',
			href: 'https://www.electronjs.org/docs/latest/api/accelerator#available-modifiers'
		});

		globalHotkeySetting
			.addText(text => {
				text
					.setPlaceholder('CmdOrCtrl+Shift+N')
					.setValue(this.plugin.settings.createNoteHotkey)
					.onChange(async (value) => {
						this.plugin.settings.createNoteHotkey = value;
						// Don't save if invalid to prevent errors
						if (!value || this.plugin.isValidHotkey(value)) {
							await this.plugin.saveSettings();
						}
					});

				// Add validation indicator
				text.inputEl.addEventListener('input', () => {
					const value = text.getValue();
					if (value && !this.plugin.isValidHotkey(value)) {
						text.inputEl.addClass('is-invalid');
						text.inputEl.setAttribute('title', 'Incomplete hotkey combination');
					} else {
						text.inputEl.removeClass('is-invalid');
						text.inputEl.removeAttribute('title');
					}
				});
			});

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
			.setName('Open in new window shortcut')
			.setDesc('Keyboard shortcut to open a note in a new window')
			.addText(text => text
				.setPlaceholder('Alt+Enter')
				.setValue(this.plugin.settings.pickerOpenInNewWindowShortcut)
				.onChange(async (value) => {
					this.plugin.settings.pickerOpenInNewWindowShortcut = value;
					await this.plugin.saveSettings();
				}));
	}
}