import { App } from 'obsidian';

export class Logger {
	private app: App;
	private debugMode: boolean;
	private enableFileLogging: boolean = false;

	constructor(app: App, debugMode: boolean = false) {
		this.app = app;
		this.debugMode = debugMode;
	}

	setDebugMode(enabled: boolean) {
		this.debugMode = enabled;
	}

	setFileLogging(enabled: boolean) {
		this.enableFileLogging = enabled;
	}

	async debug(level: 'INFO' | 'ERROR' | 'WARN', ...args: any[]) {
		if (!this.debugMode) return;

		const timestamp = new Date().toISOString();
		const message = args.map(arg => 
			typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
		).join(' ');

		switch (level) {
			case 'INFO':
				console.log(`[PopNote] [${timestamp}]`, ...args);
				break;
			case 'ERROR':
				console.error(`[PopNote] [${timestamp}]`, ...args);
				break;
			case 'WARN':
				console.warn(`[PopNote] [${timestamp}]`, ...args);
				break;
		}

		// Write to log file if enabled
		if (this.enableFileLogging) {
			await this.writeToLogFile(level, message);
		}
	}

	async log(...args: any[]) {
		await this.debug('INFO', ...args);
	}

	async error(...args: any[]) {
		await this.debug('ERROR', ...args);
	}

	async warn(...args: any[]) {
		await this.debug('WARN', ...args);
	}

	private async writeToLogFile(level: string, message: string) {
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
			// Can't use error logging here to avoid infinite loop
			console.error('[PopNote] Failed to write to log file:', error);
		}
	}
}