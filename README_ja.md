Language: [English](./README.md) / [Japanese](./README_ja.md)

# DiffLens for VSCode

AWS BedrockまたはVS Code Language Model APIを活用したAIによるgit差分コードレビュー拡張機能

## 機能概要

このVS Code拡張機能は、以下の特徴を持っています：

- **複数のLLMプロバイダー対応**: AWS BedrockまたはVS Code Language Model APIから選択可能
- **サイドバーUIから直感的に操作可能**: 専用アクティビティバーアイコンで簡単アクセス
- **Gitリポジトリの自動検出と差分抽出**: 高度な差分抽出とフィルタリング機能
- **AIコードレビュー**: 選択したプロバイダーによる知的なコード分析
- **柔軟なプロンプト・レビュー観点のカスタマイズ**: デフォルト設定と実行時設定の分離
- **多言語対応（日本語・英語）**: インターフェースの即座切り替え
- **豊富な設定オプション**: 折りたたみ式設定エリアとリアルタイムプレビュー

## 必要な環境

- VS Code 1.101.0以上
- VS Code Git拡張機能（通常はデフォルトで有効）
- .gitディレクトリを持つワークスペース
- 以下のいずれかのAIプロバイダー：
  - **AWS Bedrock**: AWSアカウントとBedrock利用権限が必要
  - **VS Code LM API**: GitHub Copilotサブスクリプションまたは互換プロバイダーが必要

**注意**: この拡張機能はVS CodeのGit APIを使用するため、システムにGitがインストールされていなくても動作します。ただし、VS CodeのGit拡張機能が有効である必要があります。

## 拡張機能の設定

サイドバーUIまたはVS Codeの設定画面から、以下の項目を設定できます：

### 基本設定
- `diffLens.systemPrompt`: AIモデルに送信するシステムプロンプト
- `diffLens.reviewPerspective`: コードレビューの観点・基準
- `diffLens.interfaceLanguage`: インターフェース言語（英語/日本語）

### LLMプロバイダー選択
- `diffLens.llmProvider`: 'bedrock' または 'vscode-lm' から選択

### AWS Bedrock設定
- `diffLens.awsAccessKey`: AWSアクセスキーID
- `diffLens.awsSecretKey`: AWSシークレットアクセスキー
- `diffLens.awsRegion`: AWSリージョン
- `diffLens.modelName`: 使用するBedrockモデル名

### 差分設定
- `diffLens.contextLines`: 差分のコンテキスト行数（デフォルト: 50）
- `diffLens.excludeDeletes`: 削除ファイルを差分から除外
- `diffLens.fileExtensions`: 対象ファイル拡張子（例: '*.js *.ts *.py'）

## 使い方

### サイドバーUI

1. **拡張機能を開く**  
   VS Codeのアクティビティバーで「DiffLens」アイコン（🔍）をクリックし、サイドバーパネルを表示します。

2. **設定を構成**  
   設定アイコン（⚙️）から各種設定を行います。

3. **言語切り替え**  
   設定エリアで希望の言語を選択できます。

4. **AWS Bedrock設定**  
   AWSアクセスキー・シークレットキー・リージョン・モデル名を入力します。

5. **デフォルトプロンプト設定**  
   コードレビュー用のシステムプロンプトや観点を設定し、テンプレートとして保存できます。

6. **差分設定**  
   コンテキスト行数や除外ファイルなどを調整し、「💾 設定を保存」で保存します。

7. **メインワークフロー**  
   設定後、リポジトリ情報やプロンプト情報が表示されます。比較コミットも選択可能です。

8. **プロンプト管理**  
   プロンプト情報は編集可能で、「📥 デフォルト読み込み」でテンプレートをコピーできます。

9. **プレビューとレビュー**  
   「👁️ 差分プレビュー」で変更内容を確認し、「🚀 コードレビュー実行」でBedrockに差分を送信、結果が新規ドキュメントに表示されます。

### コマンドパレットから

1. **設定を構成**  
   VS Codeの設定画面で「DiffLens」と検索し、各項目を設定します。

2. **レビュー実行**  
   コマンドパレット（`Cmd+Shift+P` / `Ctrl+Shift+P`）で "Review Code with Bedrock" を実行し、AIによるレビュー結果を表示します。

## インターフェース言語

- **英語**（デフォルト）
- **日本語**  
  設定エリアから即時切り替え可能で、再起動不要です。設定はセッション間で保持されます。

## AWS Bedrock設定

