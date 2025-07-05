import * as vscode from 'vscode';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SettingsViewProvider } from './settingsViewProvider';
import { exec } from 'child_process';
import { promisify } from 'util';
const jsdiff = require('diff');

const execAsync = promisify(exec);

// VS Code Git API types
interface GitAPI {
	repositories: Repository[];
	getRepository(uri: vscode.Uri): Repository | null;
}

interface Repository {
	rootUri: vscode.Uri;
	state: RepositoryState;
	getCommit(ref: string): Promise<Commit>;
	log(options?: LogOptions): Promise<Commit[]>;
	diff(cached?: boolean): Promise<Change[]>;
	diffWith(ref: string, path?: string): Promise<Change[]>;
	diffBetween(ref1: string, ref2: string, path?: string): Promise<Change[]>;
}

interface RepositoryState {
	HEAD: Branch | undefined;
}

interface Branch {
	name?: string;
	commit?: string;
}

interface Commit {
	hash: string;
	message: string;
	authorDate?: Date;
	authorName?: string;
	authorEmail?: string;
}

interface Change {
	uri: vscode.Uri;
	originalUri: vscode.Uri;
	status: Status;
	renameUri?: vscode.Uri;
}

interface LogOptions {
	maxEntries?: number;
	reverse?: boolean;
}

enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,
	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED
}

// Create a dedicated output channel for git operations logging
let gitLogOutputChannel: vscode.OutputChannel | undefined;

function getGitLogOutputChannel(): vscode.OutputChannel {
	if (!gitLogOutputChannel) {
		gitLogOutputChannel = vscode.window.createOutputChannel('DiffLens - Git Operations');
	}
	return gitLogOutputChannel;
}

