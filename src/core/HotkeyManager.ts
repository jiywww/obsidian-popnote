import { Notice } from 'obsidian';
import { Logger } from '../utils/logger';

// Access Electron APIs
const { remote } = require('electron');
const { globalShortcut } = remote;

export class HotkeyManager {
	private registeredHotkeys: string[] = [];
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	registerGlobalHotkey(hotkey: string, callback: () => void): boolean {
		if (!globalShortcut) {
			this.logger.error('globalShortcut is not available');
			new Notice('PopNote: Global shortcuts are not available. Plugin may not work correctly.');
			return false;
		}

		// Unregister existing hotkey if any
		this.unregisterAll();

		if (!hotkey || !this.isValidHotkey(hotkey)) {
			this.logger.warn('Invalid or empty hotkey:', hotkey);
			return false;
		}

		// Check if already registered
		if (globalShortcut.isRegistered(hotkey)) {
			this.logger.log(`Hotkey ${hotkey} is already registered, unregistering first...`);
			globalShortcut.unregister(hotkey);
		}

		try {
			const success = globalShortcut.register(hotkey, callback);
			
			if (success) {
				this.logger.log(`Successfully registered global hotkey: ${hotkey}`);
				this.registeredHotkeys.push(hotkey);
				// Only show success notification in debug mode
				if (this.logger.isDebugMode()) {
					new Notice(`PopNote: Global hotkey ${hotkey} registered successfully`);
				}
			} else {
				this.logger.error(`Failed to register global hotkey: ${hotkey}`);
				new Notice(`PopNote: Failed to register global hotkey ${hotkey}. It may be in use by another application.`);
			}
			
			return success;
		} catch (error) {
			this.logger.error('Error registering global hotkey:', error);
			new Notice(`PopNote: Error registering global hotkey: ${error.message}`);
			return false;
		}
	}

	unregisterAll() {
		if (!globalShortcut) {
			this.logger.log('globalShortcut not available, skipping unregister');
			return;
		}

		this.logger.log('Unregistering global hotkeys...');
		this.registeredHotkeys.forEach(hotkey => {
			try {
				if (globalShortcut.isRegistered(hotkey)) {
					globalShortcut.unregister(hotkey);
					this.logger.log(`Successfully unregistered hotkey: ${hotkey}`);
				} else {
					this.logger.log(`Hotkey ${hotkey} was not registered`);
				}
			} catch (error) {
				this.logger.error(`Error unregistering hotkey ${hotkey}:`, error);
			}
		});
		
		this.registeredHotkeys = [];
		this.logger.log('All global hotkeys unregistered');
	}

	isValidHotkey(hotkey: string): boolean {
		if (!hotkey || typeof hotkey !== 'string') {
			return false;
		}

		// Must contain at least one modifier and a key
		const parts = hotkey.split('+');
		if (parts.length < 2) {
			return false;
		}

		// Valid modifiers
		const validModifiers = ['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 
								'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'];
		
		// Check that at least one modifier is present
		const hasModifier = parts.slice(0, -1).some(part => 
			validModifiers.includes(part)
		);

		// The last part should be a valid key
		const key = parts[parts.length - 1];
		const hasValidKey = key.length > 0;

		return hasModifier && hasValidKey;
	}

	isGlobalShortcutAvailable(): boolean {
		return !!globalShortcut;
	}
}