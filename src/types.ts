import * as vscode from 'vscode';

// VS Code Git API types
export interface GitAPI {
	repositories: Repository[];
	getRepository(uri: vscode.Uri): Repository | null;
}

export interface Repository {
	rootUri: vscode.Uri;
	state: RepositoryState;
	getCommit(ref: string): Promise<Commit>;
	log(options?: LogOptions): Promise<Commit[]>;
	diff(cached?: boolean): Promise<Change[]>;
	diffWith(ref: string, path?: string): Promise<Change[]>;
	diffBetween(ref1: string, ref2: string, path?: string): Promise<Change[]>;
}

export interface RepositoryState {
	HEAD: Branch | undefined;
}

export interface Branch {
	name?: string;
	commit?: string;
}

export interface Commit {
	hash: string;
	message: string;
	authorDate?: Date;
	authorName?: string;
	authorEmail?: string;
}

export interface Change {
	uri: vscode.Uri;
	originalUri: vscode.Uri;
	status: Status;
	renameUri?: vscode.Uri;
}

export interface LogOptions {
	maxEntries?: number;
	reverse?: boolean;
}

export enum Status {
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

// Configuration interface
export interface ReviewConfig {
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

export interface ReviewResult {
	modelName: string;
	review: string;
}
