export interface PopNoteSettings {
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
	// Window behavior settings
	windowLevel: 'screen-saver' | 'floating' | 'normal';
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

import { TFile } from 'obsidian';

export interface PopNoteItem {
	file: TFile;
	displayText: string;
	metadata: string;
	isPinned: boolean;
}