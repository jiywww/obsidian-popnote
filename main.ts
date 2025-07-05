import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath, MarkdownView, Vault, FuzzySuggestModal, FuzzyMatch, Modifier, TextComponent } from 'obsidian';

// Access Electron APIs
const { remote } = require('electron');
const { globalShortcut, BrowserWindow, getCurrentWindow } = remote;

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
	windowSizeMode: 'fixed' | 'remember'; // Whether to use fixed size or remember last used size
	lastUsedWindowSize: {
		width: number;
		height: number;
	} | null;
	lastCreatedNote: {
		path: string;
		timestamp: number;
		fileId?: string; // ctime as string
	} | null;
	// Picker keyboard shortcuts
	pickerPinShortcut: string;
	pickerDeleteShortcut: string;
	pickerOpenInNewTabShortcut: string;
	pickerOpenInNewWindowShortcut: string;
	// Always-on-top settings
	alwaysOnTop: boolean;
	windowLevel: 'screen-saver' | 'normal';
	visibleOnAllWorkspaces: boolean;
	// Cursor position settings
	cursorPosition: 'start' | 'end' | 'last';
	cursorPositions: { [filePath: string]: { line: number; ch: number } };
	// Window position settings
	windowPosition: 'center' | 'left' | 'right' | 'last';
	lastWindowPosition: { x: number; y: number } | null;
	// File tracking system
	fileTracking: {
		fileIdToPath: { [ctime: string]: string };
		pathToFileId: { [filePath: string]: string };
	};
	// Debug mode
	debugMode: boolean;
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
	windowSizeMode: 'fixed',
	lastUsedWindowSize: null,
	lastCreatedNote: null,
	// Picker keyboard shortcuts
	pickerPinShortcut: 'Mod+P',
	pickerDeleteShortcut: 'Mod+D',
	pickerOpenInNewTabShortcut: 'Mod+Enter',
	pickerOpenInNewWindowShortcut: 'Alt+Enter',
	// Always-on-top settings
	alwaysOnTop: false,
	windowLevel: 'screen-saver',
	visibleOnAllWorkspaces: false,
	// Cursor position settings
	cursorPosition: 'start',
	cursorPositions: {},
	// Window position settings
	windowPosition: 'center',
	lastWindowPosition: null,
	// File tracking system
	fileTracking: {
		fileIdToPath: {},
		pathToFileId: {}
	},
	// Debug mode
	debugMode: false
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

	onChooseItem(file: TFile): void {
		this.onSelect(file);
	}
}

export default class PopNotePlugin extends Plugin {
	settings: PopNoteSettings;
	private registeredHotkeys: string[] = [];
	private popNoteWindow: any = null; // Single PopNote window
	private popNoteLeaf: any = null; // Store the leaf reference
	private currentFile: TFile | null = null; // Currently displayed file
	private lastNavigationTimestamp: number = 0;
	private shouldCreateNewNote: boolean = false;

