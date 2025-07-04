# Copilot Instructions

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

This is a VS Code extension project. Please use the get_vscode_api with a query as input to fetch the latest VS Code API references.

## Project Context
This extension performs git diff code review using AWS Bedrock. The extension:
- Detects git repositories in the current workspace
- Gets diff from the current branch to its origin branch
- Sends the diff to AWS Bedrock for code review
- Displays the review results in VS Code

## Key Features
- Configurable system prompts and review perspectives
- AWS Bedrock integration with configurable credentials
- Git integration for diff extraction
- User-friendly configuration through VS Code settings

## Dependencies
- AWS SDK for Bedrock Runtime
- Child process for git commands
- VS Code extension APIs for configuration and commands
