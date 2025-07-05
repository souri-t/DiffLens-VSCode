import * as vscode from 'vscode';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { ReviewConfig, ReviewResult } from './types';
import { formatDiffAsMarkdown } from './diffService';

// Send diff to AWS Bedrock for review
export async function reviewWithBedrock(diff: string, config: ReviewConfig): Promise<ReviewResult> {
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
export async function reviewWithVSCodeLM(diff: string, config: ReviewConfig): Promise<ReviewResult> {
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
export async function reviewWithLLM(diff: string, config: ReviewConfig): Promise<ReviewResult> {
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
export async function showReviewResults(reviewResult: ReviewResult): Promise<void> {
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
