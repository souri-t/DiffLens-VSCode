Language: [English](./README.md) / [Japanese](./README_ja.md)

# DiffLens for VSCode

AI-powered git diff code review using AWS Bedrock or VS Code Language Mod9. **Execute Review**:
   - Click "👁️ Preview Diff" to see the changes that will be reviewed
   - Click "🚀 Run Code Review" to send the diff to your chosen AI provider for analysis
   - Review results will be displayed in a new document

### Method 2: Command Palette

1. **Configure Settings**:
   - Open VS Code settings (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux)
   - Search for "DiffLens" and configure the settings

2. **Run Review**:
   - Open Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux)
   - Run "Review Code with AI" command
   - The extension will analyze the git diff and display AI-powered review resultsures

This VS Code extension provides intelligent code review of your git changes using AI models. Key features include:

- **Multiple LLM Providers**: Choose between AWS Bedrock or VS Code Language Model API
- **Intuitive Sidebar UI**: Easy access via dedicated activity bar icon with settings toggle
- **Multi-language Support**: Interface available in English and Japanese with instant switching
- **Flexible Commit Comparison**: Compare any two commits or branches
- **Customizable Diff Settings**: Configure context lines and filter options
- **Advanced AI Configuration**: Multiple regions, models, and provider options
- **Real-time Preview**: View diff before sending for review
- **Dual Prompt Configuration**: Separate default prompt settings and execution-time prompt information
- **Settings Management**: Collapsible settings area with auto-close after successful save
- **View Switching**: Clean interface that shows either settings or main functionality

## Requirements

- VS Code 1.101.0 or higher
- VS Code Git extension (usually enabled by default)
- Git repository in your workspace
- One of the following AI providers:
  - **AWS Bedrock**: Requires AWS account with Bedrock access and credentials
  - **VS Code LM API**: Requires GitHub Copilot subscription or compatible VS Code LM provider

**Note**: This extension uses VS Code's Git API, so it can work even without Git installed on your system. However, the VS Code Git extension must be enabled.

## Extension Settings

This extension provides comprehensive settings through both sidebar UI and VS Code settings:

### Core Settings
* `diffLens.systemPrompt`: System prompt sent to AI model
* `diffLens.reviewPerspective`: Review perspective/criteria for code analysis
* `diffLens.interfaceLanguage`: Interface language (English/Japanese)

### LLM Provider Selection
* `diffLens.llmProvider`: Choose between 'bedrock' or 'vscode-lm'

### AWS Bedrock Configuration (when provider is 'bedrock')
* `diffLens.awsAccessKey`: AWS Access Key ID for Bedrock access
* `diffLens.awsSecretKey`: AWS Secret Access Key for Bedrock access
* `diffLens.awsRegion`: AWS region for Bedrock service
* `diffLens.modelName`: Bedrock model name for code review

### VS Code LM Configuration (when provider is 'vscode-lm')
* `diffLens.vscodeLmVendor`: VS Code LM vendor (e.g., 'copilot')
* `diffLens.vscodeLmFamily`: VS Code LM model family (e.g., 'gpt-4o', 'gpt-3.5-turbo')

### Diff Configuration
* `diffLens.contextLines`: Number of context lines in diff (default: 50)
* `diffLens.excludeDeletes`: Exclude deleted files from diff analysis
* `diffLens.fileExtensions`: File extensions to include in diff (e.g., '*.js *.ts *.py')

## Usage

### Method 1: Sidebar UI (Recommended)

1. **Access the Extension**:
   - Click the "DiffLens" icon (🔍) in the VS Code activity bar
   - The sidebar panel will open showing Git Repository Information and Prompt Information

2. **Settings Configuration**:
   - Click the settings icon (⚙️) in the toolbar to open the settings area
   - When settings are open, the main view (Git info and Prompt info) is hidden for a clean interface

3. **Configure Language**:
   - In the settings area, select your preferred interface language from the dropdown
   - Choose between English and Japanese for instant interface switching

4. **Configure AWS Bedrock Settings**:
   - Enter your AWS Access Key and Secret Key
   - Select your AWS Region from the dropdown
   - Choose a Bedrock model from the suggestions or enter a custom model name

5. **Configure Default Prompt Settings**:
   - Set your default System Prompt for code review
   - Set your default Review Perspective/criteria
   - These settings are saved and used as templates

6. **Configure Diff Settings**:
   - Set the number of context lines (default: 50)
   - Optionally exclude deleted files from analysis
   - Click "💾 Save Settings" - the settings area will automatically close after successful save

7. **Main Workflow**:
   - After settings are saved, you'll see the main interface with Git Repository Information and Prompt Information
   - View the current branch, latest commit, and repository status
   - Choose a comparison commit from the dropdown (shows recent commits)

8. **Prompt Management**:
   - In the "Prompt Information" section, you can edit prompts for the current review execution
   - Click "📥 Load Defaults" to copy your saved default prompts to the execution fields
   - Modify prompts as needed for specific reviews

9. **Execute Review**:
   - Click "👁️ Preview Diff" to see the changes that will be reviewed
   - Click "� Run Code Review" to send the diff to AWS Bedrock for analysis using current prompt information
   - Review results will be displayed in a new document