function logGitOperation(message: string, data?: any) {
	const timestamp = new Date().toISOString();
	const logMessage = data ? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}` : `[${timestamp}] ${message}`;
	
	console.log(logMessage);
	
	const outputChannel = getGitLogOutputChannel();
	outputChannel.appendLine(logMessage);
	outputChannel.show(true); // Show but don't take focus
}

// Git API cache and refresh functionality
let cachedGitAPI: GitAPI | undefined;
let gitAPILastRefresh: number = 0;
const GIT_API_REFRESH_INTERVAL = 5000; // 5 seconds

// Get VS Code Git API with caching and refresh functionality
async function getGitAPI(forceRefresh: boolean = false): Promise<GitAPI | undefined> {
	try {
		const now = Date.now();
		
		// Return cached API if it's still valid and not forced to refresh
		if (!forceRefresh && cachedGitAPI && (now - gitAPILastRefresh) < GIT_API_REFRESH_INTERVAL) {
			logGitOperation('Using cached Git API');
			return cachedGitAPI;
		}

		logGitOperation('Refreshing Git API', { forceRefresh, lastRefresh: new Date(gitAPILastRefresh).toISOString() });

		const gitExtension = vscode.extensions.getExtension('vscode.git');
		if (!gitExtension) {
			logGitOperation('Git extension not found');
			cachedGitAPI = undefined;
			return undefined;
		}

		if (!gitExtension.isActive) {
			logGitOperation('Activating Git extension...');
			await gitExtension.activate();
			// Wait a bit more for Git to scan repositories
			await new Promise(resolve => setTimeout(resolve, 1000));
		}

		const gitAPI = gitExtension.exports?.getAPI(1);
		if (!gitAPI) {
			logGitOperation('Git API not available from extension');
			cachedGitAPI = undefined;
			return undefined;
		}

		// Wait for repositories to be discovered if none are available yet
		if (gitAPI.repositories.length === 0) {
			logGitOperation('No repositories found yet, waiting for discovery...');
			await new Promise(resolve => setTimeout(resolve, 1500));
		}

		cachedGitAPI = gitAPI;
		gitAPILastRefresh = now;
		
		logGitOperation('Git API successfully obtained/refreshed', { 
			repositoryCount: gitAPI.repositories.length,
			repositories: gitAPI.repositories.map((repo: Repository) => repo.rootUri.fsPath)
		});
		
		return gitAPI;
	} catch (error) {
		logGitOperation('Failed to get Git API', error);
		cachedGitAPI = undefined;
		return undefined;
	}
}

// Get Git repository for the current workspace with refresh capability
async function getGitRepository(workspaceFolder: vscode.WorkspaceFolder, forceRefresh: boolean = false): Promise<Repository | undefined> {
	try {
		const gitAPI = await getGitAPI(forceRefresh);
		if (!gitAPI) {
			logGitOperation('Git API not available');
			return undefined;
		}

		// Wait a bit for Git API to initialize repositories
		await new Promise(resolve => setTimeout(resolve, 100));

		logGitOperation('Available repositories', { 
			count: gitAPI.repositories.length,
			forceRefresh 
		});
		gitAPI.repositories.forEach((repo: Repository, index: number) => {
			logGitOperation(`Repository ${index}`, { path: repo.rootUri.fsPath });
		});

		// First try direct lookup
		let repository = gitAPI.getRepository(workspaceFolder.uri);
		if (repository) {
			logGitOperation('Found repository via direct lookup', { rootUri: repository.rootUri.fsPath });
			return repository;
		}

		// If not found, search in available repositories
		const foundRepository = gitAPI.repositories.find((repo: Repository) => 
			workspaceFolder.uri.fsPath.startsWith(repo.rootUri.fsPath) ||
			repo.rootUri.fsPath.startsWith(workspaceFolder.uri.fsPath)
		);

		if (foundRepository) {
			logGitOperation('Found repository via search', { rootUri: foundRepository.rootUri.fsPath });
			return foundRepository;
		}

		// If still not found, try to find any repository in the workspace
		for (const repo of gitAPI.repositories) {
			if (repo.rootUri.fsPath.includes(workspaceFolder.name)) {
				logGitOperation('Found repository via name match', { rootUri: repo.rootUri.fsPath });
				return repo;
			}
		}

		logGitOperation('No repository found for workspace', { workspaceFolder: workspaceFolder.uri.fsPath });
		
		// If still no repository found and not already refreshed, try force refresh
		if (!forceRefresh && gitAPI.repositories.length === 0) {
			logGitOperation('No repositories available, trying force refresh...');
			return await getGitRepository(workspaceFolder, true);
		}
		
		// If still no repository found, wait a bit more and try again
		if (gitAPI.repositories.length === 0) {
			logGitOperation('No repositories available yet, waiting and retrying...');
			await new Promise(resolve => setTimeout(resolve, 500));
			
			const refreshedGitAPI = await getGitAPI(true);
			if (refreshedGitAPI && refreshedGitAPI.repositories.length > 0) {
				logGitOperation('Repositories available after wait', { count: refreshedGitAPI.repositories.length });
				const retryRepository = refreshedGitAPI.getRepository(workspaceFolder.uri) || 
					refreshedGitAPI.repositories.find((repo: Repository) => 
						workspaceFolder.uri.fsPath.startsWith(repo.rootUri.fsPath) ||
						repo.rootUri.fsPath.startsWith(workspaceFolder.uri.fsPath)
					);
				
				if (retryRepository) {
					logGitOperation('Found repository on retry', { rootUri: retryRepository.rootUri.fsPath });
					return retryRepository;
				}
			}
		}

		return undefined;
	} catch (error) {
		logGitOperation('Failed to get git repository', error);
		return undefined;
	}
}

// Configuration interface
interface ReviewConfig {
	systemPrompt: string;
	reviewPerspective: string;
	contextLines: number;
	excludeDeletes: boolean;
	llmProvider: 'bedrock' | 'vscode-lm';
	awsAccessKey: string;
	awsSecretKey: string;
	awsRegion: string;
	modelName: string;
	vscodeLmVendor: string;
	vscodeLmFamily: string;
	fileExtensions: string;
}

// Get configuration from VS Code settings
function getConfiguration(): ReviewConfig {
	const config = vscode.workspace.getConfiguration('diffLens');
	
	const contextLines = config.get<number>('contextLines', 50);
	
	const result = {
		systemPrompt: config.get('systemPrompt', ''),
		reviewPerspective: config.get('reviewPerspective', ''),
		contextLines: typeof contextLines === 'number' ? contextLines : 50,
		excludeDeletes: config.get('excludeDeletes', true),
		llmProvider: config.get<'bedrock' | 'vscode-lm'>('llmProvider', 'bedrock'),
		awsAccessKey: config.get('awsAccessKey', ''),
		awsSecretKey: config.get('awsSecretKey', ''),
		awsRegion: config.get('awsRegion', 'us-east-1'),
		modelName: config.get('modelName', 'anthropic.claude-3-sonnet-20240229-v1:0'),
		vscodeLmVendor: config.get('vscodeLmVendor', 'copilot'),
		vscodeLmFamily: config.get('vscodeLmFamily', 'gpt-4o'),
		fileExtensions: config.get('fileExtensions', '')
	};
	
	// Debug log to check configuration values
	console.log('Configuration loaded:', {
		systemPrompt: result.systemPrompt ? '***SET***' : 'EMPTY',
		reviewPerspective: result.reviewPerspective ? '***SET***' : 'EMPTY',
		contextLines: result.contextLines,
		excludeDeletes: result.excludeDeletes,
		llmProvider: result.llmProvider,
		awsAccessKey: result.awsAccessKey ? '***SET***' : 'EMPTY',
		awsSecretKey: result.awsSecretKey ? '***SET***' : 'EMPTY',
		awsRegion: result.awsRegion,
		modelName: result.modelName,
		vscodeLmVendor: result.vscodeLmVendor,
		vscodeLmFamily: result.vscodeLmFamily,
		fileExtensions: result.fileExtensions
	});
	
	// Also show in VS Code output for easier debugging
	const outputChannel = vscode.window.createOutputChannel('DiffLens Debug');
	outputChannel.appendLine(`[${new Date().toISOString()}] Configuration loaded:`);
	outputChannel.appendLine(`  System Prompt: ${result.systemPrompt ? '***SET***' : 'EMPTY'}`);
	outputChannel.appendLine(`  Review Perspective: ${result.reviewPerspective ? '***SET***' : 'EMPTY'}`);
	outputChannel.appendLine(`  Context Lines: ${result.contextLines}`);
	outputChannel.appendLine(`  Exclude Deletes: ${result.excludeDeletes}`);
	outputChannel.appendLine(`  LLM Provider: ${result.llmProvider}`);
	outputChannel.appendLine(`  AWS Access Key: ${result.awsAccessKey ? '***SET***' : 'EMPTY'}`);
	outputChannel.appendLine(`  AWS Secret Key: ${result.awsSecretKey ? '***SET***' : 'EMPTY'}`);
	outputChannel.appendLine(`  AWS Region: ${result.awsRegion}`);
	outputChannel.appendLine(`  Model Name: ${result.modelName}`);
	outputChannel.appendLine(`  VS Code LM Vendor: ${result.vscodeLmVendor}`);
	outputChannel.appendLine(`  VS Code LM Family: ${result.vscodeLmFamily}`);
	outputChannel.appendLine(`  File Extensions: ${result.fileExtensions}`);
	outputChannel.show();
	
	return result;
}

// Check if current workspace is a git repository using VS Code Git API
async function isGitRepository(workspaceFolder: string, forceRefresh: boolean = false): Promise<boolean> {
	try {
		logGitOperation('isGitRepository: Checking if repository', { workspaceFolder, forceRefresh });
		
		const gitAPI = await getGitAPI(forceRefresh);
		if (!gitAPI) {
			logGitOperation('isGitRepository: Git API not available');
			return false;
		}

		const uri = vscode.Uri.file(workspaceFolder);
		const repository = gitAPI.getRepository(uri);
		
		if (!repository) {
			// Also check if any repository contains this workspace folder
			const foundRepository = gitAPI.repositories.find(repo => 
				workspaceFolder.startsWith(repo.rootUri.fsPath) ||
				repo.rootUri.fsPath.startsWith(workspaceFolder)
			);
			
			if (!foundRepository) {
				logGitOperation('isGitRepository: No repository found for workspace');
				return false;
			}
		}

		logGitOperation('isGitRepository: Repository found via VS Code Git API', { 
			rootUri: repository?.rootUri.fsPath || 'found in repositories list' 
		});
		return true;
	} catch (error) {
		logGitOperation('isGitRepository: Repository check failed', error);
		return false;
	}
}

// Parse file extensions filter and return pathspec arguments
function parseFileExtensionsFilter(fileExtensions: string): string[] {
	if (!fileExtensions || !fileExtensions.trim()) {
		logGitOperation('parseFileExtensionsFilter: No file extensions provided');
		return [];
	}
	
	logGitOperation('parseFileExtensionsFilter: Input fileExtensions', fileExtensions);
	
	// Split by comma, semicolon, or space and trim whitespace
	const extensions = fileExtensions.split(/[,;\s]+/).map(ext => ext.trim()).filter(ext => ext);
	logGitOperation('parseFileExtensionsFilter: Parsed extensions array', extensions);
	
	// Process each extension to ensure it's in the correct format for git pathspec
	const result: string[] = [];
	
	extensions.forEach(ext => {
		// If it already looks like a complex pathspec (contains ** or /), use as-is
		if (ext.includes('**') || ext.includes('/')) {
			logGitOperation(`parseFileExtensionsFilter: Using complex pathspec as-is: ${ext}`);
			result.push(ext);
			return;
		}
		
		// For simple patterns, generate both direct and recursive patterns
		let basePattern: string;
		
		if (ext.startsWith('*')) {
			// Already has wildcard, use as-is for direct pattern
			basePattern = ext;
		} else if (ext.startsWith('.')) {
			// Convert .ext to *.ext
			basePattern = `*${ext}`;
		} else {
			// Just extension name, convert to *.ext
			basePattern = `*.${ext}`;
		}
		
		// Add both patterns: direct (*.ext) and recursive (**/*.ext)
		const directPattern = basePattern;
		const recursivePattern = `**/${basePattern}`;
		
		result.push(directPattern);
		result.push(recursivePattern);
		
		logGitOperation(`parseFileExtensionsFilter: Added patterns for ${ext}`, {
			direct: directPattern,
			recursive: recursivePattern
		});
	});
	
	logGitOperation('parseFileExtensionsFilter: Final pathspecs (direct + recursive)', result);
	return result;
}

// Send diff to AWS Bedrock for review
async function reviewWithBedrock(diff: string, config: ReviewConfig): Promise<{modelName: string, review: string}> {
	try {
		const client = new BedrockRuntimeClient({
			region: config.awsRegion,
			credentials: {
				accessKeyId: config.awsAccessKey,
				secretAccessKey: config.awsSecretKey
			}
		});

		const prompt = `${config.systemPrompt}

