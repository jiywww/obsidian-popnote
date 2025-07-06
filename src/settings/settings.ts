import { PopNoteSettings } from '../types';

export const DEFAULT_SETTINGS: PopNoteSettings = {
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
	// Window behavior settings
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
};