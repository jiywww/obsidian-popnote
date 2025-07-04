import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath, MarkdownView, Vault } from 'obsidian';

// Access Electron APIs
const { remote } = require('electron');
const { globalShortcut, BrowserWindow, getCurrentWindow, app } = remote;

interface QuickNotesSettings {
	quickNotesFolder: string;
	templateFile: string;
	bufferTime: 'none' | 'permanent' | number; // number represents minutes
	sortOrder: 'created' | 'modified';
	noteNamePattern: string;
	createNoteHotkey: string; // Global hotkey for creating notes
	defaultWindowWidth: number;
	defaultWindowHeight: number;
	pinnedNotes: string[]; // Array of note paths
	autoMinimizeMode: 'off' | 'dynamic' | 'always'; // How to handle main window when closing quick notes
	lastCreatedNote: {
		path: string;
		timestamp: number;
	} | null;
}

const DEFAULT_SETTINGS: QuickNotesSettings = {
	quickNotesFolder: 'Quick Notes',
	templateFile: '',
	bufferTime: 5, // 5 minutes default
	sortOrder: 'modified',
	noteNamePattern: 'Quick Note {{date}} {{time}}',
	createNoteHotkey: 'CmdOrCtrl+Shift+N',
	defaultWindowWidth: 800,
	defaultWindowHeight: 600,
	pinnedNotes: [],
	autoMinimizeMode: 'dynamic',
	lastCreatedNote: null
}

export default class QuickNotesPlugin extends Plugin {
	settings: QuickNotesSettings;
	private registeredHotkeys: string[] = [];
	private openWindows: Map<string, any> = new Map();
	private lastNavigationTimestamp: number = 0;
	private shouldCreateNewNote: boolean = false;
	private quickNoteWindowIds: Set<number> = new Set();
	private minimizeScheduled: boolean = false;
	private mainWindowVisibleBeforeQuickNote: Map<number, boolean> = new Map();

