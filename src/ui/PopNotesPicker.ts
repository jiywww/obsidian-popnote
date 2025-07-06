import { App, FuzzySuggestModal, FuzzyMatch, MarkdownView, Modal, Modifier, TFile } from 'obsidian';
import { PopNoteItem } from '../types';
import type PopNotePlugin from '../core/PopNotePlugin';

export class PopNotePickerModal extends FuzzySuggestModal<PopNoteItem> {
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
		const titleContainer = container.createDiv({ cls: 'popnote-suggestion-title' });

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