Review Perspective: ${config.reviewPerspective}

Please review the following git diff (formatted in markdown for better readability):

${formatDiffAsMarkdown(diff)}

Please provide a detailed code review with specific suggestions for improvement.`;

		const input = {
			modelId: config.modelName,
			contentType: 'application/json',
			accept: 'application/json',
			body: JSON.stringify({
				anthropic_version: 'bedrock-2023-05-31',
				max_tokens: 4000,
				messages: [
					{
						role: 'user',
						content: prompt
					}
				]
			})
		};

		const command = new InvokeModelCommand(input);
		const response = await client.send(command);
		
		const responseBody = JSON.parse(new TextDecoder().decode(response.body));
		return {
			modelName: config.modelName,
			review: responseBody.content[0].text
		};
	} catch (error) {
		throw new Error(`Failed to get review from Bedrock: ${error}`);
	}
}

// Send diff to VS Code LM API for review
async function reviewWithVSCodeLM(diff: string, config: ReviewConfig): Promise<{modelName: string, review: string}> {
	try {
		// First, try to get models with the specific family without vendor restriction
		let models = await vscode.lm.selectChatModels({
			family: config.vscodeLmFamily
		});

		// If no models found, try to get all models and filter by family
		if (models.length === 0) {
			const allModels = await vscode.lm.selectChatModels();
			models = allModels.filter(model => model.family === config.vscodeLmFamily);
		}

		// If still no models found, try with copilot vendor (for backward compatibility)
		if (models.length === 0) {
			models = await vscode.lm.selectChatModels({
				vendor: config.vscodeLmVendor,
				family: config.vscodeLmFamily
			});
		}

		if (models.length === 0) {
			// Get all available models for debugging
			const allModels = await vscode.lm.selectChatModels();
			const availableFamilies = [...new Set(allModels.map(m => m.family))].sort();
			const availableVendors = [...new Set(allModels.map(m => m.vendor))].sort();
			
			throw new Error(`No VS Code LM models available for family: ${config.vscodeLmFamily}. Available families: ${availableFamilies.join(', ')}. Available vendors: ${availableVendors.join(', ')}`);
		}

		const [model] = models;
		console.log(`Using VS Code LM model: ${model.name} (vendor: ${model.vendor}, family: ${model.family})`);
		
		const prompt = `${config.systemPrompt}

