import { App, AbstractInputSuggest, TFile } from 'obsidian';

export class FileSuggest extends AbstractInputSuggest<TFile> {
	textInputEl: HTMLInputElement;
	
	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.textInputEl = inputEl;
	}

	getSuggestions(inputStr: string): TFile[] {
		const files: TFile[] = [];
		const lowerInput = inputStr.toLowerCase();
		
		this.app.vault.getAllLoadedFiles().forEach(file => {
			if (file instanceof TFile && 
				file.extension === 'md' && 
				file.path.toLowerCase().includes(lowerInput)) {
				files.push(file);
			}
		});
		
		// Sort by path
		return files.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 10);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
		// Add folder path as description if file is in a subfolder
		const folderPath = file.parent?.path;
		if (folderPath && folderPath !== '/') {
			el.createEl('small', { 
				text: ` (${folderPath})`,
				cls: 'popnote-file-suggestion-folder'
			});
		}
	}

	selectSuggestion(file: TFile): void {
		const inputEl = this.textInputEl;
		inputEl.value = file.path;
		inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}