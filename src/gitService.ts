import * as vscode from 'vscode';
import { GitAPI, Repository, Change } from './types';
import { logGitOperation } from './logger';

// Git API cache and refresh functionality
let cachedGitAPI: GitAPI | undefined;
let gitAPILastRefresh: number = 0;
const GIT_API_REFRESH_INTERVAL = 5000; // 5 seconds

// Get VS Code Git API with caching and refresh functionality
export async function getGitAPI(forceRefresh: boolean = false): Promise<GitAPI | undefined> {
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
export async function getGitRepository(workspaceFolder: vscode.WorkspaceFolder, forceRefresh: boolean = false): Promise<Repository | undefined> {
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

// Check if current workspace is a git repository using VS Code Git API
export async function isGitRepository(workspaceFolder: string, forceRefresh: boolean = false): Promise<boolean> {
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

// Get changes between commits using VS Code Git API
export async function getChangesFromGitAPI(repository: Repository, fromCommit: string, toCommit: string = 'HEAD'): Promise<Change[]> {
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

// Force refresh Git API cache
export function refreshGitAPI(): void {
	logGitOperation('Forcing Git API cache refresh');
	cachedGitAPI = undefined;
	gitAPILastRefresh = 0;
}
