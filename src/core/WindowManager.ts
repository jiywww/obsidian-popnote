import { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { Logger } from '../utils/logger';
import { FileTracker } from './FileTracker';
import type PopNotePlugin from './PopNotePlugin';

// Access Electron APIs
const { remote } = require('electron');
const { BrowserWindow } = remote;

export class WindowManager {
	private app: App;
	private plugin: PopNotePlugin;
	private logger: Logger;
	private fileTracker: FileTracker;
	private popNoteWindow: any = null;
	private popNoteLeaf: WorkspaceLeaf | null = null;
	private currentFile: TFile | null = null;

	constructor(app: App, plugin: PopNotePlugin, logger: Logger, fileTracker: FileTracker) {
		this.app = app;
		this.plugin = plugin;
		this.logger = logger;
		this.fileTracker = fileTracker;
	}

	async showPopNoteWindow(file: TFile) {
		this.logger.log('showPopNoteWindow called with file:', file.path);
		
		// Update file tracking when opening
		this.fileTracker.trackFile(file);
		
		// Save cursor position for current file if switching
		if (this.currentFile && this.currentFile !== file) {
			this.logger.log(`Switching from ${this.currentFile.path} to ${file.path}, saving cursor position`);
			this.saveCursorPositionFromLeaf();
		}

		// If window doesn't exist, create it and open file
		if (!this.popNoteWindow || this.popNoteWindow.isDestroyed()) {
			await this.createPopNoteWindowWithFile(file);
			this.currentFile = file;
			// Restore cursor position if available
			this.restoreCursorPosition(file);
			return;
		}

		// Window exists, just open the file
		// First try to use the stored popNoteLeaf if it exists
		if (this.popNoteLeaf && !(this.popNoteLeaf as any).detached) {
			await this.popNoteLeaf.openFile(file);
			this.currentFile = file;
			// Restore cursor position if available
			this.restoreCursorPosition(file);
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
						this.restoreCursorPosition(file);
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
		this.logger.log('Creating new PopNote window with file:', file.path);
		
		// Track this file
		this.fileTracker.trackFile(file);
		
		// Determine window size
		let width = this.plugin.settings.defaultWindowWidth;
		let height = this.plugin.settings.defaultWindowHeight;
		
		if (this.plugin.settings.windowSizeMode === 'remember' && this.plugin.settings.lastUsedWindowSize) {
			width = this.plugin.settings.lastUsedWindowSize.width;
			height = this.plugin.settings.lastUsedWindowSize.height;
			this.logger.log('Using remembered window size:', width, 'x', height);
		}

		// Determine window position
		let x: number | undefined;
		let y: number | undefined;

		if (this.plugin.settings.windowPosition === 'last' && this.plugin.settings.lastWindowPosition) {
			x = this.plugin.settings.lastWindowPosition.x;
			y = this.plugin.settings.lastWindowPosition.y;
			this.logger.log('Using last window position:', x, y);
		} else if (this.plugin.settings.windowPosition === 'left') {
			x = 0;
			y = 0;
		} else if (this.plugin.settings.windowPosition === 'right') {
			const { width: screenWidth } = remote.screen.getPrimaryDisplay().workAreaSize;
			x = screenWidth - width;
			y = 0;
		}
		// If center or undefined, let Electron center it

		// Create window data for Obsidian API
		const windowData = {
			size: { width, height },
			x,
			y
		};

		// Store current windows before creating new one
		const windowsBefore = BrowserWindow.getAllWindows();
		
		// Use Obsidian's API to create the window
		const leaf = this.app.workspace.openPopoutLeaf(windowData);
		this.popNoteLeaf = leaf;
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
					this.logger.log(`Created PopNote window with ID: ${newWindow.id}`);
					
					// Set custom window properties to identify PopNote windows
					try {
						const windowAny = newWindow as any;
						windowAny.isPopNote = true;
						windowAny.vaultId = this.app.vault.getName();
						windowAny.popNoteId = `popnote-${Date.now()}-${newWindow.id}`;
						
						this.logger.log(`Set PopNote window properties - vaultId: ${this.app.vault.getName()}, popNoteId: ${windowAny.popNoteId}`);
					} catch (error) {
						this.logger.error('Error setting window properties:', error);
					}

					// Apply window level settings
					if (this.plugin.settings.windowLevel !== 'normal') {
						try {
							// Set always on top for floating and screen-saver levels
							newWindow.setAlwaysOnTop(true, this.plugin.settings.windowLevel);
							
							// For screen-saver level on macOS, also set visible on all workspaces
							if (process.platform === 'darwin' && this.plugin.settings.windowLevel === 'screen-saver' && this.plugin.settings.visibleOnAllWorkspaces) {
								newWindow.setVisibleOnAllWorkspaces(true, { 
									visibleOnFullScreen: true 
								});
							}
						} catch (error) {
							this.logger.error('Failed to set window level settings:', error);
						}
					}

					// Set up event handlers
					this.setupWindowEventHandlers(newWindow);

					// Apply cursor position
					if (this.plugin.settings.cursorPosition === 'last') {
						setTimeout(() => {
							this.restoreCursorPosition(file);
						}, 100);
					}

					// Update current file reference
					this.currentFile = file;
				} else {
					this.logger.error('Could not find the newly created window');
				}
			} catch (error) {
				this.logger.error('Error tracking new window:', error);
			}
		}, 200); // Give Obsidian time to create the window
	}

	async openFileInExistingWindow(file: TFile) {
		if (!this.popNoteWindow || this.popNoteWindow.isDestroyed()) {
			throw new Error('No existing window to open file in');
		}

		// Update leaf reference
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		for (const leaf of leaves) {
			// Check if this leaf is in our popnote window
			if ((leaf as any).view?.containerEl?.ownerDocument?.defaultView === this.popNoteWindow) {
				this.popNoteLeaf = leaf;
				this.logger.log('Updated popNoteLeaf reference on window unhide');
				break;
			}
		}

		if (this.popNoteLeaf) {
			await this.popNoteLeaf.openFile(file);
			this.currentFile = file;
		}
	}

	showExistingWindow() {
		if (!this.popNoteWindow || this.popNoteWindow.isDestroyed()) {
			throw new Error('No existing window to show');
		}

		// Apply window size if needed
		if (this.plugin.settings.windowSizeMode === 'fixed') {
			// Apply fixed size from settings
			this.popNoteWindow.setSize(
				this.plugin.settings.defaultWindowWidth,
				this.plugin.settings.defaultWindowHeight
			);
		}
		
		// Apply window position if needed
		if (this.plugin.settings.windowPosition !== 'last') {
			// Get current size (may have just been updated)
			const [width, height] = this.popNoteWindow.getSize();
			const position = this.calculateWindowPosition(width, height);
			this.popNoteWindow.setPosition(position.x, position.y);
		}
		
		// Re-apply window level settings before showing (may be lost during hide)
		if (this.plugin.settings.windowLevel !== 'normal') {
			try {
				// Set always on top for floating and screen-saver levels
				this.popNoteWindow.setAlwaysOnTop(true, this.plugin.settings.windowLevel);
				
				// For screen-saver level on macOS, also set visible on all workspaces
				if (process.platform === 'darwin' && this.plugin.settings.windowLevel === 'screen-saver' && this.plugin.settings.visibleOnAllWorkspaces) {
					this.popNoteWindow.setVisibleOnAllWorkspaces(true, { 
						visibleOnFullScreen: true 
					});
				}
			} catch (error) {
				this.logger.error('Failed to re-apply window level settings:', error);
			}
		}
		
		// Show the window
		this.logger.log(`Showing PopNote window with ID: ${this.popNoteWindow.id}`);
		
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
			this.restoreCursorPosition(this.currentFile);
		}
	}

	private calculateWindowPosition(width: number, height: number): { x: number; y: number } {
		let x = 0;
		let y = 0;

		if (this.plugin.settings.windowPosition === 'last' && this.plugin.settings.lastWindowPosition) {
			x = this.plugin.settings.lastWindowPosition.x;
			y = this.plugin.settings.lastWindowPosition.y;
		} else if (this.plugin.settings.windowPosition === 'left') {
			x = 0;
			y = 0;
		} else if (this.plugin.settings.windowPosition === 'right') {
			const { width: screenWidth } = remote.screen.getPrimaryDisplay().workAreaSize;
			x = screenWidth - width;
			y = 0;
		} else {
			// Center
			const { width: screenWidth, height: screenHeight } = remote.screen.getPrimaryDisplay().workAreaSize;
			x = Math.floor((screenWidth - width) / 2);
			y = Math.floor((screenHeight - height) / 2);
		}

		return { x, y };
	}

	private setupWindowEventHandlers(window: any) {
		// Handle window close
		window.on('close', (event: any) => {
			event.preventDefault();
			
			// Check if window is not destroyed before calling hide
			if (!window.isDestroyed()) {
				window.hide();
			}
			
			// Save cursor position before hiding
			this.saveCursorPositionFromLeaf();
		});

		// Track window resize
		if (this.plugin.settings.windowSizeMode === 'remember') {
			window.on('resize', () => {
				try {
					if (!window.isDestroyed()) {
						const [width, height] = window.getSize();
						this.plugin.settings.lastUsedWindowSize = { width, height };
						// Save settings immediately
						this.plugin.saveSettings();
						this.logger.log('Window resized to:', width, 'x', height);
					}
				} catch (error) {
					this.logger.error('Error in resize handler:', error);
				}
			});
		}

		// Track window position
		if (this.plugin.settings.windowPosition === 'last') {
			window.on('move', () => {
				try {
					if (!window.isDestroyed()) {
						const [x, y] = window.getPosition();
						this.plugin.settings.lastWindowPosition = { x, y };
						// Save settings immediately
						this.plugin.saveSettings();
						this.logger.log('Window moved to:', x, y);
					}
				} catch (error) {
					this.logger.error('Error in move handler:', error);
				}
			});
		}

		// Handle window closed (destroyed)
		window.on('closed', () => {
			this.logger.log('PopNote window closed (destroyed)');
			this.popNoteWindow = null;
			this.popNoteLeaf = null;
			this.currentFile = null;
		});
	}


	saveCursorPositionFromLeaf() {
		if (!this.popNoteLeaf || !this.currentFile) return;

		const view = this.popNoteLeaf.view;
		if (view instanceof MarkdownView && view.editor) {
			const cursor = view.editor.getCursor();
			this.fileTracker.saveCursorPosition(this.currentFile.path, cursor);
		}
	}

	private restoreCursorPosition(file: TFile) {
		if (!this.popNoteLeaf) return;

		const savedPosition = this.fileTracker.getCursorPosition(file.path);
		if (!savedPosition) return;

		const view = this.popNoteLeaf.view;
		if (view instanceof MarkdownView && view.editor) {
			this.logger.log('Restoring cursor position for', file.path, ':', savedPosition);
			view.editor.setCursor(savedPosition);
			view.editor.scrollIntoView({ from: savedPosition, to: savedPosition }, true);
		}
	}

	hidePopNoteWindow() {
		try {
			if (this.popNoteWindow && !this.popNoteWindow.isDestroyed()) {
				this.popNoteWindow.hide();
			}
		} catch (error) {
			this.logger.error('Error hiding window:', error);
			// Window might have been destroyed
			this.popNoteWindow = null;
		}
	}

	destroyPopNoteWindow() {
		try {
			if (this.popNoteWindow && !this.popNoteWindow.isDestroyed()) {
				this.popNoteWindow.destroy();
			}
		} catch (error) {
			this.logger.error('Error destroying window:', error);
		} finally {
			// Always clear references
			this.popNoteWindow = null;
			this.popNoteLeaf = null;
			this.currentFile = null;
		}
	}

	getCurrentFile(): TFile | null {
		return this.currentFile;
	}

	getPopNoteWindow(): any {
		return this.popNoteWindow;
	}

	getPopNoteLeaf(): WorkspaceLeaf | null {
		return this.popNoteLeaf;
	}

	closeAllPopNoteWindowsForVault() {
		this.logger.log('closeAllPopNoteWindowsForVault called - closing all PopNote windows for this vault...');
		
		try {
			const allWindows = BrowserWindow.getAllWindows();
			const vaultName = this.app.vault.getName();
			
			this.logger.log(`Looking for PopNote windows for vault: ${vaultName}`);
			
			for (const window of allWindows) {
				if (window && !window.isDestroyed()) {
					const windowAny = window as any;
					
					// Check if this is a PopNote window for our vault
					if (windowAny.isPopNote === true && windowAny.vaultId === vaultName) {
						this.logger.log(`Found PopNote window for our vault! Window ID: ${window.id}, popNoteId: ${windowAny.popNoteId}`);
						
						// If this is our tracked window, clean it up properly
						if (window === this.popNoteWindow) {
							this.cleanupPopNoteWindows();
						} else {
							// For other PopNote windows from our vault, just close them
							try {
								window.close();
								this.logger.log(`Closed PopNote window ID: ${window.id}`);
							} catch (error) {
								this.logger.error(`Error closing PopNote window ${window.id}:`, error);
							}
						}
					}
				}
			}
		} catch (error) {
			this.logger.error('Error in closeAllPopNoteWindowsForVault:', error);
		}
	}

	private cleanupPopNoteWindows() {
		this.logger.log('cleanupPopNoteWindows called - cleaning up PopNote windows...');
		
		// Try to detach the leaf first if we have a reference
		if (this.popNoteLeaf) {
			try {
				this.logger.log('Detaching PopNote leaf');
				this.popNoteLeaf.detach();
				this.popNoteLeaf = null;
			} catch (leafError) {
				this.logger.log(`Error detaching leaf: ${leafError}`);
			}
		}
		
		// Close the main PopNote window if it exists
		if (this.popNoteWindow && !this.popNoteWindow.isDestroyed()) {
			this.logger.log(`Closing PopNote window, window ID: ${this.popNoteWindow.id}`);
			try {
				// First hide the window
				this.popNoteWindow.hide();
				this.logger.log('PopNote window hidden');
				
				// Remove all listeners to prevent any interference
				this.popNoteWindow.removeAllListeners();
				
				// Try to close via Obsidian's workspace API first
				try {
					// Get all workspace containers
					const containers = (this.app.workspace as any).rootSplit?.children || [];
					this.logger.log(`Checking ${containers.length} workspace containers`);
					
					// Also check floating splits
					const floatingContainers = (this.app.workspace as any).floatingSplit?.children || [];
					this.logger.log(`Found ${floatingContainers.length} floating containers`);
					
					// Search in all containers
					const allContainers = [...containers, ...floatingContainers];
					for (const container of allContainers) {
						if (container.win === this.popNoteWindow || 
							(container as any).containerEl?.win === this.popNoteWindow) {
							this.logger.log('Found workspace container, closing via Obsidian API');
							if (typeof container.close === 'function') {
								container.close();
							} else if (typeof container.detach === 'function') {
								container.detach();
							}
							break;
						}
					}
				} catch (wsError) {
					this.logger.log(`Error closing via workspace API: ${wsError}`);
				}
				
				// Finally, try to close the window directly
				try {
					this.popNoteWindow.close();
					this.logger.log('PopNote window closed using close() method');
				} catch (closeError) {
					this.logger.error('Error closing PopNote window:', closeError);
				}
			} catch (error) {
				this.logger.error('Error during window cleanup:', error);
			}
		}
		
		// Clear all references
		this.popNoteWindow = null;
		this.popNoteLeaf = null;
		this.currentFile = null;
		
		this.logger.log('PopNote window cleanup completed');
	}
}