### Method 2: Command Palette

1. **Configure Settings**:
   - Open VS Code settings (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux)
   - Search for "DiffLens" and configure the settings

2. **Run Review**:
   - Open Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux)
   - Run "Review Code with Bedrock" command
   - The extension will analyze the git diff and display AI-powered review results

## Interface Languages

The extension supports two interface languages with instant switching:

- **English**: Default interface language
- **Japanese**: Complete Japanese localization including all UI elements, messages, and labels

Language can be changed in the settings area and the interface will update immediately without requiring a restart. The language preference is saved and persists across VS Code sessions.

## AWS Bedrock Configuration

### Available Regions
AWS Bedrock is available in the following regions:
- us-east-1 (N. Virginia)
- us-west-2 (Oregon)
- eu-west-1 (Ireland)
- ap-southeast-1 (Singapore)
- ap-northeast-1 (Tokyo)
- And more...

Note: Available regions may be updated by AWS. Please check the official AWS Bedrock documentation for the latest information.

### Available Model Examples
Examples of major models available on AWS Bedrock:
- Claude 3.5 Sonnet v2: `anthropic.claude-3-5-sonnet-20241022-v2:0` (Latest)
- Claude 3.5 Sonnet: `anthropic.claude-3-5-sonnet-20240620-v1:0`
- Claude 3 Haiku: `anthropic.claude-3-haiku-20240307-v1:0`
- Claude 3 Sonnet: `anthropic.claude-3-sonnet-20240229-v1:0`
- Claude 3 Opus: `anthropic.claude-3-opus-20240229-v1:0`
- Titan Text Premier: `amazon.titan-text-premier-v1:0`
- Llama 3.2 90B Instruct: `meta.llama3-2-90b-instruct-v1:0`
- Mistral Large 2407: `mistral.mistral-large-2407-v1:0`
- And other available Bedrock models

Note: Model availability varies by region. Please verify that your chosen model is available in your selected region before use.

## Prompt Configuration Workflow

The extension uses a dual-prompt system for maximum flexibility:

### Default Prompt Settings
- Saved in VS Code settings as templates
- Configured once in the settings area
- Used as the basis for all reviews
- Includes default System Prompt and Review Perspective

### Prompt Information (Execution-time)
- Displayed in the main interface for each review
- Can be modified for specific reviews
- Click "📥 Load Defaults" to copy from saved settings
- Used directly when executing "🚀 Run Code Review"

This workflow allows you to maintain consistent default prompts while having the flexibility to customize prompts for specific reviews.

## Diff Configuration Options

### Context Lines
Controls how many lines of context are included around each change in the diff. Higher values provide more context but result in larger diffs.

### Exclude Deleted Files
When enabled, files that are completely deleted will be excluded from the diff analysis. This can be useful when focusing on code improvements rather than removals.

### File Extensions Filter
Specify which file types to include in the diff analysis. The filter automatically includes files from both the root directory and all subdirectories. For example:
- `cs` or `*.cs` - Include C# files from root and all subdirectories
- `razor` or `*.razor` - Include Razor files from root and all subdirectories  
- `js ts` - Include both JavaScript and TypeScript files from all locations
- `py java` - Include both Python and Java files from all locations
- `**/*.specific` - Custom git pathspec patterns are also supported
- Leave empty to include all file types

**How the Filter Works:**
The extension automatically converts simple extensions to comprehensive git pathspec patterns:
- Input: `cs` → Generates: `*.cs` (root) + `**/*.cs` (all subdirectories)
- Input: `*.py` → Generates: `*.py` (root) + `**/*.py` (all subdirectories)
- Input: `.java` → Generates: `*.java` (root) + `**/*.java` (all subdirectories)
- Input: `js ts py` → Generates patterns for all three extensions

This ensures that files matching your specified extensions are included whether they're in the project root or nested in any subdirectory structure. You can separate multiple extensions with spaces, commas, or semicolons.

## Troubleshooting

### Common Issues

1. **No git repository found**: Ensure your workspace contains a git repository
2. **AWS credentials invalid** (Bedrock): Verify your access key and secret key are correct
3. **VS Code LM not available** (VS Code LM): Ensure you have GitHub Copilot or compatible LM provider
4. **Model not available**: Check that the selected model is available in your chosen region/provider
5. **Large diff timeout**: Consider reducing context lines or excluding deleted files
6. **Language settings not saving**: Try clearing the extension cache and reloading

### Provider-Specific Issues

**AWS Bedrock**:
- Ensure your AWS credentials have proper IAM permissions for Bedrock
- Verify the selected model is available in your region
- Check AWS service status if experiencing connection issues

**VS Code LM API**:
- Ensure GitHub Copilot subscription is active
- Check VS Code LM provider settings and authentication
- Verify the model family is supported by your LM provider

## Known Issues

- Large diffs (>100KB) may take longer to process and could timeout
- Some Bedrock models may not be available in all regions
- Network connectivity issues may cause review failures
- The extension requires proper IAM permissions for AWS Bedrock access
- Diff generation uses git commands, so complex file filtering requires Git to be installed on the system
