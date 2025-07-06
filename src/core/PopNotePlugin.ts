import { App, Notice, Plugin, TFile, TFolder, normalizePath, MarkdownView } from 'obsidian';
import { PopNoteSettings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/settings';
import { PopNoteSettingTab } from '../settings/PopNotesSettingTab';
import { PopNotePickerModal } from '../ui/PopNotesPicker';
import { Logger } from '../utils/logger';
import { HotkeyManager } from './HotkeyManager';
import { FileTracker } from './FileTracker';
import { WindowManager } from './WindowManager';

// Access Electron APIs
const { remote } = require('electron');
const { app: electronApp, BrowserWindow } = remote;

export default class PopNotePlugin extends Plugin {
	settings: PopNoteSettings;
	private logger: Logger;
	private hotkeyManager: HotkeyManager;
	private fileTracker: FileTracker;
	private windowManager: WindowManager;
	private lastNavigationTimestamp: number = 0;

	async onload() {
		await this.loadSettings();
		
		// Initialize utilities
		this.logger = new Logger(this.app, this.settings.debugMode);
		this.hotkeyManager = new HotkeyManager(this.logger);
		this.fileTracker = new FileTracker(this.settings, this.logger);
		this.windowManager = new WindowManager(this.app, this, this.logger, this.fileTracker);

		// Register global hotkeys
		this.registerGlobalHotkeys();

		// Add settings tab
		this.addSettingTab(new PopNoteSettingTab(this.app, this));

		// Register commands
		this.registerCommands();

		// Set up event handlers
		this.setupEventHandlers();

		// Register main window close handler
		this.registerMainWindowCloseHandler();

		// Reconnect existing PopNote windows
		this.reconnectExistingPopNoteWindows();

		// Register quit handlers
		this.registerAppQuitHandlers();

		this.logger.log('PopNote plugin loaded successfully');
	}

	onunload() {
		this.logger.log('PopNote plugin unloading...');
		
		// Unregister global hotkeys
		this.hotkeyManager.unregisterAll();
		
		// Clean up windows
		this.windowManager.destroyPopNoteWindow();
		
		this.logger.log('PopNote plugin unloaded');
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		
		// Migrate legacy settings
		this.migrateSettings();
		
		// Initialize tracking objects if they don't exist
		if (!this.settings.fileTracking) {
			this.settings.fileTracking = { fileIdToPath: {}, pathToFileId: {} };
		}
		if (!this.settings.cursorPositions) {
			this.settings.cursorPositions = {};
		}
		
		await this.saveSettings();
	}

	private migrateSettings() {
		// Migrate from alwaysOnTop to windowLevel
		if ('alwaysOnTop' in this.settings) {
			// @ts-ignore - accessing legacy property
			if (this.settings.alwaysOnTop === true) {
				this.settings.windowLevel = 'floating';
			}
			// @ts-ignore
			delete this.settings.alwaysOnTop;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async saveSettingsAndReloadHotkeys() {
		await this.saveSettings();
		// Re-register hotkeys with new settings
		this.hotkeyManager.unregisterAll();
		this.registerGlobalHotkeys();
	}

	private registerGlobalHotkeys() {
		if (!this.hotkeyManager.isGlobalShortcutAvailable()) {
			this.logger.error('Global shortcuts not available');
			return;
		}

		if (this.settings.createNoteHotkey && this.isValidHotkey(this.settings.createNoteHotkey)) {
			this.hotkeyManager.registerGlobalHotkey(
				this.settings.createNoteHotkey,
				() => this.createOrOpenPopNote()
			);
		}
	}

	isValidHotkey(hotkey: string): boolean {
		return this.hotkeyManager.isValidHotkey(hotkey);
	}

	private registerCommands() {
		// Navigation commands
		this.addCommand({
			id: 'navigate-to-previous-popnote',
			name: 'Navigate to previous PopNote',
			callback: () => this.navigateToPreviousPopNote()
		});

		this.addCommand({
			id: 'navigate-to-next-popnote',
			name: 'Navigate to next PopNote',
			callback: () => this.navigateToNextPopNote()
		});

		// Picker command
		this.addCommand({
			id: 'show-popnote-picker',
			name: 'Show PopNote picker',
			callback: () => {
				new PopNotePickerModal(this.app, this).open();
			}
		});
	}

	private setupEventHandlers() {
		// Handle file rename
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					this.fileTracker.updateFilePath(oldPath, file.path);
					// Update cursor positions
					const cursorPos = this.fileTracker.getCursorPosition(oldPath);
					if (cursorPos) {
						this.fileTracker.clearCursorPosition(oldPath);
						this.fileTracker.saveCursorPosition(file.path, cursorPos);
					}
					this.saveSettings();
				}
			})
		);

		// Handle file delete
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) {
					this.fileTracker.clearCursorPosition(file.path);
					this.saveSettings();
				}
			})
		);
	}

	async createOrOpenPopNote() {
		this.logger.log('createOrOpenPopNote called');
		
		// Check if we're still trying to reconnect
		const popNoteWindow = this.windowManager.getPopNoteWindow();
		if (!popNoteWindow) {
			// Give reconnection a chance to work
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		// Smart handling for single window mode - toggle visibility
		const currentWindow = this.windowManager.getPopNoteWindow();
		if (currentWindow && !currentWindow.isDestroyed()) {
			this.logger.log(`PopNote window exists, ID: ${currentWindow.id}`);
			// Window exists
			if (currentWindow.isVisible()) {
				// Window is visible, hide it
				this.logger.log(`Hiding PopNote window with ID: ${currentWindow.id}`);
				// Save cursor position before hiding
				this.windowManager.saveCursorPositionFromLeaf();
				await this.saveSettings();
				currentWindow.hide();
				return;
			} else {
				// Window is hidden, show it
				const shouldReuseNote = this.shouldReuseLastNote();
				this.logger.log('Window hidden, should reuse note:', shouldReuseNote);
				
				if (!shouldReuseNote) {
					// Buffer time expired or set to 'none', create new note
					const noteFile = await this.createNewPopNote();
					// Open the new note in the existing window
					await this.windowManager.openFileInExistingWindow(noteFile);
				}
				
				// Show the window
				this.windowManager.showExistingWindow();
				return;
			}
		}

		// No window exists, create one
		// Check buffer time logic
		const shouldReuseNote = this.shouldReuseLastNote();
		this.logger.log('Should reuse note:', shouldReuseNote);

		let noteFile: TFile;
		if (shouldReuseNote) {
			const lastNote = await this.getLastCreatedNote();
			if (lastNote) {
				noteFile = lastNote;
			} else {
				noteFile = await this.createNewPopNote();
			}
		} else {
			noteFile = await this.createNewPopNote();
		}

		// Create new window with the note
		await this.windowManager.showPopNoteWindow(noteFile);
	}

	private shouldReuseLastNote(): boolean {

		if (this.settings.bufferTime === 'none') {
			return false;
		}

		if (this.settings.bufferTime === 'permanent') {
			return true;
		}

		// Check if we have a last created note within the buffer time
		if (this.settings.lastCreatedNote) {
			const bufferMs = this.settings.bufferTime * 60 * 1000; // Convert minutes to ms
			const timeSinceCreation = Date.now() - this.settings.lastCreatedNote.timestamp;
			return timeSinceCreation <= bufferMs;
		}

		return false;
	}

	private async getLastCreatedNote(): Promise<TFile | null> {
		if (!this.settings.lastCreatedNote) {
			return null;
		}

		// First try to find by file ID (ctime)
		if (this.settings.lastCreatedNote.fileId) {
			const trackedPath = this.fileTracker.getTrackedPath(this.settings.lastCreatedNote.fileId);
			if (trackedPath) {
				const file = this.app.vault.getAbstractFileByPath(trackedPath);
				if (file instanceof TFile) {
					this.logger.log('Found last note by file ID:', file.path);
					return file;
				}
			}
		}

		// Fallback to path
		const file = this.app.vault.getAbstractFileByPath(this.settings.lastCreatedNote.path);
		if (file instanceof TFile) {
			return file;
		}

		return null;
	}

	private async createNewPopNote(): Promise<TFile> {
		// Ensure the PopNotes folder exists
		const folderPath = this.settings.popNotesFolder || 'PopNotes';
		await this.ensureFolderExists(folderPath);

		// Generate note name
		const noteName = this.generateNoteName();
		const notePath = normalizePath(`${folderPath}/${noteName}.md`);

		// Create note content
		let content = '';
		if (this.settings.templateFile) {
			const templateFile = this.app.vault.getAbstractFileByPath(this.settings.templateFile);
			if (templateFile instanceof TFile) {
				const templateContent = await this.app.vault.read(templateFile);
				content = this.processTemplate(templateContent);
			}
		}

		// Create the file
		const file = await this.app.vault.create(notePath, content);
		
		// Track this file
		this.fileTracker.trackFile(file);
		
		// Update last created note
		this.settings.lastCreatedNote = {
			path: file.path,
			timestamp: Date.now(),
			fileId: this.fileTracker.getFileId(file) || undefined
		};
		await this.saveSettings();

		this.logger.log('Created new PopNote:', file.path);
		return file;
	}

	private async ensureFolderExists(folderPath: string) {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	private generateNoteName(): string {
		const now = new Date();
		const vars = {
			date: now.toISOString().split('T')[0],
			time: now.toTimeString().split(' ')[0].replace(/:/g, '-'),
			timestamp: now.getTime().toString(),
			year: now.getFullYear().toString(),
			month: (now.getMonth() + 1).toString().padStart(2, '0'),
			day: now.getDate().toString().padStart(2, '0'),
			hour: now.getHours().toString().padStart(2, '0'),
			minute: now.getMinutes().toString().padStart(2, '0'),
			second: now.getSeconds().toString().padStart(2, '0')
		};

		let name = this.settings.noteNamePattern || 'PopNote {{date}} {{time}}';
		Object.entries(vars).forEach(([key, value]) => {
			name = name.replace(new RegExp(`{{${key}}}`, 'g'), value);
		});

		return name;
	}

	private processTemplate(template: string): string {
		const now = new Date();
		const vars = {
			title: this.generateNoteName(),
			date: now.toISOString().split('T')[0],
			time: now.toTimeString().split(' ')[0],
			timestamp: now.getTime().toString(),
			year: now.getFullYear().toString(),
			month: (now.getMonth() + 1).toString().padStart(2, '0'),
			day: now.getDate().toString().padStart(2, '0'),
			hour: now.getHours().toString().padStart(2, '0'),
			minute: now.getMinutes().toString().padStart(2, '0'),
			second: now.getSeconds().toString().padStart(2, '0')
		};

		let processed = template;
		Object.entries(vars).forEach(([key, value]) => {
			processed = processed.replace(new RegExp(`{{${key}}}`, 'g'), value);
		});

		return processed;
	}

	showPopNoteWindow(file: TFile) {
		return this.windowManager.showPopNoteWindow(file);
	}

	async getPopNotesSorted(): Promise<TFile[]> {
		const popNotesFolder = this.settings.popNotesFolder || 'PopNotes';
		const folder = this.app.vault.getAbstractFileByPath(popNotesFolder);
		
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files: TFile[] = [];
		const collectFiles = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					files.push(child);
				} else if (child instanceof TFolder) {
					collectFiles(child);
				}
			}
		};

		collectFiles(folder);

		// Sort files
		files.sort((a, b) => {
			const timeA = this.settings.sortOrder === 'created' ? a.stat.ctime : a.stat.mtime;
			const timeB = this.settings.sortOrder === 'created' ? b.stat.ctime : b.stat.mtime;
			return timeB - timeA; // Newest first
		});

		return files;
	}

	async deletePopNote(file: TFile) {
		await this.app.vault.delete(file);
		// Clear cursor position
		this.fileTracker.clearCursorPosition(file.path);
		await this.saveSettings();
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

	private async navigateToPreviousPopNote() {
		await this.navigatePopNote(-1);
	}

	private async navigateToNextPopNote() {
		await this.navigatePopNote(1);
	}

	private async navigatePopNote(direction: number) {
		// Prevent rapid navigation
		const now = Date.now();
		if (now - this.lastNavigationTimestamp < 100) {
			return;
		}
		this.lastNavigationTimestamp = now;

		const currentFile = this.windowManager.getCurrentFile();
		if (!currentFile) {
			new Notice('No PopNote is currently open');
			return;
		}

		const notes = await this.getPopNotesSorted();
		const currentIndex = notes.findIndex(n => n.path === currentFile.path);
		
		if (currentIndex === -1) {
			new Notice('Current file is not a PopNote');
			return;
		}

		let newIndex = currentIndex + direction;
		if (newIndex < 0) newIndex = notes.length - 1;
		if (newIndex >= notes.length) newIndex = 0;

		const targetNote = notes[newIndex];
		
		// Save cursor position before switching
		this.windowManager.saveCursorPositionFromLeaf();
		await this.saveSettings();
		
		// Navigate to the new note
		await this.windowManager.showPopNoteWindow(targetNote);
	}

	private reconnectExistingPopNoteWindows() {
		// Delay the window check to avoid startup issues
		setTimeout(() => {
			this.logger.log('Checking for existing PopNote windows...');
			
			try {
				const windows = BrowserWindow.getAllWindows();
				this.logger.log(`Found ${windows.length} total windows`);
				
				windows.forEach((win: any, index: number) => {
					try {
						if (!win.isDestroyed()) {
							const title = win.getTitle();
							this.logger.log(`Window ${index}: ${title}`);
							
							if (title.startsWith('PopNote - ')) {
								this.logger.log('Found existing PopNote window:', title);
								// Don't reconnect - let it stay as is
							}
						}
					} catch (e) {
						this.logger.error(`Error checking window ${index}:`, e);
					}
				});
			} catch (error) {
				this.logger.error('Error checking for existing windows:', error);
			}
		}, 1000); // Wait 1 second after plugin load
	}

	private registerMainWindowCloseHandler() {
		// Find the main window
		const windows = BrowserWindow.getAllWindows();
		const mainWindow = windows.find((w: any) => {
			if (w === this.windowManager.getPopNoteWindow() || w.isDestroyed()) return false;
			const windowAny = w as any;
			if (windowAny.isPopNote === true && windowAny.vaultId === this.app.vault.getName()) {
				return false;
			}
			return true;
		});
		
		if (mainWindow) {
			this.logger.log(`Found main window with ID: ${mainWindow.id}`);
			
			// Watch for main window being closed
			mainWindow.on('close', () => {
				this.logger.log('Main window close event fired!');
				// Close all PopNote windows for this vault when main window closes
				this.windowManager.closeAllPopNoteWindowsForVault();
			});
		} else {
			this.logger.log('Could not find main window! Will retry in 5 seconds...');
			// Retry once more after a delay
			setTimeout(() => {
				const retryWindows = BrowserWindow.getAllWindows();
				const retryMainWindow = retryWindows.find((w: any) => {
					if (w === this.windowManager.getPopNoteWindow() || w.isDestroyed()) return false;
					const windowAny = w as any;
					if (windowAny.isPopNote === true && windowAny.vaultId === this.app.vault.getName()) {
						return false;
					}
					return true;
				});
				
				if (retryMainWindow) {
					this.logger.log(`Found main window on retry with ID: ${retryMainWindow.id}`);
					retryMainWindow.on('close', () => {
						this.logger.log('Main window close event fired!');
						this.windowManager.closeAllPopNoteWindowsForVault();
					});
				} else {
					this.logger.log('Still could not find main window after retry');
				}
			}, 5000);
		}
	}

	private registerAppQuitHandlers() {
		// Register cleanup on app quit
		if (electronApp) {
			const handleQuit = () => {
				this.logger.log('App is quitting, cleaning up...');
				this.hotkeyManager.unregisterAll();
			};
			
			electronApp.on('before-quit', handleQuit);
			electronApp.on('will-quit', handleQuit);
			
			// Also handle window-all-closed
			electronApp.on('window-all-closed', () => {
				this.logger.log('All windows closed');
				this.hotkeyManager.unregisterAll();
			});
		}
	}
}