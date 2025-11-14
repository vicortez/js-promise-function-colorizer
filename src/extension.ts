import * as vscode from 'vscode'
import { DocumentSemanticTokensProvider, legend } from './semanticTokenProvider'

/**
 * Reads the custom color from the user's settings and programmatically
 * updates the editor's semantic token color customizations.
 */
function updateColorConfiguration() {
  // 1. Get the workspace configuration for our extension.
  const promiseConfig = vscode.workspace.getConfiguration('promiseColorizer')

  // 2. Read the 'color' setting. Use the default from package.json as a fallback.
  const colorValue = promiseConfig.get<string>('color')

  if (!colorValue) {
    console.error("Could not read 'promiseColorizer.color'. Using default.")
    return
  }

  // 3. Get the configuration for the editor itself.
  const editorConfig = vscode.workspace.getConfiguration('editor')

  // 4. We need to get the existing rules, so we don't overwrite other user customizations.
  // The 'inspect' method gives us the value from all configuration targets (User, Workspace, etc.).
  const existingRules =
    editorConfig.inspect<any>('semanticTokenColorCustomizations')?.globalValue || {}

  // 5. Define our new rule for 'promiseFunction'.
  const newRule = {
    promiseFunction: colorValue,
  }

  // 6. Merge our rule with existing rules. This ensures we don't delete other customizations.
  const finalRules = {
    ...existingRules,
    rules: {
      ...(existingRules.rules || {}),
      ...newRule,
    },
  }

  // 7. Update the 'semanticTokenColorCustomizations' setting at the Global level.
  // This programmatically changes the user's settings.json file to apply the color.
  editorConfig.update(
    'semanticTokenColorCustomizations',
    finalRules,
    vscode.ConfigurationTarget.Global
  )

  console.log(`Promise function color updated to: ${colorValue}`)
}

// This method is called when your extension is activated.
export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "js-promise-function-colorizer" is now active!')

  // --- Main Logic ---

  // 1. Apply the color immediately on activation.
  updateColorConfiguration()

  // 2. Register a listener for when the configuration changes.
  // This ensures that if the user changes the color in settings, it updates live.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      // Check if the change affects our specific setting.
      // Note the corrected configuration name 'promiseColorizer.color'.
      if (event.affectsConfiguration('promiseColorizer.color')) {
        // If it does, re-run our update function to apply the new color.
        updateColorConfiguration()
      }
    })
  )

  // 3. Register the semantic tokens provider.
  // This is what actually does the code analysis and highlighting.
  const selector = [
    { language: 'javascript', scheme: 'file' },
    { language: 'typescript', scheme: 'file' },
    { language: 'javascriptreact', scheme: 'file' },
    { language: 'typescriptreact', scheme: 'file' },
  ]

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      new DocumentSemanticTokensProvider(),
      legend
    )
  )

  // --- Boilerplate Command (can be kept or removed) ---
  const disposable = vscode.commands.registerCommand(
    'js-promise-function-colorizer.helloWorld',
    () => {
      vscode.window.showInformationMessage('Hello from js-promise-function-colorizer!')
    }
  )
  context.subscriptions.push(disposable)
}

// This method is called when your extension is deactivated.
export function deactivate() {
  // It's good practice to clean up the setting when the extension is deactivated,
  // though not strictly necessary. For simplicity, we'll leave it as is for now.
}
