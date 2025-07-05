import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// VS Code Git API types (duplicate from extension.ts for self-contained provider)
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
	getBranch?(name: string): Promise<Branch>;
	getBranches?(query: any): Promise<any[]>;
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

// Get VS Code Git API
async function getGitAPI(): Promise<GitAPI | undefined> {
	try {
		const gitExtension = vscode.extensions.getExtension('vscode.git');
		if (!gitExtension) {
			console.log('Git extension not found');
			return undefined;
		}

		if (!gitExtension.isActive) {
			console.log('Activating Git extension...');
			await gitExtension.activate();
			// Wait a bit more for Git to scan repositories
			await new Promise(resolve => setTimeout(resolve, 1000));
		}

		const gitAPI = gitExtension.exports?.getAPI(1);
		if (!gitAPI) {
			console.log('Git API not available from extension');
			return undefined;
		}

		console.log('Git API successfully obtained');
		return gitAPI;
	} catch (error) {
		console.log('Failed to get Git API:', error);
		return undefined;
	}
}

// Get Git repository for the given workspace
async function getGitRepository(workspaceFolder: vscode.WorkspaceFolder): Promise<Repository | undefined> {
	try {
		const gitAPI = await getGitAPI();
		if (!gitAPI) {
			console.log('Git API not available');
			return undefined;
		}

		// Wait a bit for Git API to initialize repositories
		await new Promise(resolve => setTimeout(resolve, 100));

		console.log('Available repositories:', gitAPI.repositories.length);
		gitAPI.repositories.forEach((repo, index) => {
			console.log(`Repository ${index}: ${repo.rootUri.fsPath}`);
		});

		// First try direct lookup
		let repository = gitAPI.getRepository(workspaceFolder.uri);
		if (repository) {
			console.log('Found repository via direct lookup:', repository.rootUri.fsPath);
			return repository;
		}

		// If not found, search in available repositories
		const foundRepository = gitAPI.repositories.find(repo => 
			workspaceFolder.uri.fsPath.startsWith(repo.rootUri.fsPath) ||
			repo.rootUri.fsPath.startsWith(workspaceFolder.uri.fsPath)
		);

		if (foundRepository) {
			console.log('Found repository via search:', foundRepository.rootUri.fsPath);
			return foundRepository;
		}

		// If still not found, try to find any repository in the workspace
		for (const repo of gitAPI.repositories) {
			if (repo.rootUri.fsPath.includes(workspaceFolder.name)) {
				console.log('Found repository via name match:', repo.rootUri.fsPath);
				return repo;
			}
		}

		console.log('No repository found for workspace:', workspaceFolder.uri.fsPath);
		
		// If still no repository found, wait a bit more and try again
		if (gitAPI.repositories.length === 0) {
			console.log('No repositories available yet, waiting and retrying...');
			await new Promise(resolve => setTimeout(resolve, 500));
			
			if (gitAPI.repositories.length > 0) {
				console.log('Repositories available after wait:', gitAPI.repositories.length);
				const retryRepository = gitAPI.getRepository(workspaceFolder.uri) || 
					gitAPI.repositories.find(repo => 
						workspaceFolder.uri.fsPath.startsWith(repo.rootUri.fsPath) ||
						repo.rootUri.fsPath.startsWith(workspaceFolder.uri.fsPath)
					);
				
				if (retryRepository) {
					console.log('Found repository on retry:', retryRepository.rootUri.fsPath);
					return retryRepository;
				}
			}
		}

		return undefined;
	} catch (error) {
		console.log('Error getting git repository:', error);
		return undefined;
	}
}

