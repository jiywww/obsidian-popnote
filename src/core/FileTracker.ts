import { TFile } from 'obsidian';
import { PopNoteSettings } from '../types';
import { Logger } from '../utils/logger';

export class FileTracker {
	private settings: PopNoteSettings;
	private logger: Logger;

	constructor(settings: PopNoteSettings, logger: Logger) {
		this.settings = settings;
		this.logger = logger;
	}

	getFileId(file: TFile): string | null {
		// Use creation time as file ID - it doesn't change on rename
		if (file && file.stat && file.stat.ctime) {
			return file.stat.ctime.toString();
		}
		return null;
	}

	trackFile(file: TFile): void {
		const fileId = this.getFileId(file);
		if (!fileId) {
			this.logger.warn('Cannot track file without ctime:', file.path);
			return;
		}

		// Initialize tracking objects if they don't exist
		if (!this.settings.fileTracking) {
			this.settings.fileTracking = {
				fileIdToPath: {},
				pathToFileId: {}
			};
		}
		if (!this.settings.fileTracking.fileIdToPath) {
			this.settings.fileTracking.fileIdToPath = {};
		}
		if (!this.settings.fileTracking.pathToFileId) {
			this.settings.fileTracking.pathToFileId = {};
		}

		// Update tracking
		const oldPath = this.settings.fileTracking.fileIdToPath[fileId];
		if (oldPath && oldPath !== file.path) {
			// File was renamed
			this.logger.log(`File renamed from ${oldPath} to ${file.path}`);
			delete this.settings.fileTracking.pathToFileId[oldPath];
		}

		this.settings.fileTracking.fileIdToPath[fileId] = file.path;
		this.settings.fileTracking.pathToFileId[file.path] = fileId;
	}

	updateFilePath(oldPath: string, newPath: string): void {
		// Initialize tracking objects if they don't exist
		if (!this.settings.fileTracking) {
			this.settings.fileTracking = {
				fileIdToPath: {},
				pathToFileId: {}
			};
		}

		const fileId = this.settings.fileTracking.pathToFileId?.[oldPath];
		if (fileId) {
			// Update tracking
			this.settings.fileTracking.fileIdToPath[fileId] = newPath;
			delete this.settings.fileTracking.pathToFileId[oldPath];
			this.settings.fileTracking.pathToFileId[newPath] = fileId;
			this.logger.log(`Updated file tracking: ${oldPath} -> ${newPath}`);
		}
	}

	getTrackedPath(fileId: string): string | undefined {
		return this.settings.fileTracking?.fileIdToPath?.[fileId];
	}

	saveCursorPosition(filePath: string, position: { line: number; ch: number }): void {
		if (!this.settings.cursorPositions) {
			this.settings.cursorPositions = {};
		}
		this.settings.cursorPositions[filePath] = position;
		this.logger.log(`Saved cursor position for ${filePath}:`, position);
	}

	getCursorPosition(filePath: string): { line: number; ch: number } | undefined {
		return this.settings.cursorPositions?.[filePath];
	}

	clearCursorPosition(filePath: string): void {
		if (this.settings.cursorPositions?.[filePath]) {
			delete this.settings.cursorPositions[filePath];
			this.logger.log(`Cleared cursor position for ${filePath}`);
		}
	}
}