### 利用可能リージョン例
- us-east-1 (N. Virginia)
- us-west-2 (Oregon)
- eu-west-1 (Ireland)
- ap-southeast-1 (Singapore)
- ap-northeast-1 (Tokyo)
- その他

※最新情報はAWS公式ドキュメントをご確認ください。

### 利用可能モデル例
- Claude 3.5 Sonnet v2: `anthropic.claude-3-5-sonnet-20241022-v2:0`
- Claude 3.5 Sonnet: `anthropic.claude-3-5-sonnet-20240620-v1:0`
- Claude 3 Haiku: `anthropic.claude-3-haiku-20240307-v1:0`
- Claude 3 Sonnet: `anthropic.claude-3-sonnet-20240229-v1:0`
- Claude 3 Opus: `anthropic.claude-3-opus-20240229-v1:0`
- Titan Text Premier: `amazon.titan-text-premier-v1:0`
- Llama 3.2 90B Instruct: `meta.llama3-2-90b-instruct-v1:0`
- Mistral Large 2407: `mistral.mistral-large-2407-v1:0`
- その他

※モデルの利用可否はリージョンによって異なります。

## プロンプト設定ワークフロー

- **デフォルトプロンプト**  
  VS Code設定に保存し、テンプレートとして利用。すべてのレビューの基準となります。

- **実行時プロンプト**  
  各レビューごとに編集可能。「📥 デフォルト読み込み」でテンプレートをコピーし、柔軟にカスタマイズできます。

## 差分設定オプション

- **コンテキスト行数**  
  差分ごとに含める前後の行数を指定します。

- **削除ファイルの除外**  
  有効にすると、削除されたファイルは分析対象外となります。

- **ファイル拡張子フィルター**  
  分析対象のファイルタイプを指定できます。例：
  - `cs` または `*.cs`：C#ファイル
  - `razor` または `*.razor`：Razorファイル
  - `js ts`：JavaScriptとTypeScript
  - `py java`：PythonとJava
  - `**/*.specific`：カスタムgit pathspecも対応
  - 空欄：すべてのファイルを含める

## トラブルシューティング

### よくある問題

1. **gitリポジトリが見つからない**：ワークスペースにgitリポジトリがあるか確認
2. **AWS認証情報が無効**：アクセスキー・シークレットキーを再確認
3. **モデルが利用できない**：選択したリージョンでモデルが利用可能か確認

## 既知の問題

- 大きな差分（100KB超）の処理は時間がかかる場合があります
- 一部モデルはすべてのリージョンで利用できません
- ネットワーク障害でレビューが失敗する場合があります
- AWS Bedrockへの適切なIAM権限が必要です
- 差分生成はgitコマンドを使用するため、複雑なファイルフィルタリングではシステムにGitがインストールされている必要があります

## 設定例

### サイドバーUIでの設定手順

1. アクティビティバーで「DiffLens」アイコンをクリック
2. 設定パネルで以下を入力：

**System Prompt（システムプロンプト）**:
```
あなたはシニアソフトウェアエンジニアとしてコードレビューを行います。提供されたgit差分を分析し、コード品質、セキュリティ、パフォーマンス、ベストプラクティスに焦点を当てて建設的なフィードバックを提供してください。
```

**Review Perspective（レビュー観点）**:
```
コード品質、セキュリティ脆弱性、パフォーマンスの問題、ベストプラクティスの遵守に焦点を当てます。改善のための具体的な提案を提供してください。
```

4. AWS認証情報を入力:
   - **AWS Access Key**: `YOUR_AWS_ACCESS_KEY`
   - **AWS Secret Key**: `YOUR_AWS_SECRET_KEY`
   - **AWS Region**: `us-east-1`
   - **Model Name**: `anthropic.claude-3-sonnet-20240229-v1:0`

5. 「💾 Save Settings」をクリック
6. 「🔍 Run Code Review」でレビューを実行

### VS Code設定画面での設定手順

1. 設定画面を開き「DiffLens」と検索
2. 各項目を入力

### 設定ファイルを直接編集（上級者向け）

```json
{
  "diffLens.systemPrompt": "あなたはシニアソフトウェアエンジニアとしてコードレビューを行います...",
  "diffLens.reviewPerspective": "コード品質、セキュリティ脆弱性...",
  "diffLens.awsAccessKey": "YOUR_AWS_ACCESS_KEY",
  "diffLens.awsSecretKey": "YOUR_AWS_SECRET_KEY",
  "diffLens.awsRegion": "us-east-1",
  "diffLens.modelName": "anthropic.claude-3-sonnet-20240229-v1:0"
}
```