	async onload() {
		await this.loadSettings();

		// Check if globalShortcut is available
		if (!globalShortcut) {
			console.error('globalShortcut is not available');
			new Notice('Quick Notes: Global shortcuts are not available. Plugin may not work correctly.');
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

		// Add command for creating quick notes (also accessible from command palette)
		this.addCommand({
			id: 'create-quick-note',
			name: 'Create or open quick note',
			callback: () => {
				this.createOrOpenQuickNote();
			}
		});

		// Add command for navigating to previous note
		this.addCommand({
			id: 'navigate-previous-quick-note',
			name: 'Navigate to previous quick note',
			callback: () => {
				this.navigateNote('previous');
			}
		});

		// Add command for navigating to next note
		this.addCommand({
			id: 'navigate-next-quick-note',
			name: 'Navigate to next quick note',
			callback: () => {
				this.navigateNote('next');
			}
		});

		// Add command for showing picker
		this.addCommand({
			id: 'show-quick-notes-picker',
			name: 'Show quick notes picker',
			callback: () => {
				new QuickNotesPickerModal(this.app, this).open();
			}
		});

		// Add settings tab
		this.addSettingTab(new QuickNotesSettingTab(this.app, this));

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
						this.handleMainWindowAfterQuickNoteClose();
					}, 500);
				}
			})
		);
	}

	onunload() {
		console.log('Quick Notes plugin unloading...');
		
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
		
		console.log('Quick Notes plugin unloaded');
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

		console.log('Registering global hotkey for creating quick notes...');
		
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
					this.createOrOpenQuickNote();
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

	async createOrOpenQuickNote() {
		console.log('createOrOpenQuickNote called');
		
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
				noteFile = await this.createNewQuickNote();
			}
		} else {
			noteFile = await this.createNewQuickNote();
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

	private async createNewQuickNote(): Promise<TFile> {
		// Ensure quick notes folder exists
		const folderPath = normalizePath(this.settings.quickNotesFolder);
		if (!this.app.vault.getAbstractFileByPath(folderPath)) {
			await this.app.vault.createFolder(folderPath);
		}

		// Generate note name from pattern
		const noteName = this.generateNoteName();
		const notePath = normalizePath(`${folderPath}/${noteName}.md`);

		// Get template content
		let content = '';
		if (this.settings.templateFile) {
			const templateFile = this.app.vault.getAbstractFileByPath(this.settings.templateFile);
			if (templateFile && templateFile instanceof TFile) {
				content = await this.app.vault.read(templateFile);
				// Process template variables
				content = this.processTemplate(content);
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
			name = name.replace(new RegExp(key, 'g'), value);
		}

		return name;
	}

	private processTemplate(template: string): string {
		const now = new Date();
		const replacements: Record<string, string> = {
			'{{date}}': now.toLocaleDateString(),
			'{{time}}': now.toLocaleTimeString(),
			'{{title}}': this.generateNoteName()
		};

		let processed = template;
		for (const [key, value] of Object.entries(replacements)) {
			processed = processed.replace(new RegExp(key, 'g'), value);
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
				!this.quickNoteWindowIds.has(w.id) &&
				w.isVisible()
			);
			mainWindowVisible = !!mainWindow;
			console.log('Main window visible before quick note:', mainWindowVisible);
		} catch (error) {
			console.error('Error checking main window visibility:', error);
		}

		// Create new popout window
		const leaf = this.app.workspace.openPopoutLeaf();

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
					this.quickNoteWindowIds.add(newWindow.id);
					this.mainWindowVisibleBeforeQuickNote.set(newWindow.id, mainWindowVisible);
					console.log('Tracked quick note window:', file.path, 'ID:', newWindow.id);
					
					// Use 'close' event instead of 'closed'
					newWindow.on('close', () => {
						console.log('Quick note window closing, setting up auto-minimize...');
						const wasMainWindowVisible = this.mainWindowVisibleBeforeQuickNote.get(newWindow.id) || false;
						
						this.quickNoteWindowIds.delete(newWindow.id);
						this.openWindows.delete(file.path);
						this.mainWindowVisibleBeforeQuickNote.delete(newWindow.id);
						
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

		// Get sorted quick notes
		this.getQuickNotesSorted().then(async notes => {
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
						const newNote = await this.createNewQuickNote();
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

	async getQuickNotesSorted(): Promise<TFile[]> {
		const folder = this.app.vault.getAbstractFileByPath(this.settings.quickNotesFolder);
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
				
				// Check if this is a main window (not a quick note)
				const isQuickNote = this.quickNoteWindowIds.has(w.id);
				if (isQuickNote) return false;
				
				// For now, return true for any non-quick-note window
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
	
	private handleMainWindowAfterQuickNoteClose() {
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
					
					// If it's visible and not a small window (quick notes are usually smaller)
					if (isVisible && !this.quickNoteWindowIds.has(w.id)) {
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
	

	async deleteQuickNote(file: TFile) {
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

class QuickNotesPickerModal extends Modal {
	plugin: QuickNotesPlugin;

	constructor(app: App, plugin: QuickNotesPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Quick Notes' });

		// Add search input
		const searchContainer = contentEl.createDiv('search-input-container');
		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: 'Search notes...'
		});

		// Notes container
		const notesContainer = contentEl.createDiv('quick-notes-list');
		
		// Load and display notes
		const notes = await this.plugin.getQuickNotesSorted();
		this.displayNotes(notes, notesContainer, searchInput.value);

		// Search functionality
		searchInput.addEventListener('input', () => {
			this.displayNotes(notes, notesContainer, searchInput.value);
		});

		// Focus search input
		searchInput.focus();
	}

	private displayNotes(notes: TFile[], container: HTMLElement, searchTerm: string) {
		container.empty();

		const filteredNotes = notes.filter(note => 
			note.basename.toLowerCase().includes(searchTerm.toLowerCase())
		);

		if (filteredNotes.length === 0) {
			container.createEl('p', { text: 'No notes found', cls: 'empty-state' });
			return;
		}

		filteredNotes.forEach(note => {
			const noteItem = container.createDiv('quick-note-item');
			
			// Pin indicator
			if (this.plugin.settings.pinnedNotes.includes(note.path)) {
				noteItem.createSpan({ text: '📌', cls: 'pin-indicator' });
			}

			// Note name
			const noteLink = noteItem.createEl('a', {
				text: note.basename,
				cls: 'note-link'
			});
			noteLink.addEventListener('click', async (e) => {
				e.preventDefault();
				await this.plugin.openNoteInNewWindow(note);
				this.close();
			});

			// Note metadata
			const metadata = noteItem.createSpan({ cls: 'note-metadata' });
			const date = new Date(this.plugin.settings.sortOrder === 'created' ? note.stat.ctime : note.stat.mtime);
			metadata.setText(date.toLocaleString());

			// Actions
			const actions = noteItem.createDiv('note-actions');

			// Open in current tab button
			const openButton = actions.createEl('button', { text: 'Open here' });
			openButton.addEventListener('click', async () => {
				await this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf.openFile(note);
				this.close();
			});

			// Pin/Unpin button
			const isPinned = this.plugin.settings.pinnedNotes.includes(note.path);
			const pinButton = actions.createEl('button', { 
				text: isPinned ? 'Unpin' : 'Pin' 
			});
			pinButton.addEventListener('click', () => {
				this.plugin.togglePinNote(note.path);
				this.displayNotes(notes, container, searchTerm);
			});

			// Delete button
			const deleteButton = actions.createEl('button', { text: 'Delete', cls: 'mod-warning' });
			deleteButton.addEventListener('click', async () => {
				if (confirm(`Delete "${note.basename}"?`)) {
					await this.plugin.deleteQuickNote(note);
					notes.remove(note);
					this.displayNotes(notes, container, searchTerm);
				}
			});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class QuickNotesSettingTab extends PluginSettingTab {
	plugin: QuickNotesPlugin;

	constructor(app: App, plugin: QuickNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Quick Notes Settings' });

		// Quick notes folder
		new Setting(containerEl)
			.setName('Quick notes folder')
			.setDesc('Folder where quick notes will be stored')
			.addText(text => text
				.setPlaceholder('Quick Notes')
				.setValue(this.plugin.settings.quickNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.quickNotesFolder = value;
					await this.plugin.saveSettings();
				}));

		// Note naming pattern
		new Setting(containerEl)
			.setName('Note name pattern')
			.setDesc('Pattern for new note names. Available variables: {{date}}, {{time}}, {{timestamp}}, {{year}}, {{month}}, {{day}}, {{hour}}, {{minute}}, {{second}}')
			.addText(text => text
				.setPlaceholder('Quick Note {{date}} {{time}}')
				.setValue(this.plugin.settings.noteNamePattern)
				.onChange(async (value) => {
					this.plugin.settings.noteNamePattern = value;
					await this.plugin.saveSettings();
				}));

		// Template file
		new Setting(containerEl)
			.setName('Template file')
			.setDesc('Optional template file for new quick notes')
			.addText(text => text
				.setPlaceholder('Templates/Quick Note Template.md')
				.setValue(this.plugin.settings.templateFile)
				.onChange(async (value) => {
					this.plugin.settings.templateFile = value;
					await this.plugin.saveSettings();
				}));

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

		new Setting(containerEl)
			.setName('Default window width')
			.setDesc('Width of new quick note windows (pixels)')
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

		new Setting(containerEl)
			.setName('Default window height')
			.setDesc('Height of new quick note windows (pixels)')
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

		new Setting(containerEl)
			.setName('Main window behavior')
			.setDesc('How to handle the main window when closing quick notes')
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
		containerEl.createEl('p', { text: 'This hotkey works system-wide, even when Obsidian is not focused.' });

		new Setting(containerEl)
			.setName('Create/open quick note')
			.setDesc('Global hotkey to create or open a quick note from anywhere')
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
			text: 'Configure hotkeys for navigation and picker in Obsidian Settings → Hotkeys. Search for "Quick Notes" to find all available commands:' 
		});
		
		const hotkeyList = containerEl.createEl('ul');
		hotkeyList.createEl('li', { text: 'Quick Notes: Navigate to previous quick note' });
		hotkeyList.createEl('li', { text: 'Quick Notes: Navigate to next quick note' });
		hotkeyList.createEl('li', { text: 'Quick Notes: Show quick notes picker' });
	}
}