Review Perspective: ${config.reviewPerspective}

Please review the following git diff (formatted in markdown for better readability):

${formatDiffAsMarkdown(diff)}

Please provide a detailed code review with specific suggestions for improvement.`;

		const messages = [
			vscode.LanguageModelChatMessage.User(prompt)
		];

		const request = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
		
		let response = '';
		for await (const fragment of request.text) {
			response += fragment;
		}
		
		return {
			modelName: `${model.vendor}/${model.family} (${model.name})`,
			review: response
		};
	} catch (error) {
		if (error instanceof vscode.LanguageModelError) {
			throw new Error(`VS Code LM Error: ${error.message} (${error.code})`);
		}
		throw new Error(`Failed to get review from VS Code LM: ${error}`);
	}
}

// Send diff to the configured LLM provider for review
async function reviewWithLLM(diff: string, config: ReviewConfig): Promise<{modelName: string, review: string}> {
	switch (config.llmProvider) {
		case 'bedrock':
			return await reviewWithBedrock(diff, config);
		case 'vscode-lm':
			return await reviewWithVSCodeLM(diff, config);
		default:
			throw new Error(`Unknown LLM provider: ${config.llmProvider}`);
	}
}

// Show review results in a new document
async function showReviewResults(reviewResult: {modelName: string, review: string}): Promise<void> {
	const timestamp = new Date().toLocaleString();
	const content = `# Code Review Results

