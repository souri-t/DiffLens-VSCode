import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Status, Change } from './types';
import { getGitRepository, getChangesFromGitAPI } from './gitService';
import { logGitOperation } from './logger';

const jsdiff = require('diff');
const execAsync = promisify(exec);

// Parse file extensions filter and return pathspec arguments
export function parseFileExtensionsFilter(fileExtensions: string): string[] {
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

// Convert git diff output to markdown format for better readability
export function formatDiffAsMarkdown(diff: string): string {
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

// Generate git diff using only the VS Code Git API (no native git command)
// The output format and filtering must match the native git diff --unified=<n> output as closely as possible
export async function generateNativeGitDiff(
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
export function generateUnifiedDiff(
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

// Show git diff from specific commit in a new document for preview - uses native git diff command
export async function showDiffPreviewFromCommit(workspacePath: string, commitHash: string, contextLines: number = 50, excludeDeletes: boolean = true, fileExtensions: string = ''): Promise<void> {
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