// Get remote branches mapping (commit hash -> branch names) using Git API
async function getRemoteBranchMapping(repository: any): Promise<Map<string, string[]>> {
	const remoteBranchMap = new Map<string, string[]>();
	
	try {
		console.log('Getting remote branch mapping via Git API...');
		
		// Check if getBranches method exists
		if (typeof repository.getBranches === 'function') {
			try {
				// Get remote branches
				const remoteBranches = await repository.getBranches({ remote: true, count: 50 });
				
				remoteBranches
					.filter((ref: any) => ref.type === 1 && ref.name && ref.commit) // RefType.RemoteHead = 1
					.forEach((ref: any) => {
						const branchName = ref.name.replace(/^origin\//, ''); // Remove origin/ prefix for display
						const commit = ref.commit;
						
						if (!remoteBranchMap.has(commit)) {
							remoteBranchMap.set(commit, []);
						}
						remoteBranchMap.get(commit)!.push(branchName);
					});

				console.log('Found remote branches via Git API:', remoteBranchMap.size, 'unique commits');
				return remoteBranchMap;
			} catch (branchError) {
				console.log('Error getting remote branches:', branchError);
				return remoteBranchMap;
			}
		} else {
			console.log('getBranches method not available in Git API');
			
			// Alternative approach: try to get refs directly if available
			if (repository.state && repository.state.refs) {
				console.log('Trying to get remote refs from repository state...');
				const refs = repository.state.refs;
				refs
					.filter((ref: any) => ref.name && ref.name.startsWith('refs/remotes/') && ref.commit)
					.forEach((ref: any) => {
						const branchName = ref.name.replace(/^refs\/remotes\/origin\//, '');
						const commit = ref.commit;
						
						if (!remoteBranchMap.has(commit)) {
							remoteBranchMap.set(commit, []);
						}
						remoteBranchMap.get(commit)!.push(branchName);
					});
				
				console.log('Found remote refs from state:', remoteBranchMap.size, 'unique commits');
				return remoteBranchMap;
			}
			
			return remoteBranchMap;
		}
	} catch (error) {
		console.log('Failed to get remote branches via Git API:', error);
		return remoteBranchMap;
	}
}

// Internationalization messages
interface Messages {
    [key: string]: {
        en: string;
        ja: string;
    };
}

const MESSAGES: Messages = {
    // Section titles
    'section.language': {
        en: '🌐 Language Settings',
        ja: '🌐 言語設定'
    },
    'section.gitInfo': {
        en: '🔍 Git Repository Information',
        ja: '🔍 Gitリポジトリ情報'
    },
    'section.diffSettings': {
        en: '📊 Diff Settings',
        ja: '📊 差分設定'
    },
    'section.reviewSettings': {
        en: '⚙️ Default Prompt Settings',
        ja: '⚙️ デフォルトプロンプト設定'
    },
    'section.promptInfo': {
        en: '📝 Prompt Information',
        ja: '📝 プロンプト情報'
    },
    'section.awsConfig': {
        en: '🔐 AWS Bedrock Configuration',
        ja: '🔐 AWS Bedrock設定'
    },
    'section.llmProvider': {
        en: '🤖 LLM Provider',
        ja: '🤖 LLMプロバイダー'
    },
    'section.vscodeLmConfig': {
        en: '🔗 VS Code LM Configuration',
        ja: '🔗 VS Code LM設定'
    },
    // Git info labels
    'git.currentBranch': {
        en: 'Current Branch:',
        ja: '現在のブランチ:'
    },
    'git.latestCommit': {
        en: 'Latest Commit:',
        ja: '最新コミット:'
    },
    'git.status': {
        en: 'Status:',
        ja: 'ステータス:'
    },
    'git.compareCommit': {
        en: 'Compare with Commit:',
        ja: '比較対象コミット:'
    },
    'git.selectCommit': {
        en: 'Select a commit...',
        ja: 'コミットを選択...'
    },
    // Diff settings
    'diff.contextLines': {
        en: 'Context Lines (git diff -U option):',
        ja: 'コンテキスト行数 (git diff -U オプション):'
    },
    'diff.contextLinesDesc': {
        en: 'Number of unchanged lines to show before and after changes (default: 50)',
        ja: '変更箇所の前後に表示する変更されていない行数 (デフォルト: 50)'
    },
    'diff.excludeDeletes': {
        en: 'Exclude deleted files from diff output',
        ja: '削除されたファイルを差分出力から除外'
    },
    'diff.excludeDeletesDesc': {
        en: 'When checked, only added and modified files will be shown in diff output (--diff-filter=AM)',
        ja: 'チェックすると、追加・変更されたファイルのみが差分出力に表示されます (--diff-filter=AM)'
    },
    'diff.fileExtensions': {
        en: 'File Extensions Filter:',
        ja: 'ファイル拡張子フィルター:'
    },
    'diff.fileExtensionsPlaceholder': {
        en: 'e.g., *.js *.ts *.py *.java (space-separated)',
        ja: '例: *.js *.ts *.py *.java (スペース区切り)'
    },
    'diff.fileExtensionsDesc': {
        en: 'Specify file extensions to include in diff output (includes both direct and subdirectory files). Leave empty to include all files. Examples: cs, *.razor, js ts, **/*.py',
        ja: '差分出力に含めるファイル拡張子を指定します（直下とサブディレクトリの両方を含む）。空にするとすべてのファイルが対象になります。例: cs, *.razor, js ts, **/*.py'
    },
    // Default Review settings (for saving)
    'defaultReview.systemPrompt': {
        en: 'Default System Prompt:',
        ja: 'デフォルトシステムプロンプト:'
    },
    'defaultReview.systemPromptPlaceholder': {
        en: 'Enter the default system prompt for code review',
        ja: 'デフォルトのコードレビュー用システムプロンプトを入力'
    },
    'defaultReview.perspective': {
        en: 'Default Review Perspective:',
        ja: 'デフォルトレビュー観点:'
    },
    'defaultReview.perspectivePlaceholder': {
        en: 'Enter the default perspective for code review',
        ja: 'デフォルトのコードレビュー観点を入力'
    },
    // Current Review settings (for execution)
    'review.systemPrompt': {
        en: 'System Prompt:',
        ja: 'システムプロンプト:'
    },
    'review.systemPromptPlaceholder': {
        en: 'Enter the system prompt for code review',
        ja: 'コードレビュー用のシステムプロンプトを入力'
    },
    'review.perspective': {
        en: 'Review Perspective:',
        ja: 'レビュー観点:'
    },
    'review.perspectivePlaceholder': {
        en: 'Enter the perspective for code review',
        ja: 'コードレビューの観点を入力'
    },
    // AWS settings
    'aws.accessKey': {
        en: 'AWS Access Key:',
        ja: 'AWSアクセスキー:'
    },
    'aws.accessKeyPlaceholder': {
        en: 'Enter AWS Access Key',
        ja: 'AWSアクセスキーを入力'
    },
    'aws.secretKey': {
        en: 'AWS Secret Key:',
        ja: 'AWSシークレットキー:'
    },
    'aws.secretKeyPlaceholder': {
        en: 'Enter AWS Secret Key',
        ja: 'AWSシークレットキーを入力'
    },
    'aws.region': {
        en: 'AWS Region:',
        ja: 'AWSリージョン:'
    },
    'aws.modelName': {
        en: 'Model Name:',
        ja: 'モデル名:'
    },
    'aws.modelNamePlaceholder': {
        en: 'e.g., anthropic.claude-3-5-sonnet-20241022-v2:0',
        ja: '例: anthropic.claude-3-5-sonnet-20241022-v2:0'
    },
    'aws.modelNameDesc': {
        en: 'Enter a custom model ID or select from the dropdown list of popular AWS Bedrock models',
        ja: 'カスタムモデルIDを入力するか、主要なAWS Bedrockモデルのドロップダウンリストから選択'
    },
    // LLM Provider settings
    'llm.provider': {
        en: 'LLM Provider:',
        ja: 'LLMプロバイダー:'
    },
    'llm.providerDesc': {
        en: 'Choose between AWS Bedrock or VS Code Language Model API',
        ja: 'AWS BedrockまたはVS Code Language Model APIから選択'
    },
    'vscode.family': {
        en: 'VS Code LM Model:',
        ja: 'VS Code LMモデル:'
    },
    'vscode.familyDesc': {
        en: 'Specify the model available through VS Code LM API',
        ja: 'VS Code LM APIで利用可能なモデルを指定'
    },
    // Buttons
    'button.refresh': {
        en: '🔄 Refresh',
        ja: '🔄 更新'
    },
    'button.save': {
        en: '💾 Save Settings',
        ja: '💾 設定を保存'
    },
    'button.preview': {
        en: '👁️ Preview Diff',
        ja: '👁️ 差分プレビュー'
    },
    'button.review': {
        en: '🚀 Run Code Review',
        ja: '🚀 コードレビュー実行'
    },
    'button.loadDefaults': {
        en: '📥 Load Defaults',
        ja: '📥 デフォルト読み込み'
    },
    // Language selection
    'language.label': {
        en: 'Language / 言語:',
        ja: 'Language / 言語:'
    },
    'language.english': {
        en: 'English',
        ja: 'English'
    },
    'language.japanese': {
        en: '日本語',
        ja: '日本語'
    },
    // Status messages
    'status.loading': {
        en: 'Loading...',
        ja: '読み込み中...'
    },
    'status.commitAlert': {
        en: 'Please select a commit to compare with.',
        ja: '比較対象のコミットを選択してください。'
    }
};

export class SettingsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'diff-lens-settings';
    private _view?: vscode.WebviewView;
    private _currentLanguage: 'en' | 'ja' = 'en';
    private _settingsVisible: boolean = false;

    constructor(private readonly _extensionUri: vscode.Uri) {
        // Load language setting from VS Code configuration
        this._loadLanguageFromConfig();
    }

    private _loadLanguageFromConfig() {
        const config = vscode.workspace.getConfiguration('diffLens');
        const savedLanguage = config.get<string>('interfaceLanguage', 'en');
        
        this._currentLanguage = (savedLanguage === 'ja') ? 'ja' : 'en';
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            message => {
                console.log('Received message from webview:', message.command);
                
                switch (message.command) {
                    case 'changeLanguage':
                        console.log('Processing changeLanguage message');
                        this._currentLanguage = message.language;
                        this._saveLanguageToConfig(message.language);
                        this._updateWebviewContent();
                        return;
                    case 'saveSettings':
                        console.log('Processing saveSettings message');
                        this._saveSettings(message.settings);
                        return;
                    case 'loadSettings':
                        console.log('Processing loadSettings message');
                        this._loadSettings();
                        return;
                    case 'refreshBranchInfo':
                        console.log('Processing refreshBranchInfo message');
                        this._refreshBranchInfo();
                        return;
                    case 'previewDiff':
                        console.log('Processing previewDiff message');
                        vscode.commands.executeCommand('diff-lens.previewDiff', message.selectedCommit);
                        return;
                    case 'runCodeReview':
                        console.log('Processing runCodeReview message');
                        vscode.commands.executeCommand('diff-lens.reviewCode', message.selectedCommit, message.prompts);
                        return;
                    case 'loadVSCodeFamilies':
                        console.log('Processing loadVSCodeFamilies message');
                        this._loadVSCodeFamilies();
                        return;
                    default:
                        console.log('Unknown message command:', message.command);
                }
            },
            undefined,
            []
        );

        // Monitor visibility changes to refresh Git data when webview becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                console.log('Webview became visible, refreshing Git information');
                
                // Use setTimeout to ensure the view is fully rendered before refreshing
                setTimeout(async () => {
                    console.log('Performing delayed Git refresh after visibility change');
                    await this._ensureGitAPIInitialized(3);
                    this._refreshBranchInfo(true);
                    // Force refresh Git API cache to ensure fresh data
                    vscode.commands.executeCommand('diff-lens.refreshGitRepo');
                }, 300);
            }
        });

        // Load initial data with proper initialization timing
        this._loadSettings();
        
        // Delay initial Git data load to ensure Git API is properly initialized
        setTimeout(async () => {
            console.log('Loading initial Git information after delay');
            await this._ensureGitAPIInitialized();
            this._refreshBranchInfo(true); // Force refresh on initial load
        }, 1000);
    }

    private async _saveSettings(settings: any) {
        try {
            const config = vscode.workspace.getConfiguration('diffLens');
            
            console.log('Saving settings:', {
                systemPrompt: settings.systemPrompt ? '***SET***' : 'EMPTY',
                reviewPerspective: settings.reviewPerspective ? '***SET***' : 'EMPTY',
                contextLines: settings.contextLines,
                excludeDeletes: settings.excludeDeletes,
                fileExtensions: settings.fileExtensions,
                llmProvider: settings.llmProvider,
                awsAccessKey: settings.awsAccessKey ? '***SET***' : 'EMPTY',
                awsSecretKey: settings.awsSecretKey ? '***SET***' : 'EMPTY',
                awsRegion: settings.awsRegion,
                modelName: settings.modelName,
                vscodeLmVendor: 'copilot',  // Fixed to copilot
                vscodeLmFamily: settings.vscodeLmFamily
            });
            
            // Also show in VS Code output for easier debugging
            const outputChannel = vscode.window.createOutputChannel('DiffLens Debug');
            outputChannel.appendLine(`[${new Date().toISOString()}] Saving settings:`);
            outputChannel.appendLine(`  System Prompt: ${settings.systemPrompt ? '***SET***' : 'EMPTY'}`);
            outputChannel.appendLine(`  Review Perspective: ${settings.reviewPerspective ? '***SET***' : 'EMPTY'}`);
            outputChannel.appendLine(`  Context Lines: ${settings.contextLines}`);
            outputChannel.appendLine(`  Exclude Deletes: ${settings.excludeDeletes}`);
            outputChannel.appendLine(`  File Extensions: ${settings.fileExtensions}`);
            outputChannel.appendLine(`  LLM Provider: ${settings.llmProvider}`);
            outputChannel.appendLine(`  AWS Access Key: ${settings.awsAccessKey ? '***SET***' : 'EMPTY'}`);
            outputChannel.appendLine(`  AWS Secret Key: ${settings.awsSecretKey ? '***SET***' : 'EMPTY'}`);
            outputChannel.appendLine(`  AWS Region: ${settings.awsRegion}`);
            outputChannel.appendLine(`  Model Name: ${settings.modelName}`);
            outputChannel.appendLine(`  VS Code LM Vendor: ${settings.vscodeLmVendor}`);
            outputChannel.appendLine(`  VS Code LM Family: ${settings.vscodeLmFamily} (SAVING THIS VALUE)`);
            outputChannel.show();
            
            console.log('About to save VS Code LM Family:', settings.vscodeLmFamily);
            console.log('VS Code LM Family type:', typeof settings.vscodeLmFamily);
            console.log('Settings object before save:', JSON.stringify(settings, null, 2));
            
            // Save non-AWS settings to both Global and Workspace targets
            await Promise.all([
                // Global settings (all settings)
                config.update('systemPrompt', settings.systemPrompt, vscode.ConfigurationTarget.Global),
                config.update('reviewPerspective', settings.reviewPerspective, vscode.ConfigurationTarget.Global),
                config.update('contextLines', settings.contextLines, vscode.ConfigurationTarget.Global),
                config.update('excludeDeletes', settings.excludeDeletes, vscode.ConfigurationTarget.Global),
                config.update('fileExtensions', settings.fileExtensions, vscode.ConfigurationTarget.Global),
                config.update('llmProvider', settings.llmProvider, vscode.ConfigurationTarget.Global),
                config.update('awsAccessKey', settings.awsAccessKey, vscode.ConfigurationTarget.Global),
                config.update('awsSecretKey', settings.awsSecretKey, vscode.ConfigurationTarget.Global),
                config.update('awsRegion', settings.awsRegion, vscode.ConfigurationTarget.Global),
                config.update('modelName', settings.modelName, vscode.ConfigurationTarget.Global),
                config.update('vscodeLmVendor', 'copilot', vscode.ConfigurationTarget.Global),
                config.update('vscodeLmFamily', settings.vscodeLmFamily, vscode.ConfigurationTarget.Global),
                
                // Workspace settings (non-AWS settings only, as AWS keys have "scope": "application")
                config.update('systemPrompt', settings.systemPrompt, vscode.ConfigurationTarget.Workspace),
                config.update('reviewPerspective', settings.reviewPerspective, vscode.ConfigurationTarget.Workspace),
                config.update('contextLines', settings.contextLines, vscode.ConfigurationTarget.Workspace),
                config.update('excludeDeletes', settings.excludeDeletes, vscode.ConfigurationTarget.Workspace),
                config.update('fileExtensions', settings.fileExtensions, vscode.ConfigurationTarget.Workspace),
                config.update('llmProvider', settings.llmProvider, vscode.ConfigurationTarget.Workspace),
                config.update('awsRegion', settings.awsRegion, vscode.ConfigurationTarget.Workspace),
                config.update('modelName', settings.modelName, vscode.ConfigurationTarget.Workspace),
                config.update('vscodeLmVendor', 'copilot', vscode.ConfigurationTarget.Workspace),
                config.update('vscodeLmFamily', settings.vscodeLmFamily, vscode.ConfigurationTarget.Workspace)
            ]);

            console.log('Settings saved successfully');
            vscode.window.showInformationMessage('Settings saved successfully!');
            
            // Automatically close settings area after successful save
            this._settingsVisible = false;
            this._updateWebviewContent();
            
            // Verify settings were saved
            setTimeout(() => {
                console.log('Verifying saved settings...');
                const config = vscode.workspace.getConfiguration('diffLens');
                const savedVscodeLmFamily = config.get('vscodeLmFamily');
                console.log('Verified VS Code LM Family in config:', savedVscodeLmFamily);
                console.log('Expected value was:', settings.vscodeLmFamily);
                if (savedVscodeLmFamily !== settings.vscodeLmFamily) {
                    console.error('VS Code LM Family was not saved correctly!');
                } else {
                    console.log('VS Code LM Family was saved correctly');
                }
                this._loadSettings();
            }, 500);
        } catch (error) {
            console.error('Error saving settings:', error);
            vscode.window.showErrorMessage(`Failed to save settings: ${error}`);
        }
    }

    private _loadSettings() {
        if (!this._view) {
            return;
        }

        const config = vscode.workspace.getConfiguration('diffLens');
        
        const settings = {
            systemPrompt: config.get('systemPrompt', ''),
            reviewPerspective: config.get('reviewPerspective', ''),
            contextLines: config.get('contextLines', 50),
            excludeDeletes: config.get('excludeDeletes', true),
            fileExtensions: config.get('fileExtensions', ''),
            llmProvider: config.get('llmProvider', 'bedrock'),
            awsAccessKey: config.get('awsAccessKey', ''),
            awsSecretKey: config.get('awsSecretKey', ''),
            awsRegion: config.get('awsRegion', 'us-east-1'),
            modelName: config.get('modelName', 'anthropic.claude-3-5-sonnet-20241022-v2:0'),
            vscodeLmVendor: config.get('vscodeLmVendor', 'copilot'),
            vscodeLmFamily: config.get('vscodeLmFamily', 'gpt-4o'),
            interfaceLanguage: config.get('interfaceLanguage', 'en')
        };

        console.log('Loading settings from VS Code configuration:', {
            systemPrompt: settings.systemPrompt ? '***SET***' : 'EMPTY',
            reviewPerspective: settings.reviewPerspective ? '***SET***' : 'EMPTY',
            contextLines: settings.contextLines,
            excludeDeletes: settings.excludeDeletes,
            fileExtensions: settings.fileExtensions,
            llmProvider: settings.llmProvider,
            awsAccessKey: settings.awsAccessKey ? '***SET***' : 'EMPTY',
            awsSecretKey: settings.awsSecretKey ? '***SET***' : 'EMPTY',
            awsRegion: settings.awsRegion,
            modelName: settings.modelName,
            vscodeLmVendor: 'copilot',  // Fixed to copilot
            vscodeLmFamily: settings.vscodeLmFamily + ' (LOADED FROM CONFIG)'
        });

        this._view.webview.postMessage({
            command: 'settingsLoaded',
            settings: settings
        });
    }

    private async _refreshBranchInfo(forceRefresh: boolean = false) {
        if (!this._view) {
            return;
        }

        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                this._view.webview.postMessage({
                    command: 'branchInfoUpdated',
                    branchInfo: {
                        error: 'No workspace folder found'
                    }
                });
                return;
            }

            const workspacePath = workspaceFolder.uri.fsPath;
            console.log('Refreshing branch info for workspace:', workspacePath, 'forceRefresh:', forceRefresh);

            // Use VS Code Git API to verify repository and get information
            let gitAPI = await this._getGitAPI(forceRefresh);
            
            // If Git API is not available or has no repositories, try to initialize
            if (!gitAPI || gitAPI.repositories.length === 0) {
                console.log('Git API not ready, attempting to initialize...');
                const initialized = await this._ensureGitAPIInitialized(3);
                if (initialized) {
                    gitAPI = await this._getGitAPI(true);
                }
            }
            
            if (!gitAPI) {
                this._view.webview.postMessage({
                    command: 'branchInfoUpdated',
                    branchInfo: {
                        error: 'Git API not available'
                    }
                });
                return;
            }

            const gitRepo = gitAPI.getRepository(workspaceFolder.uri);
            if (!gitRepo) {
                // Try to find repository in the workspace
                const foundRepository = gitAPI.repositories.find((repo: Repository) => 
                    workspacePath.startsWith(repo.rootUri.fsPath) ||
                    repo.rootUri.fsPath.startsWith(workspacePath)
                );

                if (!foundRepository) {
                    this._view.webview.postMessage({
                        command: 'branchInfoUpdated',
                        branchInfo: {
                            error: 'Not a git repository'
                        }
                    });
                    return;
                }
            }

            const repo = gitRepo || gitAPI.repositories.find((repo: Repository) => 
                workspacePath.startsWith(repo.rootUri.fsPath) ||
                repo.rootUri.fsPath.startsWith(workspacePath)
            );

            if (!repo) {
                this._view.webview.postMessage({
                    command: 'branchInfoUpdated',
                    branchInfo: {
                        error: 'Not a git repository'
                    }
                });
                return;
            }

            console.log('Using Git API repository:', !!repo);
            if (repo) {
                console.log('Repository state:', {
                    hasHEAD: !!repo.state.HEAD,
                    branchName: repo.state.HEAD?.name,
                    commitHash: repo.state.HEAD?.commit
                });
            }

            // Get current branch - always use git command for reliability
            let currentBranch = 'unknown';
            try {
                const { stdout: gitBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath });
                currentBranch = gitBranch.trim();
                console.log('Current branch via git command:', currentBranch);
            } catch (error) {
                console.log('Failed to get current branch via git command:', error);
                // If git command fails, try VS Code API as backup
                if (repo && repo.state.HEAD?.name) {
                    currentBranch = repo.state.HEAD.name;
                    console.log('Current branch via VS Code API:', currentBranch);
                }
            }

            // Get latest commit info - always use git command for reliability
            let latestCommit = '';
            try {
                const { stdout: commitInfo } = await execAsync(
                    'git log -1 --pretty=format:"%cd (%h) %s" --date=format:"%Y-%m-%d %H:%M:%S"', 
                    { cwd: workspacePath }
                );
                latestCommit = commitInfo.trim();
                console.log('Latest commit via git command:', latestCommit.substring(0, 50));
            } catch (error) {
                console.log('Failed to get latest commit via git command:', error);
                // If git command fails, try VS Code API as backup
                if (repo && repo.state.HEAD?.commit) {
                    try {
                        const commit = await repo.getCommit(repo.state.HEAD.commit);
                        const date = commit.authorDate ? commit.authorDate.toISOString().replace('T', ' ').substring(0, 19) : 'unknown';
                        const shortHash = commit.hash.substring(0, 8);
                        const message = commit.message.split('\n')[0];
                        latestCommit = `${date} (${shortHash}) ${message}`;
                        console.log('Latest commit via VS Code API:', latestCommit.substring(0, 50));
                    } catch (apiError) {
                        console.log('Failed to get latest commit via VS Code API:', apiError);
                        latestCommit = 'Unable to get latest commit';
                    }
                } else {
                    latestCommit = 'No commits found';
                }
            }

            // Get commit history using Git API only
            let commitHistory: Array<{hash: string, date: string, message: string, displayText: string}> = [];
            if (repo) {
                try {
                    // Get remote branch mapping first
                    const remoteBranchMap = await getRemoteBranchMapping(repo);
                    
                    const commits = await repo.log({ maxEntries: 20 });
                    commitHistory = commits.map((commit: Commit) => {
                        const date = commit.authorDate ? commit.authorDate.toISOString().replace('T', ' ').substring(0, 19) : 'unknown';
                        const message = commit.message.split('\n')[0].substring(0, 50);
                        const shortHash = commit.hash.substring(0, 8);
                        
                        // Check if this commit is the tip of any remote branches
                        const remoteBranches = remoteBranchMap.get(commit.hash) || [];
                        const remoteBranchText = remoteBranches.length > 0 ? ` [${remoteBranches.join(', ')}]` : '';
                        
                        return {
                            hash: commit.hash,
                            date,
                            message,
                            displayText: `${date} (${shortHash}) ${message}${remoteBranchText}`
                        };
                    }).slice(1); // 最新コミット（インデックス0）を除外
                    console.log('Commit history via Git API:', commitHistory.length, 'commits (excluding latest)');
                } catch (apiError) {
                    console.log('Failed to get commit history via Git API:', apiError);
                }
            } else {
                console.log('No repository available for commit history');
            }

            // Get remote branches using Git API - now only for standalone remote branches (not in commit history)
            let remoteBranches: Array<{name: string, commit: string, displayText: string}> = [];
            // We no longer add remote branches as separate options since they're now integrated into commit history

            // Combine commit history (which now includes remote branch info) 
            const comparisonOptions = [...commitHistory];

            // Get repository status - prefer git command for accuracy
            let status = '';
            try {
                const { stdout: gitStatus } = await execAsync('git status --porcelain', { cwd: workspacePath });
                if (gitStatus.trim()) {
                    const lines = gitStatus.trim().split('\n');
                    status = `${lines.length} uncommitted changes`;
                } else {
                    status = 'Clean working directory';
                }
                console.log('Repository status via git command:', status);
            } catch (error) {
                console.log('Failed to get status via git command:', error);
                // If git command fails, try VS Code API as backup
                if (repo) {
                    try {
                        const changes = await repo.diff();
                        if (changes.length > 0) {
                            status = `${changes.length} uncommitted changes`;
                        } else {
                            status = 'Clean working directory';
                        }
                        console.log('Repository status via VS Code API:', status);
                    } catch (apiError) {
                        console.log('Failed to get status via VS Code API:', apiError);
                        status = 'Unable to get status';
                    }
                } else {
                    status = 'Unable to get status';
                }
            }

            // Add indicator for API type used
            const apiIndicator = repo ? ' (enhanced)' : ' (basic)';

            this._view.webview.postMessage({
                command: 'branchInfoUpdated',
                branchInfo: {
                    currentBranch: currentBranch + apiIndicator,
                    latestCommit: latestCommit,
                    status: status,
                    commitHistory: comparisonOptions
                }
            });

        } catch (error) {
            console.log('Error in _refreshBranchInfo:', error);
            this._view.webview.postMessage({
                command: 'branchInfoUpdated',
                branchInfo: {
                    error: `Error getting branch info: ${error}`
                }
            });
        }
    }

    // Get Git API with caching support  
    private async _getGitAPI(forceRefresh: boolean = false): Promise<GitAPI | undefined> {
        // Use the existing getGitAPI function from the global scope
        return await getGitAPI();
    }

    // Ensure Git API is properly initialized with retry logic
    private async _ensureGitAPIInitialized(maxRetries: number = 5): Promise<boolean> {
        for (let i = 0; i < maxRetries; i++) {
            console.log(`Attempting to initialize Git API (attempt ${i + 1}/${maxRetries})`);
            
            const gitAPI = await this._getGitAPI(true);
            if (gitAPI) {
                // Check if repositories are available
                if (gitAPI.repositories.length > 0) {
                    console.log('Git API initialized successfully with repositories:', gitAPI.repositories.length);
                    return true;
                }
                
                // If no repositories yet, wait and retry
                console.log('Git API available but no repositories found, waiting...');
                await new Promise(resolve => setTimeout(resolve, 500));
            } else {
                console.log('Git API not available, waiting...');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log('Failed to initialize Git API after', maxRetries, 'attempts');
        return false;
    }

    // Force refresh branch info
    public refreshBranchInfo(): void {
        this._refreshBranchInfo(true);
    }

    private _updateWebviewContent() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
            // Reload settings after content update
            setTimeout(() => {
                this._loadSettings();
                this._refreshBranchInfo();
            }, 100);
        }
    }

    private _getMessage(key: string): string {
        return MESSAGES[key]?.[this._currentLanguage] || key;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DiffLens Settings</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 10px;
            margin: 0;
        }
        
        .section {
            margin-bottom: 20px;
            padding: 10px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background: var(--vscode-editor-background);
        }
        
        .section-title {
            font-weight: bold;
            margin-bottom: 10px;
            color: var(--vscode-panelTitle-activeForeground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 5px;
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: var(--vscode-input-foreground);
        }
        
        input[type="text"], input[type="password"], input[type="number"], input[type="checkbox"], textarea, select {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: inherit;
            box-sizing: border-box;
            border-radius: 2px;
        }
        
        input[type="checkbox"] {
            width: auto;
            margin-right: 8px;
        }
        
        #modelName {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }
        
        #contextLines {
            width: 80px;
        }
        
        input[type="text"]:focus, input[type="password"]:focus, input[type="number"]:focus, input[type="checkbox"]:focus, textarea:focus, select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }
        
        textarea {
            min-height: 80px;
            resize: vertical;
            font-family: var(--vscode-editor-font-family);
        }
        
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            font-family: inherit;
            font-size: inherit;
            border-radius: 2px;
            margin-right: 10px;
            margin-bottom: 10px;
        }
        
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        button:active {
            background: var(--vscode-button-activeBackground);
        }
        
        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .info-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            padding: 4px 0;
        }
        
        .info-label {
            font-weight: 500;
            color: var(--vscode-descriptionForeground);
        }
        
        .info-value {
            color: var(--vscode-foreground);
            font-family: var(--vscode-editor-font-family);
        }
        
        .info-value#latestCommitInfo {
            color: var(--vscode-foreground);
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }
        
        .info-value#latestCommitMessage {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            border-radius: 2px;
            font-family: var(--vscode-editor-font-family);
            word-wrap: break-word;
            white-space: pre-wrap;
            margin-top: 5px;
        }
        
        .error {
            color: var(--vscode-errorForeground);
            font-style: italic;
        }
        
        .buttons {
            margin-top: 15px;
        }
    </style>