**Model Used:** ${reviewResult.modelName}  
**Generated at:** ${timestamp}

---

${reviewResult.review}`;

	const doc = await vscode.workspace.openTextDocument({
		content: content,
		language: 'markdown'
	});
	await vscode.window.showTextDocument(doc);
}

// Show git diff from specific commit in a new document for preview - uses native git diff command
async function showDiffPreviewFromCommit(workspacePath: string, commitHash: string, contextLines: number = 50, excludeDeletes: boolean = true, fileExtensions: string = ''): Promise<void> {
	try {
		logGitOperation('showDiffPreviewFromCommit: Starting with parameters', {
			workspacePath,
			commitHash: commitHash.substring(0, 8),
			contextLines,
			excludeDeletes,
			fileExtensions
		});

		// Generate unified diff using native git command
		const diff = await generateNativeGitDiff(workspacePath, commitHash, contextLines, excludeDeletes, fileExtensions);
		const shortHash = commitHash.substring(0, 8);
		
		const filterInfo = fileExtensions ? `\nFile Extensions Filter: ${fileExtensions}` : '';
		
		const previewContent = `# Git Diff Preview

**Comparison:** Current HEAD vs Commit ${shortHash}  
**Context Lines (git diff -U${contextLines}):** ${contextLines}  
**Options:** ${excludeDeletes ? 'Exclude deleted files' : 'Include all changes'}${filterInfo}  
**Generated at:** ${new Date().toLocaleString()}

