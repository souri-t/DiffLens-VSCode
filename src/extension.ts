import * as vscode from 'vscode';
import { SettingsViewProvider } from './settingsViewProvider';
import { getConfiguration, validateConfiguration, getAvailableVSCodeLMFamilies } from './configService';
import { isGitRepository, refreshGitAPI } from './gitService';
import { generateNativeGitDiff, showDiffPreviewFromCommit } from './diffService';
import { reviewWithLLM, showReviewResults } from './reviewService';
import { logGitOperation, disposeLogger } from './logger';

export function activate(context: vscode.ExtensionContext) {
	console.log('DiffLens extension is now active!');

	// Register the settings view provider
	const settingsProvider = new SettingsViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, settingsProvider)
	);

	// Initialize Git API early to ensure it's ready when views are displayed
	setTimeout(async () => {
		console.log('Performing initial Git API initialization...');
		try {
			await refreshGitAPI();
		} catch (error) {
			console.log('Error during initial Git API initialization:', error);
		}
	}, 500);

	// Register VS Code LM families command
	const getVSCodeFamiliesCommand = vscode.commands.registerCommand('diff-lens.getVSCodeFamilies', async () => {
		return await getAvailableVSCodeLMFamilies();
	});

	// Register Git repository refresh command
	const refreshGitRepoCommand = vscode.commands.registerCommand('diff-lens.refreshGitRepo', async () => {
		logGitOperation('Manual Git repository refresh requested');
		refreshGitAPI();
		
		// Also refresh the settings view if it has a refresh method
		if (settingsProvider && typeof settingsProvider.refreshBranchInfo === 'function') {
		    settingsProvider.refreshBranchInfo();
		}
		
		vscode.window.showInformationMessage('Git repository information refreshed');
	});

	// Register code review command
	const reviewCommand = vscode.commands.registerCommand('diff-lens.reviewCode', async (selectedCommit?: string, customPrompts?: {systemPrompt: string, reviewPerspective: string}) => {
		await runCodeReview(selectedCommit, customPrompts);
	});

	// Register diff preview command
	const previewCommand = vscode.commands.registerCommand('diff-lens.previewDiff', async (selectedCommit?: string) => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder found. Please open a folder containing a git repository.');
			return;
		}

		const workspacePath = workspaceFolder.uri.fsPath;

		// Check if it's a git repository - try with cache first, then force refresh if needed
		let isRepo = await isGitRepository(workspacePath);
		if (!isRepo) {
			logGitOperation('Repository check failed with cache, trying force refresh');
			isRepo = await isGitRepository(workspacePath, true);
		}
		
		if (!isRepo) {
			vscode.window.showErrorMessage('Current workspace is not a git repository.');
			return;
		}

		if (!selectedCommit) {
			return;
		}

		const config = getConfiguration();
		console.log('Preview diff with contextLines:', config.contextLines, 'excludeDeletes:', config.excludeDeletes, 'fileExtensions:', config.fileExtensions); // Debug log
		await showDiffPreviewFromCommit(workspacePath, selectedCommit, config.contextLines, config.excludeDeletes, config.fileExtensions);
	});

	// Register settings command
	const settingsCommand = vscode.commands.registerCommand('diff-lens.openSettings', () => {
		vscode.commands.executeCommand('workbench.view.explorer');
		vscode.commands.executeCommand('diff-lens-settings.focus');
	});

	// Register toggle settings command for toolbar
	const toggleSettingsCommand = vscode.commands.registerCommand('diff-lens.toggleSettings', () => {
		settingsProvider.toggleSettingsVisibility();
	});

	context.subscriptions.push(reviewCommand, previewCommand, settingsCommand, toggleSettingsCommand, getVSCodeFamiliesCommand, refreshGitRepoCommand);
}

async function runCodeReview(selectedCommit?: string, customPrompts?: {systemPrompt: string, reviewPerspective: string}) {
	try {
		// Get current workspace folder
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder found. Please open a folder containing a git repository.');
			return;
		}

		const workspacePath = workspaceFolder.uri.fsPath;

		// Check if it's a git repository - try with cache first, then force refresh if needed
		let isRepo = await isGitRepository(workspacePath);
		if (!isRepo) {
			logGitOperation('Repository check failed with cache, trying force refresh');
			isRepo = await isGitRepository(workspacePath, true);
		}
		
		if (!isRepo) {
			vscode.window.showErrorMessage('Current workspace is not a git repository.');
			return;
		}

		// Get configuration
		const config = getConfiguration();
		
		// Override with custom prompts if provided
		if (customPrompts) {
			config.systemPrompt = customPrompts.systemPrompt;
			config.reviewPerspective = customPrompts.reviewPerspective;
		}
		
		console.log('Current contextLines setting:', config.contextLines, 'excludeDeletes:', config.excludeDeletes, 'fileExtensions:', config.fileExtensions); // Debug log
		logGitOperation('runCodeReview: Configuration loaded', {
			contextLines: config.contextLines,
			excludeDeletes: config.excludeDeletes,
			fileExtensions: config.fileExtensions,
			hasSystemPrompt: !!config.systemPrompt,
			hasReviewPerspective: !!config.reviewPerspective,
			selectedCommit: selectedCommit ? selectedCommit.substring(0, 8) : 'none'
		});
		const configErrors = validateConfiguration(config);
		if (configErrors.length > 0) {
			vscode.window.showErrorMessage(`Configuration errors: ${configErrors.join(', ')}`);
			return;
		}

		// Show progress
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Reviewing code with ${config.llmProvider === 'bedrock' ? 'AWS Bedrock' : 'VS Code LM'}`,
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0, message: 'Getting git diff...' });

			// Get git diff using native git command (same as preview function)
			const diff = await generateNativeGitDiff(workspacePath, selectedCommit || null, config.contextLines, config.excludeDeletes, config.fileExtensions);
			
			progress.report({ increment: 50, message: `Sending to ${config.llmProvider.toUpperCase()} for review...` });

			// Send to LLM for review
			const reviewResult = await reviewWithLLM(diff, config);
			
			progress.report({ increment: 100, message: 'Review complete!' });

			// Show results
			await showReviewResults(reviewResult);
		});

	} catch (error) {
		vscode.window.showErrorMessage(`Error during code review: ${error}`);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	disposeLogger();
}
