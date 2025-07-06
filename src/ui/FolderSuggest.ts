import { App, AbstractInputSuggest, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	textInputEl: HTMLInputElement;
	
	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.textInputEl = inputEl;
	}

	getSuggestions(inputStr: string): TFolder[] {
		const folders: TFolder[] = [];
		const lowerInput = inputStr.toLowerCase();
		
		// Add root folder option
		if (!inputStr || '/'.includes(lowerInput)) {
			folders.push(this.app.vault.getRoot());
		}
		
		// Get all folders matching the input
		this.app.vault.getAllLoadedFiles().forEach(file => {
			if (file instanceof TFolder && file.path.toLowerCase().includes(lowerInput)) {
				folders.push(file);
			}
		});
		
		// Sort by path length (shorter paths first)
		return folders.sort((a, b) => a.path.length - b.path.length).slice(0, 10);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		if (folder.path === '/') {
			el.setText('/ (Vault root)');
		} else {
			el.setText(folder.path);
		}
	}

	selectSuggestion(folder: TFolder): void {
		const inputEl = this.textInputEl;
		inputEl.value = folder.path === '/' ? '' : folder.path;
		inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}