---

\`\`\`diff
${diff}
\`\`\``;

		const doc = await vscode.workspace.openTextDocument({
			content: previewContent,
			language: 'markdown'
		});
		await vscode.window.showTextDocument(doc);
		
		logGitOperation('showDiffPreviewFromCommit: Preview document created successfully');
	} catch (error) {
		logGitOperation('showDiffPreviewFromCommit: Error occurred', error);
		vscode.window.showErrorMessage(`Error showing diff preview: ${error}`);
	}
}

// Convert git diff output to markdown format for better readability
function formatDiffAsMarkdown(diff: string): string {
	const lines = diff.split('\n');
	const result: string[] = [];
	let currentFile = '';
	let inFileHeader = false;
	let fileContent: string[] = [];
	
	// Helper function to process accumulated file content
	const processFileContent = () => {
		if (currentFile && fileContent.length > 0) {
			result.push(`## ${currentFile}`);
			result.push('');
			result.push('```diff');
			result.push(...fileContent);
			result.push('```');
			result.push('');
		}
	};
	
	for (const line of lines) {
		// Check for file header patterns
		if (line.startsWith('diff --git ')) {
			// Process previous file if exists
			processFileContent();
			
			// Extract file paths from "diff --git a/path b/path"
			const match = line.match(/diff --git a\/(.+) b\/(.+)/);
			if (match) {
				currentFile = match[2]; // Use the "b/" path (destination)
			} else {
				currentFile = 'Unknown file';
			}
			fileContent = [];
			inFileHeader = true;
			continue;
		}
		
		// Skip git metadata lines but keep tracking file headers
		if (line.startsWith('index ') || 
			line.startsWith('--- ') || 
			line.startsWith('+++ ')) {
			continue;
		}
		
		// Add content lines to current file
		if (currentFile) {
			inFileHeader = false;
			fileContent.push(line);
		}
	}
	
	// Process the last file
	processFileContent();
	
	// If no files were processed, return original diff in a code block
	if (result.length === 0) {
		return `\`\`\`diff\n${diff}\n\`\`\``;
	}
	
	return result.join('\n');
}

// Validate configuration
function validateConfiguration(config: ReviewConfig): string[] {
	const errors: string[] = [];
	
	console.log('Validating configuration:', {
		llmProvider: config.llmProvider,
		awsAccessKey: config.awsAccessKey ? '***SET***' : 'EMPTY',
		awsSecretKey: config.awsSecretKey ? '***SET***' : 'EMPTY',
		systemPrompt: config.systemPrompt ? '***SET***' : 'EMPTY',
		reviewPerspective: config.reviewPerspective ? '***SET***' : 'EMPTY',
		vscodeLmVendor: config.vscodeLmVendor,
		vscodeLmFamily: config.vscodeLmFamily
	});
	
	// Common validation
	if (!config.systemPrompt) {
		console.log('System Prompt is missing');
		errors.push('System Prompt is required');
	}
	if (!config.reviewPerspective) {
		console.log('Review Perspective is missing');
		errors.push('Review Perspective is required');
	}
	
	// Provider-specific validation
	if (config.llmProvider === 'bedrock') {
		if (!config.awsAccessKey) {
			console.log('AWS Access Key is missing');
			errors.push('AWS Access Key is required for Bedrock');
		}
		if (!config.awsSecretKey) {
			console.log('AWS Secret Key is missing');
			errors.push('AWS Secret Key is required for Bedrock');
		}
	} else if (config.llmProvider === 'vscode-lm') {
		if (!config.vscodeLmFamily) {
			console.log('VS Code LM Family is missing');
			errors.push('VS Code LM Family is required');
		}
	}
	
	console.log('Validation errors:', errors);
	return errors;
}

