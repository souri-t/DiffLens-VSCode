import * as vscode from 'vscode';
import { ReviewConfig } from './types';

// Get configuration from VS Code settings
export function getConfiguration(): ReviewConfig {
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

// Validate configuration
export function validateConfiguration(config: ReviewConfig): string[] {
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
export async function getAvailableVSCodeLMFamilies(): Promise<string[]> {
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
