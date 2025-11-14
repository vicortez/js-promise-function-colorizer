import * as vscode from 'vscode'
import { logger, Logger } from './logger' // Import both the instance and class
import { DocumentSemanticTokensProvider, legend } from './semanticTokenProvider'

/**
 * Reads the custom color from the user's settings and programmatically
 * updates the editor's semantic token color customizations.
 */
function updateColorConfiguration() {
  const promiseConfig = vscode.workspace.getConfiguration('promiseColorizer')
  const colorValue = promiseConfig.get<string>('color')

  if (!colorValue) {
    logger.error("Could not read 'promiseColorizer.color'. Using default.")
    return
  }

  const editorConfig = vscode.workspace.getConfiguration('editor')
  const existingRules =
    editorConfig.inspect<any>('semanticTokenColorCustomizations')?.globalValue || {}

  const newRule = {
    promiseFunction: colorValue,
  }

  const finalRules = {
    ...existingRules,
    rules: {
      ...(existingRules.rules || {}),
      ...newRule,
    },
  }

  editorConfig.update(
    'semanticTokenColorCustomizations',
    finalRules,
    vscode.ConfigurationTarget.Global
  )

  logger.info(`Promise function color updated to: ${colorValue}`)
}

/**
 * Shows a welcome message for first-time users (simple version)
 */
async function showWelcomeMessage(context: vscode.ExtensionContext) {
  const hasShownWelcome = context.globalState.get('hasShownWelcome', false)

  if (!hasShownWelcome) {
    logger.info('First-time activation detected, showing welcome message')

    vscode.window
      .showInformationMessage(
        '🎉 Promise Colorizer is now active! Promise-returning functions will be highlighted in purple. You can customize the color in settings.',
        'Open Settings'
      )
      .then((action) => {
        if (action === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'promiseColorizer')
        }
      })

    // Mark that we've shown the welcome message
    await context.globalState.update('hasShownWelcome', true)
    logger.info('Welcome message shown and state updated')
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Force logger initialization immediately (creates output channel)
  Logger.initialize()
  logger.info('Promise Colorizer extension activated')

  showWelcomeMessage(context).catch((error) => {
    logger.error('Failed to show welcome message', error)
  })

  // Apply the color immediately on activation
  try {
    updateColorConfiguration()
    logger.info('Initial color configuration applied')
  } catch (error) {
    logger.error('Failed to apply initial color configuration', error)
  }

  // Register a listener for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('promiseColorizer.color')) {
        logger.info('Color configuration changed, updating...')
        try {
          updateColorConfiguration()
        } catch (error) {
          logger.error('Failed to update color configuration', error)
        }
      }
    })
  )

  // Register the semantic tokens provider
  const selector: vscode.DocumentSelector = [
    { language: 'javascript', scheme: 'file' },
    { language: 'typescript', scheme: 'file' },
    { language: 'javascriptreact', scheme: 'file' },
    { language: 'typescriptreact', scheme: 'file' },
  ]

  try {
    context.subscriptions.push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        selector,
        new DocumentSemanticTokensProvider(),
        legend
      )
    )
    logger.info('Semantic token provider registered successfully for TS/JS files')
  } catch (error) {
    logger.error('Failed to register semantic token provider', error)
  }

  logger.info('Promise Colorizer extension activation completed')
}

export function deactivate() {
  logger.info('Promise Colorizer extension deactivated')
}