// Get available VS Code LM families
async function getAvailableVSCodeLMFamilies(): Promise<string[]> {
	try {
		const allModels = await vscode.lm.selectChatModels();
		const families = [...new Set(allModels.map(model => model.family))].sort();
		console.log('Available VS Code LM families:', families);
		return families;
	} catch (error) {
		console.log('Failed to get VS Code LM families:', error);
		// Return default families as fallback
		return ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo', 'claude-3-5-sonnet', 'claude-3-haiku', 'claude-3-opus', 'gemini-1.5-pro', 'gemini-1.5-flash'];
	}
}

// Get changes between commits using VS Code Git API
async function getChangesFromGitAPI(repository: Repository, fromCommit: string, toCommit: string = 'HEAD'): Promise<Change[]> {
	try {
		logGitOperation('getChangesFromGitAPI: Getting changes between commits', {
			from: fromCommit.substring(0, 8),
			to: toCommit
		});

		// Get changes between two commits
		const changes = await repository.diffBetween(fromCommit, toCommit);
		
		logGitOperation('getChangesFromGitAPI: Found changes', {
			count: changes.length,
			files: changes.map(c => c.uri.fsPath)
		});

		return changes;
	} catch (error) {
		logGitOperation('getChangesFromGitAPI: Failed to get changes', error);
		throw error;
	}
}

// Generate git diff using only the VS Code Git API (no native git command)
// The output format and filtering must match the native git diff --unified=<n> output as closely as possible
async function generateNativeGitDiff(
	workspacePath: string,
	compareToCommit: string | null,
	contextLines: number = 50,
	excludeDeletes: boolean = true,
	fileExtensions: string = ''
): Promise<string> {
	try {
		logGitOperation('generateNativeGitDiff (GitAPI): Starting with parameters', {
			workspacePath,
			compareToCommit: compareToCommit ? compareToCommit.substring(0, 8) : 'previous commit',
			contextLines,
			excludeDeletes,
			fileExtensions
		});

		// Find the workspace folder and repository
		const workspaceFolder = vscode.workspace.workspaceFolders?.find(
			f => f.uri.fsPath === workspacePath
		);
		if (!workspaceFolder) {
			throw new Error('Workspace folder not found');
		}
		const repository = await getGitRepository(workspaceFolder);
		if (!repository) {
			throw new Error('Git repository not found');
		}

		// Determine the commit range
		let fromCommit = compareToCommit;
		let toCommit = 'HEAD';
		if (!fromCommit) {
			// Default: previous commit to HEAD
			const log = await repository.log({ maxEntries: 2 });
			if (log.length < 2) {
				throw new Error('Not enough commits to compare');
			}
			fromCommit = log[1].hash;
		}

		// Get changes between commits
		const changes = await getChangesFromGitAPI(repository, fromCommit, toCommit);

		// Filter by file extension if needed
		let filteredChanges = changes;
		if (fileExtensions) {
			const pathspecs = parseFileExtensionsFilter(fileExtensions);
			filteredChanges = changes.filter(change => {
				const rel = vscode.workspace.asRelativePath(change.uri);
				return pathspecs.some(pattern => {
					// Simple glob-like matching for *.ext and **/*.ext
					if (pattern.startsWith('**/')) {
						const ext = pattern.replace('**/', '');
						return rel.endsWith(ext.replace('*', ''));
					}
					if (pattern.startsWith('*')) {
						return rel.endsWith(pattern.replace('*', ''));
					}
					return rel.endsWith(pattern);
				});
			});
		}

		// Exclude deleted files if requested
		if (excludeDeletes) {
			filteredChanges = filteredChanges.filter(change =>
				change.status !== Status.DELETED && change.status !== Status.INDEX_DELETED
			);
		}

		if (filteredChanges.length === 0) {
			const filterInfo = fileExtensions ? ` with filter "${fileExtensions}"` : '';
			const compareInfo = compareToCommit ? ` between commit ${compareToCommit.substring(0, 8)} and HEAD` : ' in the latest commit';
			throw new Error(`No changes found${compareInfo}${filterInfo}`);
		}

		// Generate diff output for each file
		const diffs: string[] = [];
		for (const change of filteredChanges) {
			const relPath = vscode.workspace.asRelativePath(change.uri);
			const oldPath = relPath;
			const newPath = relPath;

			// Get file contents at both commits
			let oldContent = '';
			let newContent = '';
			try {
				// Try to get old content using git show
				const { stdout: oldStdout } = await execAsync(
					`git -C "${workspacePath}" show ${fromCommit}:${relPath}`
				);
				oldContent = oldStdout;
			} catch {
				oldContent = '';
			}
			try {
				const { stdout: newStdout } = await execAsync(
					`git -C "${workspacePath}" show ${toCommit}:${relPath}`
				);
				newContent = newStdout;
			} catch {
				newContent = '';
			}

			// Generate unified diff for this file
			const diff = generateUnifiedDiff(oldPath, newPath, oldContent, newContent, contextLines);
			if (diff) {
				diffs.push(diff);
			}
		}

		const result = diffs.join('\n');
		logGitOperation('generateNativeGitDiff (GitAPI): Successfully generated diff', {
			linesCount: result.split('\n').length,
			sizeBytes: result.length
		});
		return result;
	} catch (error) {
		logGitOperation('generateNativeGitDiff (GitAPI): Error occurred', error);
		throw new Error(`Failed to generate git diff: ${error}`);
	}
}

