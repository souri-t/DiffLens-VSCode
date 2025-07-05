import * as vscode from 'vscode';

// Create a dedicated output channel for git operations logging
let gitLogOutputChannel: vscode.OutputChannel | undefined;

export function getGitLogOutputChannel(): vscode.OutputChannel {
	if (!gitLogOutputChannel) {
		gitLogOutputChannel = vscode.window.createOutputChannel('DiffLens - Git Operations');
	}
	return gitLogOutputChannel;
}

export function logGitOperation(message: string, data?: any) {
	const timestamp = new Date().toISOString();
	const logMessage = data ? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}` : `[${timestamp}] ${message}`;
	
	console.log(logMessage);
	
	const outputChannel = getGitLogOutputChannel();
	outputChannel.appendLine(logMessage);
	outputChannel.show(true); // Show but don't take focus
}

export function disposeLogger() {
	if (gitLogOutputChannel) {
		gitLogOutputChannel.dispose();
		gitLogOutputChannel = undefined;
	}
}