	async onload() {
		await this.loadSettings();

		// Check if globalShortcut is available
		if (!globalShortcut) {
			this.debugError('globalShortcut is not available');
			new Notice('PopNote: Global shortcuts are not available. Plugin may not work correctly.');
		} else {
			this.debugLog('globalShortcut is available');

			// Clean up any previously registered hotkeys before registering new ones
			if (this.settings.createNoteHotkey) {
				try {
					if (globalShortcut.isRegistered(this.settings.createNoteHotkey)) {
						this.debugLog(`Found previously registered hotkey ${this.settings.createNoteHotkey}, cleaning up...`);
						globalShortcut.unregister(this.settings.createNoteHotkey);
					}
				} catch (error) {
					this.debugError('Error cleaning up previous hotkeys:', error);
				}
			}
		}

		// Register all global hotkeys
		this.registerGlobalHotkeys();
		
		
		// Try to reconnect to existing PopNote windows
		this.reconnectExistingPopNoteWindows();
		
		// Register app quit event handlers to clean up PopNote windows
		this.debugLog('PopNote plugin loaded, registering app quit handlers');
		this.registerAppQuitHandlers();

		// Register file rename event listener
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				this.handleFileRename(file as TFile, oldPath);
			})
		);
		
		// Register file delete event listener
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) {
					this.handleFileDelete(file);
				}
			})
		);
		
		// Periodically clean up orphaned file tracking entries
		this.registerInterval(
			window.setInterval(() => {
				this.cleanupFileTracking();
			}, 300000) // Run every 5 minutes
		);

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

	}

	private async debug(level: 'INFO' | 'ERROR' | 'WARN', ...args: any[]) {
		if (this.settings.debugMode) {
			const prefix = '[PopNote]';
			switch (level) {
				case 'INFO':
					console.log(prefix, ...args);
					break;
				case 'ERROR':
					console.error(prefix, ...args);
					break;
				case 'WARN':
					console.warn(prefix, ...args);
					break;
			}
			
			// Also write to log file
			const message = args.map(arg => 
				typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
			).join(' ');
			await this.writeToLogFile(level, message);
		}
	}

	// Convenience methods for backward compatibility
	private async debugLog(...args: any[]) {
		await this.debug('INFO', ...args);
	}

	private async debugError(...args: any[]) {
		await this.debug('ERROR', ...args);
	}

	private async debugWarn(...args: any[]) {
		await this.debug('WARN', ...args);
	}

	onunload() {
		this.debugLog('PopNote plugin unloading...');

		// Clean up all PopNote windows
		this.cleanupPopNoteWindows();

		// Unregister all global hotkeys
		this.unregisterGlobalHotkeys();

		// Extra cleanup - unregister the specific hotkey even if not in our list
		if (globalShortcut && this.settings.createNoteHotkey) {
			try {
				if (globalShortcut.isRegistered(this.settings.createNoteHotkey)) {
					globalShortcut.unregister(this.settings.createNoteHotkey);
					this.debugLog(`Extra cleanup: unregistered ${this.settings.createNoteHotkey}`);
				}
			} catch (error) {
				this.debugError('Error in extra cleanup:', error);
			}
		}

		this.debugLog('PopNote plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
	
	async saveSettingsAndReloadHotkeys() {
		await this.saveData(this.settings);
		// Re-register hotkeys when settings change
		this.unregisterGlobalHotkeys();
		this.registerGlobalHotkeys();
	}

	private registerGlobalHotkeys() {
		if (!globalShortcut) {
			this.debugError('globalShortcut is not available, skipping global hotkey registration');
			return;
		}

		this.debugLog('Registering global hotkey for creating PopNotes...');

		// Only register the create note hotkey globally
		if (this.settings.createNoteHotkey && this.isValidHotkey(this.settings.createNoteHotkey)) {
			try {
				// First check if the hotkey is already registered
				if (globalShortcut.isRegistered(this.settings.createNoteHotkey)) {
					this.debugLog(`Hotkey ${this.settings.createNoteHotkey} is already registered, unregistering first...`);
					globalShortcut.unregister(this.settings.createNoteHotkey);
				}

				const success = globalShortcut.register(this.settings.createNoteHotkey, () => {
					this.debugLog('Global create note hotkey triggered');
					this.createOrOpenPopNote();
				});

				if (success) {
					this.registeredHotkeys.push(this.settings.createNoteHotkey);
					this.debugLog(`Successfully registered global hotkey: ${this.settings.createNoteHotkey}`);
				} else {
					this.debugError(`Failed to register global hotkey: ${this.settings.createNoteHotkey}`);
					new Notice('Failed to register global hotkey. It may be already in use by another application.');
				}
			} catch (error) {
				this.debugError(`Error registering global hotkey:`, error);
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
	
	private reconnectExistingPopNoteWindows() {
		// With Solution 2, we don't reconnect to existing PopNote windows
		// They should have been closed when the main window closed
		this.debugLog('reconnectExistingPopNoteWindows: Skipping reconnection (Solution 2 - PopNote windows close with main window)');
		
		// However, let's check if there are any orphaned PopNote windows and close them
		try {
			setTimeout(() => {
				const allWindows = BrowserWindow.getAllWindows();
				const vaultName = this.app.vault.getName();
				
				this.debugLog(`Checking for orphaned PopNote windows. Found ${allWindows.length} total windows`);
				
				for (const window of allWindows) {
					if (window && !window.isDestroyed()) {
						const windowAny = window as any;
						
						// Check if this is a PopNote window for our vault
						if (windowAny.isPopNote === true && windowAny.vaultId === vaultName) {
							this.debugLog(`Found orphaned PopNote window for our vault! Window ID: ${window.id}, popNoteId: ${windowAny.popNoteId}`);
							this.debugLog('Closing orphaned PopNote window...');
							
							try {
								window.close();
								this.debugLog(`Closed orphaned PopNote window ID: ${window.id}`);
							} catch (error) {
								this.debugError(`Error closing orphaned PopNote window ${window.id}:`, error);
							}
						}
					}
				}
			}, 1000); // Wait a bit for windows to be ready
		} catch (error) {
			this.debugLog(`Error checking for orphaned PopNote windows: ${error}`);
		}
	}
	
	private registerAppQuitHandlers() {
		try {
			const { app } = remote;
			
			// Register app quit event handlers
			if (app) {
				// Before quit event - clean up PopNote windows
				app.on('before-quit', () => {
					this.debugLog('App before-quit event triggered - cleaning up PopNote windows');
					this.cleanupPopNoteWindows();
				});
				
				// When all windows are closed - on macOS this doesn't quit the app
				app.on('window-all-closed', () => {
					this.debugLog('All windows closed event triggered');
					// On macOS, don't clean up here as the app stays running
					if (process.platform !== 'darwin') {
						this.cleanupPopNoteWindows();
					}
				});
				
				// Also listen for will-quit event
				app.on('will-quit', () => {
					this.debugLog('App will-quit event triggered - final cleanup');
					this.cleanupPopNoteWindows();
				});
				
				// Listen for app activation (when dock icon is clicked on macOS)
				app.on('activate', () => {
					this.debugLog('App activate event triggered (dock icon clicked)');
					this.handleAppActivate();
				});
			}
			
			// Setup main window tracking
			this.debugLog('Setting up main window tracking...');
			
			// Find and track the main window
			setTimeout(() => {
				this.trackMainWindow();
			}, 2000); // Wait for windows to be ready
			
		} catch (error) {
			this.debugError('Error registering app quit handlers:', error);
		}
	}
	
	private trackMainWindow() {
		const allWindows = BrowserWindow.getAllWindows();
		this.debugLog(`Looking for main window. Found ${allWindows.length} total windows`);
		
		// Find the main window (not our PopNote window)
		const mainWindow = allWindows.find((w: any) => {
			if (w === this.popNoteWindow || w.isDestroyed()) return false;
			
			// Check if this window has our vault's properties (meaning it's a PopNote from our vault)
			const windowAny = w as any;
			if (windowAny.isPopNote === true && windowAny.vaultId === this.app.vault.getName()) {
				return false; // This is a PopNote window, not the main window
			}
			
			return true; // This is likely the main window
		});
		
		if (mainWindow) {
			this.debugLog(`Found main window with ID: ${mainWindow.id}`);
			
			// Watch for main window being closed
			mainWindow.on('close', () => {
				this.debugLog('Main window close event fired!');
				// Close all PopNote windows for this vault when main window closes
				this.closeAllPopNoteWindowsForVault();
			});
			
			// Optional: Log other events for debugging
			if (this.settings.debugMode) {
				mainWindow.on('hide', () => {
					this.debugLog('Main window hide event fired');
				});
				
				mainWindow.on('minimize', () => {
					this.debugLog('Main window minimize event fired');
				});
			}
		} else {
			this.debugLog('Could not find main window! Will retry in 5 seconds...');
			// Retry once more after a delay
			setTimeout(() => {
				const retryWindows = BrowserWindow.getAllWindows();
				const retryMainWindow = retryWindows.find((w: any) => {
					if (w === this.popNoteWindow || w.isDestroyed()) return false;
					const windowAny = w as any;
					if (windowAny.isPopNote === true && windowAny.vaultId === this.app.vault.getName()) {
						return false;
					}
					return true;
				});
				
				if (retryMainWindow) {
					this.debugLog(`Found main window on retry with ID: ${retryMainWindow.id}`);
					retryMainWindow.on('close', () => {
						this.debugLog('Main window close event fired!');
						this.closeAllPopNoteWindowsForVault();
					});
				} else {
					this.debugLog('Still could not find main window after retry');
				}
			}, 5000);
		}
	}
	
	private cleanupPopNoteWindows() {
		this.debugLog('cleanupPopNoteWindows called - cleaning up PopNote windows...');
		
		// Try to detach the leaf first if we have a reference
		if (this.popNoteLeaf) {
			try {
				this.debugLog('Detaching PopNote leaf');
				this.popNoteLeaf.detach();
				this.popNoteLeaf = null;
			} catch (leafError) {
				this.debugLog(`Error detaching leaf: ${leafError}`);
			}
		}
		
		// Close the main PopNote window if it exists
		if (this.popNoteWindow && !this.popNoteWindow.isDestroyed()) {
			this.debugLog(`Closing PopNote window, window ID: ${this.popNoteWindow.id}`);
			try {
				// First hide the window
				this.popNoteWindow.hide();
				this.debugLog('PopNote window hidden');
				
				// Remove all listeners to prevent any interference
				this.popNoteWindow.removeAllListeners();
				
				// Try to close via Obsidian's workspace API first
				try {
					// Get all workspace containers
					const containers = (this.app.workspace as any).rootSplit?.children || [];
					this.debugLog(`Checking ${containers.length} workspace containers`);
					
					// Also check floating splits
					const floatingContainers = (this.app.workspace as any).floatingSplit?.children || [];
					this.debugLog(`Found ${floatingContainers.length} floating containers`);
					
					// Search in all containers
					const allContainers = [...containers, ...floatingContainers];
					for (const container of allContainers) {
						if (container.win === this.popNoteWindow || 
							(container as any).containerEl?.win === this.popNoteWindow) {
							this.debugLog('Found workspace container, closing via Obsidian API');
							if (typeof container.close === 'function') {
								container.close();
							} else if (typeof container.detach === 'function') {
								container.detach();
							}
							break;
						}
					}
				} catch (wsError) {
					this.debugLog(`Error closing via workspace API: ${wsError}`);
				}
				
				// Close the workspace leaf if it exists
				const leaves = this.app.workspace.getLeavesOfType('markdown');
				for (const leaf of leaves) {
					// Check if this leaf is in our popnote window
					if ((leaf as any).view?.containerEl?.ownerDocument?.defaultView === this.popNoteWindow) {
						this.debugLog('Found and detaching leaf from PopNote window');
						leaf.detach();
					}
				}
				
				// Now destroy the window
				this.popNoteWindow.destroy();
				this.debugLog('PopNote window destroyed successfully');
			} catch (error) {
				this.debugError('Error destroying PopNote window:', error);
				// Try alternative close method
				try {
					this.popNoteWindow.close();
					this.debugLog('PopNote window closed using close() method');
				} catch (closeError) {
					this.debugError('Error closing PopNote window:', closeError);
				}
			}
			this.popNoteWindow = null;
			this.currentFile = null;
		} else {
			this.debugLog('No PopNote window to clean up or already destroyed');
		}
	}
	
	private closeAllPopNoteWindowsForVault() {
		this.debugLog('closeAllPopNoteWindowsForVault called - closing all PopNote windows for this vault...');
		
		try {
			const allWindows = BrowserWindow.getAllWindows();
			const vaultName = this.app.vault.getName();
			
			this.debugLog(`Looking for PopNote windows for vault: ${vaultName}`);
			
			for (const window of allWindows) {
				if (window && !window.isDestroyed()) {
					const windowAny = window as any;
					
					// Check if this is a PopNote window for our vault
					if (windowAny.isPopNote === true && windowAny.vaultId === vaultName) {
						this.debugLog(`Found PopNote window for our vault! Window ID: ${window.id}, popNoteId: ${windowAny.popNoteId}`);
						
						// If this is our tracked window, clean it up properly
						if (window === this.popNoteWindow) {
							this.cleanupPopNoteWindows();
						} else {
							// For other PopNote windows from our vault, just close them
							try {
								window.close();
								this.debugLog(`Closed PopNote window ID: ${window.id}`);
							} catch (error) {
								this.debugError(`Error closing PopNote window ${window.id}:`, error);
							}
						}
					}
				}
			}
		} catch (error) {
			this.debugError('Error in closeAllPopNoteWindowsForVault:', error);
		}
	}
	
	private handleAppActivate() {
		// This is called when the dock icon is clicked on macOS
		this.debugLog('handleAppActivate called - checking window states');
		
		try {
			const allWindows = BrowserWindow.getAllWindows();
			this.debugLog(`Found ${allWindows.length} total windows`);
			
			// Find the main window (not PopNote)
			const mainWindow = allWindows.find((w: any) => {
				if (w.isDestroyed()) return false;
				
				// Check if this is NOT a PopNote window
				const windowAny = w as any;
				if (windowAny.isPopNote === true) {
					this.debugLog(`Window ${w.id} is a PopNote window, skipping`);
					return false;
				}
				
				this.debugLog(`Window ${w.id} is a potential main window`);
				return true;
			});
			
			if (mainWindow) {
				this.debugLog(`Found main window with ID: ${mainWindow.id}, minimized: ${mainWindow.isMinimized()}, visible: ${mainWindow.isVisible()}`);
				
				// If the main window is minimized, restore it
				if (mainWindow.isMinimized()) {
					this.debugLog('Main window is minimized, restoring...');
					mainWindow.restore();
				}
				
				// If the main window is not visible, show it
				if (!mainWindow.isVisible()) {
					this.debugLog('Main window is not visible, showing...');
					mainWindow.show();
				}
				
				// Focus the main window
				this.debugLog('Focusing main window...');
				mainWindow.focus();
			} else {
				this.debugLog('No main window found during app activation');
				
				// If no main window exists and only PopNote windows exist,
				// we might need to create a new main window or notify the user
				const hasOnlyPopNoteWindows = allWindows.every((w: any) => {
					const windowAny = w as any;
					return windowAny.isPopNote === true || w.isDestroyed();
				});
				
				if (hasOnlyPopNoteWindows && allWindows.length > 0) {
					this.debugLog('Only PopNote windows exist, cannot restore main window');
					// The main window might have been closed unexpectedly
					// In this case, Obsidian should handle creating a new main window
				}
			}
		} catch (error) {
			this.debugError('Error in handleAppActivate:', error);
		}
	}
	
	private async writeToLogFile(level: string, message: string) {
		// Don't check debug mode here - it's already checked in the calling methods
		try {
			const logFile = ".obsidian/plugins/popnote/popnote.log";
			const timestamp = new Date().toISOString();
			const logEntry = `[${timestamp}] [${level}] ${message}\n`;
			
			// Ensure the plugin directory exists
			const pluginDir = ".obsidian/plugins/popnote";
			try {
				await this.app.vault.adapter.mkdir(pluginDir);
			} catch (e) {
				// Directory might already exist
			}
			
			// Append to log file
			try {
				const existingContent = await this.app.vault.adapter.read(logFile);
				// Check file size - if over 1MB, truncate to last 500KB
				if (existingContent.length > 1024 * 1024) {
					const truncatedContent = existingContent.slice(-512 * 1024);
					await this.app.vault.adapter.write(logFile, truncatedContent + logEntry);
				} else {
					await this.app.vault.adapter.write(logFile, existingContent + logEntry);
				}
			} catch (e) {
				// File doesn't exist, create it
				await this.app.vault.adapter.write(logFile, logEntry);
			}
		} catch (error) {
			// Can't use debugError here to avoid infinite loop
			console.error('[PopNote] Failed to write to log file:', error);
		}
	}

	private unregisterGlobalHotkeys() {
		if (!globalShortcut) {
			this.debugLog('globalShortcut not available, skipping unregister');
			return;
		}

		this.debugLog('Unregistering global hotkeys...');
		this.registeredHotkeys.forEach(hotkey => {
			try {
				if (globalShortcut.isRegistered(hotkey)) {
					globalShortcut.unregister(hotkey);
					this.debugLog(`Successfully unregistered hotkey: ${hotkey}`);
				} else {
					this.debugLog(`Hotkey ${hotkey} was not registered`);
				}
			} catch (error) {
				this.debugError(`Failed to unregister hotkey ${hotkey}:`, error);
			}
		});
		this.registeredHotkeys = [];
	}

	async createOrOpenPopNote() {
		this.debugLog('createOrOpenPopNote called');
		
		// Check if we're still trying to reconnect
		if (!this.popNoteWindow) {
			// Give reconnection a chance to work
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		// Smart handling for single window mode
		if (this.popNoteWindow && !this.popNoteWindow.isDestroyed()) {
			this.debugLog(`PopNote window exists, ID: ${this.popNoteWindow.id}`);
			// Window exists
			if (this.popNoteWindow.isVisible()) {
				// Window is visible, hide it
				this.debugLog(`Hiding PopNote window with ID: ${this.popNoteWindow.id}`);
				// Save cursor position before hiding
				await this.saveCursorPosition();
				this.popNoteWindow.hide();
				return;
			} else {
				// Window is hidden, check if we need a new note
				const shouldReuseNote = this.shouldReuseLastNote();
				this.debugLog('Window hidden, should reuse note:', shouldReuseNote);
				
				// Log main window visibility state before showing
				const allWindows = BrowserWindow.getAllWindows();
				const mainWindow = allWindows.find((w: any) => 
					w !== this.popNoteWindow && !w.isDestroyed() && w.isVisible()
				);
				this.debugLog(`Main window visible before unhide: ${!!mainWindow}`);
				
				// Update leaf reference
				const leaves = this.app.workspace.getLeavesOfType('markdown');
				for (const leaf of leaves) {
					// Check if this leaf is in our popnote window
					if ((leaf as any).view?.containerEl?.ownerDocument?.defaultView === this.popNoteWindow) {
						this.popNoteLeaf = leaf;
						this.debugLog('Updated popNoteLeaf reference on window unhide');
						break;
					}
				}
				
				if (!shouldReuseNote) {
					// Buffer time expired or set to 'none', create new note
					const noteFile = await this.createNewPopNote();
					// Open the new note in the existing window
					if (this.popNoteLeaf) {
						await this.popNoteLeaf.openFile(noteFile);
						this.currentFile = noteFile;
					}
				}
				
				// Apply window size if needed
				if (this.settings.windowSizeMode === 'fixed') {
					// Apply fixed size from settings
					this.popNoteWindow.setSize(
						this.settings.defaultWindowWidth,
						this.settings.defaultWindowHeight
					);
				}
				
				// Apply window position if needed
				if (this.settings.windowPosition !== 'last') {
					// Get current size (may have just been updated)
					const [width, height] = this.popNoteWindow.getSize();
					const { x, y } = this.calculateWindowPosition(width, height);
					this.popNoteWindow.setPosition(x, y);
				}
				
				// Re-apply always-on-top settings before showing (may be lost during hide)
				if (this.settings.alwaysOnTop) {
					try {
						this.popNoteWindow.setAlwaysOnTop(true, this.settings.windowLevel);
						
						if (process.platform === 'darwin' && this.settings.visibleOnAllWorkspaces) {
							this.popNoteWindow.setVisibleOnAllWorkspaces(true, { 
								visibleOnFullScreen: true 
							});
						}
					} catch (error) {
						this.debugError('Failed to re-apply always-on-top settings:', error);
					}
				}
				
				// Show the window
				this.debugLog(`Showing PopNote window with ID: ${this.popNoteWindow.id}`);
				
				// On macOS, use showInactive first to avoid space switching
				if (process.platform === 'darwin') {
					this.popNoteWindow.showInactive();
					// Small delay before focus to ensure window is properly shown
					setTimeout(() => {
						if (this.popNoteWindow && !this.popNoteWindow.isDestroyed()) {
							this.popNoteWindow.focus();
						}
					}, 50);
				} else {
					this.popNoteWindow.show();
					this.popNoteWindow.focus();
				}
				
				// Restore cursor position for current file
				if (this.currentFile) {
					await this.restoreCursorPosition(this.currentFile);
				}
				
				return;
			}
		}

		// No window exists, create one
		// Check buffer time logic
		const shouldReuseNote = this.shouldReuseLastNote();
		this.debugLog('Should reuse note:', shouldReuseNote);

		let noteFile: TFile;
		if (shouldReuseNote && this.settings.lastCreatedNote) {
			// Try to find the existing note using file tracking
			const resolvedFile = await this.resolveFile(this.settings.lastCreatedNote.path);
			if (resolvedFile) {
				noteFile = resolvedFile;
			} else if (this.settings.lastCreatedNote.fileId) {
				// Try to resolve by file ID
				const resolvedById = await this.resolveFile(this.settings.lastCreatedNote.fileId);
				if (resolvedById) {
					noteFile = resolvedById;
					// Update the path in settings
					this.settings.lastCreatedNote.path = resolvedById.path;
					await this.saveSettings();
				} else {
					// If note doesn't exist anymore, create new one
					noteFile = await this.createNewPopNote();
				}
			} else {
				// No file ID, create new note
				noteFile = await this.createNewPopNote();
			}
		} else {
			noteFile = await this.createNewPopNote();
		}

		// Create new window with the note
		await this.showPopNoteWindow(noteFile);
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
					this.debugLog('Template applied successfully from:', normalizedTemplatePath);
				} catch (error) {
					this.debugError('Error reading template file:', error);
					new Notice(`Failed to read template file: ${this.settings.templateFile}`);
				}
			} else {
				this.debugWarn('Template file not found:', normalizedTemplatePath);
				// Don't show notice for empty template setting
				if (this.settings.templateFile.trim()) {
					new Notice(`Template file not found: ${this.settings.templateFile}`);
				}
			}
		}

		// Create the note
		const noteFile = await this.app.vault.create(notePath, content);

		// Update file tracking
		this.updateFileTracking(noteFile);

		// Update last created note with file ID
		this.settings.lastCreatedNote = {
			path: noteFile.path,
			timestamp: Date.now(),
			fileId: String(noteFile.stat.ctime)
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

	async showPopNoteWindow(file: TFile) {
		// Update file tracking when opening
		this.updateFileTracking(file);
		
		// Save cursor position for current file if switching
		if (this.currentFile && this.currentFile !== file) {
			this.debugLog(`Switching from ${this.currentFile.path} to ${file.path}, saving cursor position`);
			await this.saveCursorPosition();
		}

		// If window doesn't exist, create it and open file
		if (!this.popNoteWindow || this.popNoteWindow.isDestroyed()) {
			const leaf = await this.createPopNoteWindowWithFile(file);
			if (leaf) {
				this.currentFile = file;
				// Restore cursor position if available
				await this.restoreCursorPosition(file);
			}
			return;
		}

		// Window exists, just open the file
		// First try to use the stored popNoteLeaf if it exists
		if (this.popNoteLeaf && !this.popNoteLeaf.detached) {
			await this.popNoteLeaf.openFile(file);
			this.currentFile = file;
			// Restore cursor position if available
			await this.restoreCursorPosition(file);
		} else {
			// Find all workspace items that might be our window
			const workspaceItems = (this.app.workspace as any).floatingSplit?.children || [];
			for (const item of workspaceItems) {
				if (item.win === this.popNoteWindow) {
					// Found our window's workspace, get a leaf and open file
					const leaf = item.getLeaf();
					if (leaf) {
						this.popNoteLeaf = leaf; // Update the leaf reference
						await leaf.openFile(file);
						this.currentFile = file;
						// Restore cursor position if available
						await this.restoreCursorPosition(file);
					}
					break;
				}
			}
		}

		// Show and focus the window
		this.popNoteWindow.show();
		this.popNoteWindow.focus();
	}

	private async createPopNoteWindowWithFile(file: TFile) {
		// Log main window visibility
		try {
			const allWindows = BrowserWindow.getAllWindows();
			const mainWindow = allWindows.find((w: any) => 
				!w.isDestroyed() && 
				w !== this.popNoteWindow &&
				w.isVisible()
			);
			this.debugLog(`Main window visible: ${!!mainWindow}`);
		} catch (error) {
			this.debugError('Error checking main window visibility:', error);
		}

		// Determine window size
		let width: number;
		let height: number;
		
		if (this.settings.windowSizeMode === 'remember' && this.settings.lastUsedWindowSize) {
			width = this.settings.lastUsedWindowSize.width;
			height = this.settings.lastUsedWindowSize.height;
		} else {
			width = this.settings.defaultWindowWidth;
			height = this.settings.defaultWindowHeight;
		}

		// Determine window position
		const position = this.calculateWindowPosition(width, height);

		// Create window data
		const windowData = {
			size: { width, height },
			x: position.x,
			y: position.y
		};

		// Store current windows before creating new one
		const windowsBefore = BrowserWindow.getAllWindows();
		
		// Create new popout window and open file immediately
		const leaf = this.app.workspace.openPopoutLeaf(windowData);
		this.popNoteLeaf = leaf; // Store the leaf reference
		await leaf.openFile(file);
		
		// Wait for window to be created and track it
		setTimeout(() => {
			try {
				const allWindows = BrowserWindow.getAllWindows();
				// Find the new window by comparing with windows before
				let newWindow: any = null;
				
				for (const window of allWindows) {
					if (!windowsBefore.includes(window) && !window.isDestroyed()) {
						newWindow = window;
						break;
					}
				}
				
				if (newWindow) {
					this.popNoteWindow = newWindow;
					this.debugLog(`Created PopNote window with ID: ${newWindow.id}`);
					
					// Set custom window properties to identify PopNote windows
					try {
						// Set custom properties on the window object
						const windowAny = newWindow as any;
						windowAny.isPopNote = true;
						windowAny.vaultId = this.app.vault.getName();
						windowAny.popNoteId = `popnote-${Date.now()}-${newWindow.id}`;
						
						this.debugLog(`Set PopNote window properties - vaultId: ${this.app.vault.getName()}, popNoteId: ${windowAny.popNoteId}`);
					} catch (error) {
						this.debugError('Error setting window properties:', error);
					}

					// Apply always-on-top settings
					if (this.settings.alwaysOnTop) {
						try {
							newWindow.setAlwaysOnTop(true, this.settings.windowLevel);
							
							if (process.platform === 'darwin' && this.settings.visibleOnAllWorkspaces) {
								newWindow.setVisibleOnAllWorkspaces(true, { 
									visibleOnFullScreen: true 
								});
							}
						} catch (error) {
							this.debugError('Failed to set always-on-top:', error);
						}
					}

					// Add window event listeners
					this.setupWindowEventListeners(newWindow);
				}
			} catch (error) {
				this.debugError('Failed to track window:', error);
			}
		}, 500);

		return leaf;
	}


	private calculateWindowPosition(width: number, height: number): { x: number; y: number } {
		// Get screen dimensions
		const { screen } = require('electron').remote;
		const display = screen.getPrimaryDisplay();
		const { width: screenWidth, height: screenHeight } = display.workAreaSize;

		let x: number;
		let y: number;

		switch (this.settings.windowPosition) {
			case 'left':
				x = 50;
				y = (screenHeight - height) / 2;
				break;
			case 'right':
				x = screenWidth - width - 50;
				y = (screenHeight - height) / 2;
				break;
			case 'last':
				if (this.settings.lastWindowPosition) {
					x = this.settings.lastWindowPosition.x;
					y = this.settings.lastWindowPosition.y;
				} else {
					// Fall back to center
					x = (screenWidth - width) / 2;
					y = (screenHeight - height) / 2;
				}
				break;
			case 'center':
			default:
				x = (screenWidth - width) / 2;
				y = (screenHeight - height) / 2;
				break;
		}

		return { x: Math.round(x), y: Math.round(y) };
	}

	private setupWindowEventListeners(window: any) {
		// Track window resize
		if (this.settings.windowSizeMode === 'remember') {
			window.on('resize', () => {
				const [newWidth, newHeight] = window.getSize();
				this.settings.lastUsedWindowSize = {
					width: newWidth,
					height: newHeight
				};
				this.saveSettings();
			});
		}

		// Track window position
		if (this.settings.windowPosition === 'last') {
			window.on('move', () => {
				const [x, y] = window.getPosition();
				this.settings.lastWindowPosition = { x, y };
				this.saveSettings();
			});
		}

		// Handle window close (hide instead)
		window.on('close', (event: any) => {
			event.preventDefault();
			
			// Check if window is not destroyed before calling hide
			if (!window.isDestroyed()) {
				window.hide();
			}
			
			// Save cursor position before hiding
			this.saveCursorPosition();
		});
	}

	private async saveCursorPosition() {
		if (!this.currentFile || !this.popNoteWindow) {
			// This is normal when closing window or no file is open
			return;
		}

		this.debugLog(`Attempting to save cursor position for ${this.currentFile.path}`);

		// Find the markdown view in the PopNote window
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.editor && activeView.file) {
			// Check if file has a path property
			const filePath = activeView.file.path;
			if (filePath) {
				// For now, let's save regardless of window check to see if it works
				const cursor = activeView.editor.getCursor();
				this.settings.cursorPositions[filePath] = cursor;
				await this.saveSettings();
				this.debugLog(`Saved cursor position for ${filePath}:`, cursor, `(Total: ${Object.keys(this.settings.cursorPositions).length})`);
			} else {
				this.debugLog(`File has no path property`);
			}
		} else {
			this.debugLog(`No active view/editor/file to save cursor for - activeView: ${!!activeView}, editor: ${activeView ? !!activeView.editor : 'N/A'}, file: ${activeView ? !!activeView.file : 'N/A'}`);
		}
	}

	private async restoreCursorPosition(file: TFile) {
		const savedPosition = this.settings.cursorPositions[file.path];
		this.debugLog(`Restoring cursor for ${file.path}, saved position:`, savedPosition, `(Setting: ${this.settings.cursorPosition})`);
		
		// Register a one-time event handler for when the file is opened
		const eventRef = this.app.workspace.on('file-open', (openedFile) => {
			if (openedFile?.path === file.path) {
				// Unregister the event handler
				this.app.workspace.offref(eventRef);
				
				// Wait a bit for the editor to be ready
				setTimeout(() => {
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					
					if (activeView && activeView.file?.path === file.path && activeView.editor) {
						const editor = activeView.editor;
						
						if (this.settings.cursorPosition === 'last' && savedPosition) {
							editor.setCursor(savedPosition);
							this.debugLog(`Restored cursor position for ${file.path}:`, savedPosition);
						} else if (this.settings.cursorPosition === 'end') {
							const lastLine = editor.lastLine();
							const lastLineLength = editor.getLine(lastLine).length;
							editor.setCursor({ line: lastLine, ch: lastLineLength });
							this.debugLog(`Set cursor to end for ${file.path} (line ${lastLine}, ch ${lastLineLength})`);
						} else {
							// Default to start
							editor.setCursor({ line: 0, ch: 0 });
							this.debugLog(`Set cursor to start for ${file.path}`);
						}
						
						// Force focus on the editor
						editor.focus();
					} else {
						this.debugWarn(`Could not restore cursor for ${file.path} - view not ready even after file-open event`);
					}
				}, 100);
			}
		});
		
		// Also set a timeout as fallback in case the event doesn't fire
		setTimeout(() => {
			// Clean up the event handler if it hasn't fired
			this.app.workspace.offref(eventRef);
			
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file?.path === file.path && activeView.editor) {
				const editor = activeView.editor;
				
				if (this.settings.cursorPosition === 'last' && savedPosition) {
					editor.setCursor(savedPosition);
					this.debugLog(`Restored cursor position for ${file.path} via fallback:`, savedPosition);
				} else if (this.settings.cursorPosition === 'end') {
					const lastLine = editor.lastLine();
					const lastLineLength = editor.getLine(lastLine).length;
					editor.setCursor({ line: lastLine, ch: lastLineLength });
					this.debugLog(`Set cursor to end for ${file.path} via fallback`);
				} else {
					editor.setCursor({ line: 0, ch: 0 });
					this.debugLog(`Set cursor to start for ${file.path} via fallback`);
				}
				
				editor.focus();
			}
		}, 500);
	}


	private navigateNote(direction: 'previous' | 'next') {
		this.debugLog('navigateNote called:', direction);

		// Find current note from active view
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			this.debugLog('No active markdown view found');
			// If no active view, try to create/show a PopNote window with the most recent note
			this.getPopNotesSorted().then(async notes => {
				if (notes.length > 0) {
					await this.showPopNoteWindow(notes[0]);
				} else {
					// Create a new note if none exist
					const newNote = await this.createNewPopNote();
					await this.showPopNoteWindow(newNote);
				}
			});
			return;
		}

		const currentPath = activeView.file.path;
		this.debugLog('Current note path:', currentPath);

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
						this.debugLog('Creating new note from navigation');
						const newNote = await this.createNewPopNote();
						// Save cursor position before switching
						await this.saveCursorPosition();
						
						const leaf = this.app.workspace.getLeaf();
						if (leaf) {
							await leaf.openFile(newNote);
							this.currentFile = newNote;
							// For new notes, set cursor position based on settings
							await this.restoreCursorPosition(newNote);
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
				this.debugLog(`About to save cursor position, currentFile: ${this.currentFile?.path}`);
				// Save cursor position before switching
				await this.saveCursorPosition();
				this.debugLog(`After saveCursorPosition call`);
				
				// Open target note in current active leaf
				const leaf = this.app.workspace.getLeaf();
				if (leaf) {
					await leaf.openFile(targetNote);
					this.currentFile = targetNote;
					// Restore cursor position
					await this.restoreCursorPosition(targetNote);
				}
			}
		});
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

	// File tracking methods
	private updateFileTracking(file: TFile) {
		if (!file || !file.stat) return;
		
		const fileId = String(file.stat.ctime);
		const oldFileId = this.settings.fileTracking.pathToFileId[file.path];
		
		// If file already tracked with different ID, clean up old reference
		if (oldFileId && oldFileId !== fileId) {
			delete this.settings.fileTracking.fileIdToPath[oldFileId];
		}
		
		// Update tracking
		this.settings.fileTracking.fileIdToPath[fileId] = file.path;
		this.settings.fileTracking.pathToFileId[file.path] = fileId;
	}

	private handleFileRename(file: TFile, oldPath: string) {
		if (!file || !file.stat) return;
		
		const fileId = String(file.stat.ctime);
		
		// Update file tracking
		delete this.settings.fileTracking.pathToFileId[oldPath];
		this.settings.fileTracking.pathToFileId[file.path] = fileId;
		this.settings.fileTracking.fileIdToPath[fileId] = file.path;
		
		// Migrate cursor positions
		if (this.settings.cursorPositions[oldPath]) {
			this.settings.cursorPositions[file.path] = this.settings.cursorPositions[oldPath];
			delete this.settings.cursorPositions[oldPath];
		}
		
		// Update pinned notes
		const pinnedIndex = this.settings.pinnedNotes.indexOf(oldPath);
		if (pinnedIndex > -1) {
			this.settings.pinnedNotes[pinnedIndex] = file.path;
		}
		
		// Update lastCreatedNote if it matches
		if (this.settings.lastCreatedNote?.path === oldPath) {
			this.settings.lastCreatedNote.path = file.path;
		}
		
		// Save settings
		this.saveSettings();
		
		this.debugLog(`File renamed: ${oldPath} -> ${file.path}`);
	}

	private handleFileDelete(file: TFile) {
		if (!file || !file.stat) return;
		
		const fileId = String(file.stat.ctime);
		
		// Clean up file tracking
		delete this.settings.fileTracking.pathToFileId[file.path];
		delete this.settings.fileTracking.fileIdToPath[fileId];
		
		// Clean up cursor positions
		delete this.settings.cursorPositions[file.path];
		
		// Remove from pinned notes
		const pinnedIndex = this.settings.pinnedNotes.indexOf(file.path);
		if (pinnedIndex > -1) {
			this.settings.pinnedNotes.splice(pinnedIndex, 1);
		}
		
		// Clear lastCreatedNote if it matches
		if (this.settings.lastCreatedNote?.path === file.path) {
			this.settings.lastCreatedNote = null;
		}
		
		// Save settings
		this.saveSettings();
		
		this.debugLog(`File deleted: ${file.path}`);
	}

	private async cleanupFileTracking() {
		this.debugLog('Running file tracking cleanup...');
		
		let cleanedCount = 0;
		const fileIdToPath = { ...this.settings.fileTracking.fileIdToPath };
		const pathToFileId = { ...this.settings.fileTracking.pathToFileId };
		
		// Clean up fileIdToPath
		for (const [fileId, path] of Object.entries(fileIdToPath)) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!file || !(file instanceof TFile)) {
				delete this.settings.fileTracking.fileIdToPath[fileId];
				cleanedCount++;
			}
		}
		
		// Clean up pathToFileId
		for (const path of Object.keys(pathToFileId)) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!file || !(file instanceof TFile)) {
				delete this.settings.fileTracking.pathToFileId[path];
				cleanedCount++;
			}
		}
		
		// Clean up cursor positions
		for (const path of Object.keys(this.settings.cursorPositions)) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!file || !(file instanceof TFile)) {
				delete this.settings.cursorPositions[path];
				cleanedCount++;
			}
		}
		
		// Clean up pinned notes
		this.settings.pinnedNotes = this.settings.pinnedNotes.filter(path => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!file || !(file instanceof TFile)) {
				cleanedCount++;
				return false;
			}
			return true;
		});
		
		if (cleanedCount > 0) {
			await this.saveSettings();
			this.debugLog(`Cleaned up ${cleanedCount} orphaned file tracking entries`);
		}
	}

	private async resolveFile(pathOrId: string): Promise<TFile | null> {
		// First try direct path lookup
		let file = this.app.vault.getAbstractFileByPath(pathOrId);
		if (file && file instanceof TFile) {
			this.updateFileTracking(file);
			return file;
		}
		
		// Try to find by file ID
		const fileId = this.settings.fileTracking.pathToFileId[pathOrId] || pathOrId;
		const currentPath = this.settings.fileTracking.fileIdToPath[fileId];
		
		if (currentPath) {
			file = this.app.vault.getAbstractFileByPath(currentPath);
			if (file && file instanceof TFile) {
				this.updateFileTracking(file);
				return file;
			}
		}
		
		return null;
	}

	async deletePopNote(file: TFile) {
		// Remove from pinned notes if present
		const pinnedIndex = this.settings.pinnedNotes.indexOf(file.path);
		if (pinnedIndex > -1) {
			this.settings.pinnedNotes.splice(pinnedIndex, 1);
		}

		// Clean up file tracking
		const fileId = this.settings.fileTracking.pathToFileId[file.path];
		if (fileId) {
			delete this.settings.fileTracking.fileIdToPath[fileId];
			delete this.settings.fileTracking.pathToFileId[file.path];
		}

		// Clean up cursor positions
		if (this.settings.cursorPositions[file.path]) {
			delete this.settings.cursorPositions[file.path];
		}

		// Update lastCreatedNote if it's the deleted file
		if (this.settings.lastCreatedNote?.path === file.path) {
			this.settings.lastCreatedNote = null;
		}

		await this.saveSettings();

		// If the deleted file is currently displayed, switch to next note in list
		if (this.currentFile && this.currentFile.path === file.path) {
			// Get all popnotes sorted
			const allNotes = await this.getPopNotesSorted();
			
			// Find the index of the current note
			const currentIndex = allNotes.findIndex(note => note.path === file.path);
			
			if (currentIndex !== -1 && allNotes.length > 1) {
				// Determine which note to switch to
				let targetNote: TFile | null = null;
				
				if (currentIndex < allNotes.length - 1) {
					// If not the last note, switch to the next one
					targetNote = allNotes[currentIndex + 1];
				} else if (currentIndex > 0) {
					// If it's the last note, switch to the previous one
					targetNote = allNotes[currentIndex - 1];
				}
				
				// Switch to the target note if found
				if (targetNote) {
					await this.showPopNoteWindow(targetNote);
				}
			} else {
				// No notes left or only one note, hide the window
				if (this.popNoteWindow && !this.popNoteWindow.isDestroyed()) {
					this.popNoteWindow.hide();
				}
				this.currentFile = null;
			}
		}

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
	// Debug logging method
	private debugLog(...args: any[]) {
		if (this.plugin.settings.debugMode) {
			console.log('[PopNote Picker]', ...args);
		}
	}

	// Add the required abstract method
	onChooseItem(item: PopNoteItem, evt: MouseEvent | KeyboardEvent): void {
		// Check for modifier keys in the event
		if (evt instanceof KeyboardEvent) {
			this.debugLog('onChooseItem KeyboardEvent:', evt.key, 'Modifiers:', {
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
				// Open in PopNote window
				setTimeout(() => {
					this.plugin.showPopNoteWindow(item.file);
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
									this.debugLog('Selection changed to:', displayText);
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
		this.debugLog('Modal keydown event:', evt.key, 'Modifiers:', {
			ctrl: evt.ctrlKey,
			meta: evt.metaKey,
			alt: evt.altKey,
			shift: evt.shiftKey
		});

		// Try multiple ways to get selected item
		let selected = this.getSelectedItem();
		if (!selected && this.currentSelected) {
			this.debugLog('Using currentSelected from renderSuggestion');
			selected = this.currentSelected;
		}

		if (!selected) {
			this.debugLog('No item selected - trying to get first visible item');
			// As a last resort, try to get the first item if there's only one
			const items = this.getItems();
			if (items.length === 1) {
				selected = items[0];
				this.debugLog('Using first item as fallback');
			} else {
				return;
			}
		}

		// Check if current key combination matches any configured shortcuts
		const currentShortcut = this.getShortcutFromEvent(evt);
		this.debugLog('Current shortcut:', currentShortcut);

		// Pin/Unpin
		if (currentShortcut === this.plugin.settings.pickerPinShortcut) {
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();
			this.debugLog('Pin shortcut detected via keydown');
			this.togglePin(selected);
			return;
		}

		// Delete
		if (currentShortcut === this.plugin.settings.pickerDeleteShortcut) {
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();
			this.debugLog('Delete shortcut detected via keydown');
			this.deleteNote(selected);
			return;
		}

		// Open in new tab
		if (currentShortcut === this.plugin.settings.pickerOpenInNewTabShortcut) {
			evt.preventDefault();
			evt.stopPropagation();
			this.debugLog('Open in new tab shortcut detected');
			this.openInNewTab(selected);
			return;
		}

		// Open in new window
		if (currentShortcut === this.plugin.settings.pickerOpenInNewWindowShortcut) {
			evt.preventDefault();
			evt.stopPropagation();
			this.debugLog('Open in PopNote window shortcut detected');
			this.close();
			// Open in PopNote window
			setTimeout(() => {
				if (selected) {
					this.plugin.showPopNoteWindow(selected.file);
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
		this.debugLog('PopNotePickerModal opened');
		this.debugLog('Scope available:', !!this.scope);

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
		this.debugLog('getSelectedItem - selectedIndex:', selectedIndex);
		if (selectedIndex !== undefined && selectedIndex >= 0) {
			// @ts-ignore - accessing private property
			const values = this.chooser?.values;
			this.debugLog('getSelectedItem - values:', values?.length);
			if (values && values[selectedIndex]) {
				const item = values[selectedIndex].item;
				this.debugLog('getSelectedItem - found item:', item.displayText);
				return item;
			}
		}
		this.debugLog('getSelectedItem - no item found');
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
		// Temporarily disable event handlers on the picker modal to prevent interference
		const originalKeydownHandler = this.keydownHandler;
		this.modalEl.removeEventListener('keydown', originalKeydownHandler, true);
		
		const confirmDelete = await this.confirmDelete(item.displayText);
		
		// Re-enable event handlers
		this.modalEl.addEventListener('keydown', originalKeydownHandler, true);
		
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

			// Add instructions text before the buttons
			const instructionsEl = modal.contentEl.createEl('p', {
				text: 'Press Enter to confirm, Esc to cancel',
				cls: 'setting-item-description'
			});
			instructionsEl.style.marginTop = '10px';
			instructionsEl.style.marginBottom = '15px';
			instructionsEl.style.fontSize = '0.9em';
			instructionsEl.style.color = 'var(--text-muted)';

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

			// Add keyboard shortcuts
			const handleKeydown = (evt: KeyboardEvent) => {
				if (evt.key === 'Enter') {
					evt.preventDefault();
					evt.stopPropagation();
					modal.close();
					resolve(true); // Enter confirms deletion
				} else if (evt.key === 'Escape') {
					evt.preventDefault();
					evt.stopPropagation();
					modal.close();
					resolve(false); // Esc cancels
				}
			};

			// Register keyboard event handler on document level to capture all key events
			const handleGlobalKeydown = (evt: KeyboardEvent) => {
				// While modal is open, capture Enter and Escape keys
				if (evt.key === 'Enter' || evt.key === 'Escape') {
					handleKeydown(evt);
				}
			};

			// Register event handlers
			modal.modalEl.addEventListener('keydown', handleKeydown);
			document.addEventListener('keydown', handleGlobalKeydown, true); // Use capture phase
			
			// Clean up global handler when modal closes
			const originalClose = modal.close.bind(modal);
			modal.close = () => {
				document.removeEventListener('keydown', handleGlobalKeydown, true);
				originalClose();
			};

			modal.open();
			
			// Force focus on the modal and delete button
			setTimeout(() => {
				modal.modalEl.focus();
				deleteButton.focus();
				// Set tabindex to ensure modal can receive focus
				modal.modalEl.setAttribute('tabindex', '-1');
			}, 50);
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
		this.debugLog('Registering pin shortcut:', pinShortcut.modifiers, pinShortcut.key);
		this.scope.register(pinShortcut.modifiers, pinShortcut.key, (evt: KeyboardEvent) => {
			this.debugLog('Pin shortcut triggered');
			evt.preventDefault();
			evt.stopPropagation();
			const selected = this.getSelectedItem();
			if (selected) {
				this.debugLog('Toggling pin for:', selected.displayText);
				this.togglePin(selected);
			} else {
				this.debugLog('No item selected');
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
				this.plugin.showPopNoteWindow(selected.file);
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

		// Always-on-top settings
		containerEl.createEl('h3', { text: 'Floating Window Settings' });
		containerEl.createEl('p', {
			text: 'Configure PopNote windows to float above other windows.',
			cls: 'setting-item-description'
		});

		new Setting(containerEl)
			.setName('Always on top')
			.setDesc('Make PopNote windows float above all other windows')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.alwaysOnTop)
				.onChange(async (value) => {
					this.plugin.settings.alwaysOnTop = value;
					await this.plugin.saveSettings();
					updateFloatingSettingsVisibility();
				}));

		// Window level setting - only show if always-on-top is enabled
		const windowLevelSetting = new Setting(containerEl)
			.setName('Window level')
			.setDesc('Controls window priority. "High priority" is recommended for most use cases.')
			.addDropdown(dropdown => dropdown
				.addOption('screen-saver', 'High priority - Floats above most windows')
				.addOption('normal', 'Normal - Standard window behavior')
				.setValue(this.plugin.settings.windowLevel)
				.onChange(async (value) => {
					this.plugin.settings.windowLevel = value as 'screen-saver' | 'normal';
					await this.plugin.saveSettings();
				}));

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

		// Control visibility based on always-on-top setting
		const updateFloatingSettingsVisibility = () => {
			const display = this.plugin.settings.alwaysOnTop ? 'flex' : 'none';
			windowLevelSetting.settingEl.style.display = display;
			// Only show macOS setting on macOS and if always-on-top is enabled
			if (process.platform === 'darwin') {
				visibleOnAllWorkspacesSetting.settingEl.style.display = display;
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
							await this.plugin.saveSettingsAndReloadHotkeys();
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