</head>
<body>
    <!-- Language Settings Section (最上部に追加) -->
    <div class="section" id="settingsSection" style="display: ${this._settingsVisible ? 'block' : 'none'};">
        <div class="section-title">${this._getMessage('section.language')}</div>
        <div class="form-group">
            <label for="interfaceLanguage">${this._getMessage('language.label')}</label>
            <select id="interfaceLanguage" onchange="changeLanguage()">
                <option value="en" ${this._currentLanguage === 'en' ? 'selected' : ''}>${this._getMessage('language.english')}</option>
                <option value="ja" ${this._currentLanguage === 'ja' ? 'selected' : ''}>${this._getMessage('language.japanese')}</option>
            </select>
        </div>
        
        <!-- Diff Settings Section -->
        <div class="section-title">${this._getMessage('section.diffSettings')}</div>
        
        <div class="form-group">
            <label for="contextLines">${this._getMessage('diff.contextLines')}</label>
            <input type="number" id="contextLines" min="0" max="100" placeholder="50">
            <small style="color: var(--vscode-descriptionForeground); display: block; margin-top: 5px;">
                ${this._getMessage('diff.contextLinesDesc')}
            </small>
        </div>
        
        <div class="form-group">
            <label>
                <input type="checkbox" id="excludeDeletes" checked>
                ${this._getMessage('diff.excludeDeletes')}
            </label>
            <small style="color: var(--vscode-descriptionForeground); display: block; margin-top: 5px;">
                ${this._getMessage('diff.excludeDeletesDesc')}
            </small>
        </div>
        
        <div class="form-group">
            <label for="fileExtensions">${this._getMessage('diff.fileExtensions')}</label>
            <input type="text" id="fileExtensions" placeholder="${this._getMessage('diff.fileExtensionsPlaceholder')}">
            <small style="color: var(--vscode-descriptionForeground); display: block; margin-top: 5px;">
                ${this._getMessage('diff.fileExtensionsDesc')}
            </small>
        </div>

        <!-- Default Prompt Settings Section -->
        <div class="section-title">${this._getMessage('section.reviewSettings')}</div>
        
        <div class="form-group">
            <label for="defaultSystemPrompt">${this._getMessage('defaultReview.systemPrompt')}</label>
            <textarea id="defaultSystemPrompt" placeholder="${this._getMessage('defaultReview.systemPromptPlaceholder')}"></textarea>
        </div>
        
        <div class="form-group">
            <label for="defaultReviewPerspective">${this._getMessage('defaultReview.perspective')}</label>
            <textarea id="defaultReviewPerspective" placeholder="${this._getMessage('defaultReview.perspectivePlaceholder')}"></textarea>
        </div>

        <!-- LLM Provider Selection -->
        <div class="section-title">${this._getMessage('section.llmProvider')}</div>
        
        <div class="form-group">
            <label for="llmProvider">${this._getMessage('llm.provider')}</label>
            <select id="llmProvider" onchange="toggleProviderSettings()">
                <option value="bedrock">AWS Bedrock</option>
                <option value="vscode-lm">VS Code Language Model API</option>
            </select>
            <small class="help-text">${this._getMessage('llm.providerDesc')}</small>
        </div>

        <!-- AWS Configuration Section -->
        <div id="bedrockConfig" class="section-title">${this._getMessage('section.awsConfig')}</div>
        
        <div id="bedrockFields">
            <div class="form-group">
                <label for="awsAccessKey">${this._getMessage('aws.accessKey')}</label>
                <input type="password" id="awsAccessKey" placeholder="${this._getMessage('aws.accessKeyPlaceholder')}">
            </div>
            
            <div class="form-group">
                <label for="awsSecretKey">${this._getMessage('aws.secretKey')}</label>
                <input type="password" id="awsSecretKey" placeholder="${this._getMessage('aws.secretKeyPlaceholder')}">
            </div>
            
            <div class="form-group">
                <label for="awsRegion">${this._getMessage('aws.region')}</label>
                <select id="awsRegion">
                <option value="us-east-1">US East (N. Virginia) - us-east-1</option>
                <option value="us-west-2">US West (Oregon) - us-west-2</option>
                <option value="us-west-1">US West (N. California) - us-west-1</option>
                <option value="eu-west-1">Europe (Ireland) - eu-west-1</option>
                <option value="eu-west-2">Europe (London) - eu-west-2</option>
                <option value="eu-west-3">Europe (Paris) - eu-west-3</option>
                <option value="eu-central-1">Europe (Frankfurt) - eu-central-1</option>
                <option value="eu-north-1">Europe (Stockholm) - eu-north-1</option>
                <option value="ap-northeast-1">Asia Pacific (Tokyo) - ap-northeast-1</option>
                <option value="ap-northeast-2">Asia Pacific (Seoul) - ap-northeast-2</option>
                <option value="ap-northeast-3">Asia Pacific (Osaka) - ap-northeast-3</option>
                <option value="ap-southeast-1">Asia Pacific (Singapore) - ap-southeast-1</option>
                <option value="ap-southeast-2">Asia Pacific (Sydney) - ap-southeast-2</option>
                <option value="ap-south-1">Asia Pacific (Mumbai) - ap-south-1</option>
                <option value="ca-central-1">Canada (Central) - ca-central-1</option>
                <option value="sa-east-1">South America (São Paulo) - sa-east-1</option>
            </select>
        </div>
        
        <div class="form-group">
            <label for="modelName">${this._getMessage('aws.modelName')}</label>
            <input type="text" id="modelName" list="modelNameOptions" placeholder="${this._getMessage('aws.modelNamePlaceholder')}">
            <datalist id="modelNameOptions">
                <!-- Claude Models (Latest) -->
                <option value="anthropic.claude-3-5-sonnet-20241022-v2:0">Claude 3.5 Sonnet v2 (Latest)</option>
                <option value="anthropic.claude-3-5-sonnet-20240620-v1:0">Claude 3.5 Sonnet</option>
                <option value="anthropic.claude-3-sonnet-20240229-v1:0">Claude 3 Sonnet</option>
                <option value="anthropic.claude-3-haiku-20240307-v1:0">Claude 3 Haiku</option>
                <option value="anthropic.claude-3-opus-20240229-v1:0">Claude 3 Opus</option>
                <option value="anthropic.claude-v2:1">Claude v2.1</option>
                <option value="anthropic.claude-v2">Claude v2</option>
                <option value="anthropic.claude-instant-v1">Claude Instant v1</option>
                
                <!-- Amazon Titan Models -->
                <option value="amazon.titan-text-premier-v1:0">Titan Text Premier</option>
                <option value="amazon.titan-text-express-v1">Titan Text Express</option>
                <option value="amazon.titan-text-lite-v1">Titan Text Lite</option>
                
                <!-- Meta Llama Models (Latest) -->
                <option value="meta.llama3-2-90b-instruct-v1:0">Llama 3.2 90B Instruct</option>
                <option value="meta.llama3-2-11b-instruct-v1:0">Llama 3.2 11B Instruct</option>
                <option value="meta.llama3-1-70b-instruct-v1:0">Llama 3.1 70B Instruct</option>
                <option value="meta.llama3-1-8b-instruct-v1:0">Llama 3.1 8B Instruct</option>
                <option value="meta.llama3-70b-instruct-v1:0">Llama 3 70B Instruct</option>
                <option value="meta.llama3-8b-instruct-v1:0">Llama 3 8B Instruct</option>
                
                <!-- Mistral Models -->
                <option value="mistral.mistral-large-2407-v1:0">Mistral Large 2407</option>
                <option value="mistral.mistral-large-2402-v1:0">Mistral Large 2402</option>
                <option value="mistral.mistral-small-2402-v1:0">Mistral Small 2402</option>
            </datalist>
            <small style="color: var(--vscode-descriptionForeground); display: block; margin-top: 5px;">
                ${this._getMessage('aws.modelNameDesc')}
            </small>
        </div>
        </div>

        <!-- VS Code LM Configuration Section -->
        <div id="vscodeLmConfig" style="display: none;">
            <div class="section-title">${this._getMessage('section.vscodeLmConfig')}</div>
            
            <div class="form-group">
                <label for="vscodeLmFamily">${this._getMessage('vscode.family')}</label>
                <select id="vscodeLmFamily">
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4">GPT-4</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                    <option value="claude-3-haiku">Claude 3 Haiku</option>
                    <option value="claude-3-opus">Claude 3 Opus</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                </select>

                <small style="color: var(--vscode-descriptionForeground); display: block; margin-top: 5px;">
                    ${this._getMessage('vscode.familyDesc')}
                </small>
            </div>
        </div>

        <div class="buttons">
            <button onclick="saveSettings()">${this._getMessage('button.save')}</button>
        </div>
    </div>

    <div class="section" style="display: ${this._settingsVisible ? 'none' : 'block'};">
        <div class="section-title">${this._getMessage('section.gitInfo')}</div>
        <div id="branchInfo">
            <div class="info-item">
                <span class="info-label">${this._getMessage('git.currentBranch')}</span>
                <span class="info-value" id="currentBranch">${this._getMessage('status.loading')}</span>
            </div>
            <div class="info-item">
                <span class="info-label">${this._getMessage('git.latestCommit')}</span>
                <span class="info-value" id="latestCommitInfo">${this._getMessage('status.loading')}</span>
            </div>
            <div class="form-group">
                <div class="info-value" id="latestCommitMessage">${this._getMessage('status.loading')}</div>
            </div>
            <div class="info-item">
                <span class="info-label">${this._getMessage('git.status')}</span>
                <span class="info-value" id="repoStatus">${this._getMessage('status.loading')}</span>
            </div>
        </div>
        <div class="form-group">
            <label for="compareCommit">${this._getMessage('git.compareCommit')}</label>
            <select id="compareCommit">
                <option value="">${this._getMessage('git.selectCommit')}</option>
            </select>
        </div>
        <div class="buttons">
            <button class="secondary" onclick="refreshBranchInfo()">${this._getMessage('button.refresh')}</button>
            <button class="secondary" onclick="previewDiff()">${this._getMessage('button.preview')}</button>
        </div>
    </div>

    <div class="section" style="display: ${this._settingsVisible ? 'none' : 'block'};">
        <div class="section-title">${this._getMessage('section.promptInfo')}</div>
        
        <div class="form-group">
            <label for="currentSystemPrompt">${this._getMessage('review.systemPrompt')}</label>
            <textarea id="currentSystemPrompt" placeholder="${this._getMessage('review.systemPromptPlaceholder')}"></textarea>
        </div>
        
        <div class="form-group">
            <label for="currentReviewPerspective">${this._getMessage('review.perspective')}</label>
            <textarea id="currentReviewPerspective" placeholder="${this._getMessage('review.perspectivePlaceholder')}"></textarea>
        </div>
        
        <div class="buttons">
            <button onclick="runCodeReview()">${this._getMessage('button.review')}</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // 言語切り替え関数
        function changeLanguage() {
            const language = document.getElementById('interfaceLanguage').value;
            console.log('Language changed to:', language);
            vscode.postMessage({
                command: 'changeLanguage',
                language: language
            });
        }

        function saveSettings() {
            const settings = {
                systemPrompt: document.getElementById('defaultSystemPrompt').value,
                reviewPerspective: document.getElementById('defaultReviewPerspective').value,
                contextLines: parseInt(document.getElementById('contextLines').value) || 50,
                excludeDeletes: document.getElementById('excludeDeletes').checked,
                fileExtensions: document.getElementById('fileExtensions').value,
                llmProvider: document.getElementById('llmProvider').value,
                awsAccessKey: document.getElementById('awsAccessKey').value,
                awsSecretKey: document.getElementById('awsSecretKey').value,
                awsRegion: document.getElementById('awsRegion').value,
                modelName: document.getElementById('modelName').value,
                vscodeLmVendor: 'copilot',  // Fixed to copilot
                vscodeLmFamily: document.getElementById('vscodeLmFamily').value
            };

            // Debug log in webview
            const vscodeLmFamilyElement = document.getElementById('vscodeLmFamily');
            console.log('VS Code LM Family element:', vscodeLmFamilyElement);
            console.log('VS Code LM Family element value:', vscodeLmFamilyElement.value);
            console.log('VS Code LM Family element data-saved-value:', vscodeLmFamilyElement.getAttribute('data-saved-value'));
            console.log('JavaScript saveSettings called with VS Code LM Family:', settings.vscodeLmFamily);
            console.log('JavaScript saveSettings called with:', {
                systemPrompt: settings.systemPrompt ? '***SET***' : 'EMPTY',
                reviewPerspective: settings.reviewPerspective ? '***SET***' : 'EMPTY',
                contextLines: settings.contextLines,
                excludeDeletes: settings.excludeDeletes,
                fileExtensions: settings.fileExtensions,
                llmProvider: settings.llmProvider,
                awsAccessKey: settings.awsAccessKey ? '***SET***' : 'EMPTY',
                awsSecretKey: settings.awsSecretKey ? '***SET***' : 'EMPTY',
                awsRegion: settings.awsRegion,
                modelName: settings.modelName,
                vscodeLmVendor: 'copilot',  // Fixed to copilot
                vscodeLmFamily: settings.vscodeLmFamily
            });

            vscode.postMessage({
                command: 'saveSettings',
                settings: settings
            });
            
            console.log('Message posted to vscode extension');
        }

        function toggleProviderSettings() {
            const provider = document.getElementById('llmProvider').value;
            const bedrockConfig = document.getElementById('bedrockConfig');
            const bedrockFields = document.getElementById('bedrockFields');
            const vscodeLmConfig = document.getElementById('vscodeLmConfig');
            
            if (provider === 'bedrock') {
                bedrockConfig.style.display = 'block';
                bedrockFields.style.display = 'block';
                vscodeLmConfig.style.display = 'none';
            } else if (provider === 'vscode-lm') {
                bedrockConfig.style.display = 'none';
                bedrockFields.style.display = 'none';
                vscodeLmConfig.style.display = 'block';
                
                // Auto-refresh VS Code LM families when switching to vscode-lm provider
                setTimeout(() => {
                    loadVSCodeFamilies();
                }, 100);
            }
        }

        function previewDiff() {
            const selectedCommit = document.getElementById('compareCommit').value;
            vscode.postMessage({
                command: 'previewDiff',
                selectedCommit: selectedCommit || null
            });
        }

        function runCodeReview() {
            const selectedCommit = document.getElementById('compareCommit').value;
            const prompts = {
                systemPrompt: document.getElementById('currentSystemPrompt').value,
                reviewPerspective: document.getElementById('currentReviewPerspective').value
            };

            vscode.postMessage({
                command: 'runCodeReview',
                selectedCommit: selectedCommit || null,
                prompts: prompts
            });
        }

        // Message handling for responses from extension
        let messageHandlers = new Map();

        function sendMessageToExtension(command, data = {}) {
            return new Promise((resolve, reject) => {
                const messageId = Date.now() + Math.random();
                messageHandlers.set(messageId, { resolve, reject });
                
                vscode.postMessage({
                    command: command,
                    messageId: messageId,
                    ...data
                });
                
                // Timeout after 10 seconds
                setTimeout(() => {
                    if (messageHandlers.has(messageId)) {
                        messageHandlers.delete(messageId);
                        reject(new Error('Request timeout'));
                    }
                }, 10000);
            });
        }

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'settingsLoaded':
                    loadSettings(message.settings);
                    break;
                case 'branchInfoUpdated':
                    updateBranchInfo(message.branchInfo);
                    break;
                case 'vsCodeFamiliesLoaded':
                    // Handle VS Code families loaded
                    console.log('VS Code families loaded:', message.families);
                    const vscodeLmFamilySelect = document.getElementById('vscodeLmFamily');
                    
                    // Store the current value from multiple sources (current value, data attribute, or default)
                    const currentValue = vscodeLmFamilySelect.value || 
                                       vscodeLmFamilySelect.getAttribute('data-saved-value') || 
                                       'gpt-4o';
                    console.log('Current VS Code LM family value before update:', currentValue);
                    console.log('Select element current value:', vscodeLmFamilySelect.value);
                    console.log('Data attribute value:', vscodeLmFamilySelect.getAttribute('data-saved-value'));
                    
                    // Clear existing options
                    vscodeLmFamilySelect.innerHTML = '';
                    
                    if (message.families && message.families.length > 0) {
                        // Add all available families
                        message.families.forEach(family => {
                            const option = document.createElement('option');
                            option.value = family;
                            option.textContent = family;
                            vscodeLmFamilySelect.appendChild(option);
                        });
                        
                        // Try to restore the previous value
                        let valueToSet = currentValue;
                        if (!message.families.includes(currentValue)) {
                            // If current value is not available, use the first family or default to gpt-4o
                            valueToSet = message.families.includes('gpt-4o') ? 'gpt-4o' : message.families[0];
                            console.log('Current value not in families, falling back to:', valueToSet);
                        }
                        
                        // Set the value and verify it was set correctly
                        vscodeLmFamilySelect.value = valueToSet;
                        
                        // Force update if value didn't stick
                        if (vscodeLmFamilySelect.value !== valueToSet) {
                            setTimeout(() => {
                                vscodeLmFamilySelect.value = valueToSet;
                                console.log('Force-set VS Code LM family value:', valueToSet);
                            }, 10);
                        }
                        
                        console.log('Successfully restored VS Code LM family value:', valueToSet);
                    } else {
                        // No families available
                        const option = document.createElement('option');
                        option.value = 'gpt-4o';
                        option.textContent = 'gpt-4o (fallback)';
                        vscodeLmFamilySelect.appendChild(option);
                        vscodeLmFamilySelect.value = 'gpt-4o';
                        console.log('No families found, using fallback: gpt-4o');
                    }
                    
                    // Keep the data attribute for debugging
                    console.log('Final VS Code LM family value after update:', vscodeLmFamilySelect.value);
                    break;
            }
        });

        function loadSettings(settings) {
            // Load default prompt settings (for saving)
            document.getElementById('defaultSystemPrompt').value = settings.systemPrompt || '';
            document.getElementById('defaultReviewPerspective').value = settings.reviewPerspective || '';
            
            // Load current prompt information (for execution) - use defaults as initial values
            document.getElementById('currentSystemPrompt').value = settings.systemPrompt || '';
            document.getElementById('currentReviewPerspective').value = settings.reviewPerspective || '';
            
            // Load other settings
            document.getElementById('contextLines').value = settings.contextLines || 50;
            document.getElementById('excludeDeletes').checked = settings.excludeDeletes !== undefined ? settings.excludeDeletes : true;
            document.getElementById('fileExtensions').value = settings.fileExtensions || '';
            
            // Load LLM provider settings
            document.getElementById('llmProvider').value = settings.llmProvider || 'bedrock';
            document.getElementById('awsAccessKey').value = settings.awsAccessKey || '';
            document.getElementById('awsSecretKey').value = settings.awsSecretKey || '';
            document.getElementById('awsRegion').value = settings.awsRegion || 'us-east-1';
            document.getElementById('modelName').value = settings.modelName || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
            
            // Store the VS Code LM family value to restore after families are loaded
            const savedVscodeLmFamily = settings.vscodeLmFamily || 'gpt-4o';
            console.log('Setting VS Code LM family from saved settings:', savedVscodeLmFamily);
            console.log('Full settings object:', JSON.stringify(settings, null, 2));
            
            // Set the initial value in the select element
            const vscodeLmFamilySelect = document.getElementById('vscodeLmFamily');
            vscodeLmFamilySelect.value = savedVscodeLmFamily;
            
            // Store the value as a data attribute for later restoration
            vscodeLmFamilySelect.setAttribute('data-saved-value', savedVscodeLmFamily);
            console.log('Set data-saved-value attribute to:', savedVscodeLmFamily);
            
            // Double-check the value was set
            if (vscodeLmFamilySelect.value !== savedVscodeLmFamily) {
                console.warn('Select value did not stick, will rely on data attribute for restoration');
            }
            
            // Load language setting
            const interfaceLanguageSelect = document.getElementById('interfaceLanguage');
            if (settings.interfaceLanguage) {
                interfaceLanguageSelect.value = settings.interfaceLanguage;
            }
            
            // Update provider-specific UI visibility
            toggleProviderSettings();
            
            // Load VS Code families if the provider is set to vscode-lm
            if (settings.llmProvider === 'vscode-lm') {
                console.log('Provider is vscode-lm, loading families...');
                loadVSCodeFamilies();
            } else {
                console.log('Provider is not vscode-lm (' + settings.llmProvider + '), skipping family load');
            }
        }

        function updateBranchInfo(branchInfo) {
            if (branchInfo.error) {
                document.getElementById('currentBranch').innerHTML = '<span class="error">' + branchInfo.error + '</span>';
                document.getElementById('latestCommitInfo').innerHTML = '<span class="error">-</span>';
                document.getElementById('latestCommitMessage').innerHTML = '<span class="error">-</span>';
                document.getElementById('repoStatus').innerHTML = '<span class="error">-</span>';
                
                // Clear commit dropdown
                const commitSelect = document.getElementById('compareCommit');
                commitSelect.innerHTML = '<option value="">Error loading commits</option>';
            } else {
                document.getElementById('currentBranch').textContent = branchInfo.currentBranch || '-';
                
                // Parse latest commit info to separate date/hash from message
                const latestCommit = branchInfo.latestCommit || '-';
                if (latestCommit !== '-' && latestCommit !== 'Unable to get latest commit') {
                    // Extract date and hash (everything before the last closing parenthesis)
                    const lastParenIndex = latestCommit.lastIndexOf(')');
                    if (lastParenIndex !== -1) {
                        const dateAndHash = latestCommit.substring(0, lastParenIndex + 1);
                        const message = latestCommit.substring(lastParenIndex + 1).trim();
                        
                        document.getElementById('latestCommitInfo').textContent = dateAndHash;
                        document.getElementById('latestCommitMessage').textContent = message || '(No commit message)';
                    } else {
                        document.getElementById('latestCommitInfo').textContent = latestCommit;
                        document.getElementById('latestCommitMessage').textContent = '';
                    }
                } else {
                    document.getElementById('latestCommitInfo').textContent = latestCommit;
                    document.getElementById('latestCommitMessage').textContent = '';
                }
                
                document.getElementById('repoStatus').textContent = branchInfo.status || '-';
                
                // Update commit dropdown
                const commitSelect = document.getElementById('compareCommit');
                commitSelect.innerHTML = '<option value="">${this._getMessage('git.selectCommit')}</option>';
                
                if (branchInfo.commitHistory && branchInfo.commitHistory.length > 0) {
                    branchInfo.commitHistory.forEach(commit => {
                        const option = document.createElement('option');
                        option.value = commit.hash;
                        option.textContent = commit.displayText;
                        commitSelect.appendChild(option);
                    });
                }
            }
        }

        // Function to load VS Code LM families from the extension
        function loadVSCodeFamilies() {
            console.log('loadVSCodeFamilies called from WebView');
            vscode.postMessage({
                command: 'loadVSCodeFamilies'
            });
        }

        // Add change event listener for VS Code LM Family select
        document.addEventListener('DOMContentLoaded', function() {
            console.log('WebView DOM loaded');
            
            const vscodeLmFamilySelect = document.getElementById('vscodeLmFamily');
            if (vscodeLmFamilySelect) {
                vscodeLmFamilySelect.addEventListener('change', function() {
                    console.log('VS Code LM Family changed to:', this.value);
                    // Update the data attribute to keep track of user changes
                    this.setAttribute('data-saved-value', this.value);
                });
            }
            
            // Request Git branch info refresh after DOM is loaded
            setTimeout(function() {
                console.log('Requesting Git branch info refresh from WebView');
                vscode.postMessage({ command: 'refreshBranchInfo' });
            }, 1000);
        });

        // Load settings on startup
        vscode.postMessage({ command: 'loadSettings' });
    </script>
</body>
</html>`;
    }

    private async _saveLanguageToConfig(language: 'en' | 'ja') {
        try {
            const config = vscode.workspace.getConfiguration('diffLens');
            await Promise.all([
                config.update('interfaceLanguage', language, vscode.ConfigurationTarget.Global),
                config.update('interfaceLanguage', language, vscode.ConfigurationTarget.Workspace)
            ]);
            console.log(`Language setting saved: ${language}`);
        } catch (error) {
            console.error('Error saving language setting:', error);
        }
    }

    private async _loadVSCodeFamilies() {
        console.log('_loadVSCodeFamilies called');
        try {
            const families = await vscode.commands.executeCommand('diff-lens.getVSCodeFamilies');
            console.log('VS Code families retrieved from command:', families);
            this._view?.webview.postMessage({
                command: 'vsCodeFamiliesLoaded',
                families: families
            });
            console.log('vsCodeFamiliesLoaded message sent to webview');
        } catch (error) {
            console.error('Error loading VS Code families:', error);
            this._view?.webview.postMessage({
                command: 'vsCodeFamiliesLoaded',
                error: error
            });
        }
    }

    public toggleSettingsVisibility() {
        this._settingsVisible = !this._settingsVisible;
        this._updateWebviewContent();
    }
}