// Generate unified diff string for a single file (mimics git diff --unified)
// Uses the 'diff' npm package if available, otherwise a simple implementation
function generateUnifiedDiff(
	oldPath: string,
	newPath: string,
	oldContent: string,
	newContent: string,
	contextLines: number
): string {
	const diff = jsdiff.structuredPatch(
		oldPath,
		newPath,
		oldContent,
		newContent,
		'',
		'',
		{ context: contextLines }
	);
	let result = '';
	result += `diff --git a/${oldPath} b/${newPath}\n`;
	result += `index 0000000..0000000 100644\n`;
	result += `--- a/${oldPath}\n`;
	result += `+++ b/${newPath}\n`;
	for (const hunk of diff.hunks) {
		result += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
		for (const line of hunk.lines) {
			result += line + '\n';
		}
	}
	return result.trim() ? result : '';
}

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
			const gitAPI = await getGitAPI();
			if (gitAPI && gitAPI.repositories.length > 0) {
				console.log('Git API initialized successfully with', gitAPI.repositories.length, 'repositories');
			} else {
				console.log('Git API initialized but no repositories found yet');
			}
		} catch (error) {
			console.log('Error during initial Git API initialization:', error);
		}
	}, 500);

	// Monitor window state changes to refresh Git API when needed
	context.subscriptions.push(
		vscode.window.onDidChangeWindowState((state) => {
			if (state.focused) {
				logGitOperation('Window gained focus, refreshing Git API');
				refreshGitAPI();
			}
		})
	);

	// Monitor workspace folder changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			logGitOperation('Workspace folders changed, refreshing Git API');
			refreshGitAPI();
		})
	);

	// Monitor view visibility changes (for sidebar switching)
	let lastActiveView: string | undefined;
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			// This is an indirect way to detect view changes
			// We'll also add a periodic refresh for better reliability
		})
	);

	// Periodic Git API refresh to handle sidebar switches
	const refreshInterval = setInterval(() => {
		const now = Date.now();
		if ((now - gitAPILastRefresh) > (GIT_API_REFRESH_INTERVAL * 2)) {
			logGitOperation('Periodic Git API refresh');
			refreshGitAPI();
		}
	}, GIT_API_REFRESH_INTERVAL);

	context.subscriptions.push({
		dispose: () => {
			clearInterval(refreshInterval);
		}
	});

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

// Force refresh Git API cache
function refreshGitAPI(): void {
	logGitOperation('Forcing Git API cache refresh');
	cachedGitAPI = undefined;
	gitAPILastRefresh = 0;
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (gitLogOutputChannel) {
		gitLogOutputChannel.dispose();
		gitLogOutputChannel = undefined;
	}
}
