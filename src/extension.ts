import * as vscode from 'vscode'
import { legend } from './baseSemanticTokenProvider'
import { logger, Logger } from './logger'

let providerRegistration: vscode.Disposable | undefined

/**
 * Reads the user's color setting and updates the editor's semantic token rules.
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
  const newRule = { promiseFunction: colorValue }
  const finalRules = {
    ...existingRules,
    rules: { ...(existingRules.rules || {}), ...newRule },
  }
  editorConfig.update(
    'semanticTokenColorCustomizations',
    finalRules,
    vscode.ConfigurationTarget.Global
  )
  logger.info(`Promise function color updated to: ${colorValue}`)
}

/**
 * Registers the correct semantic token provider based on user settings.
 */
async function updateProviderRegistration(context: vscode.ExtensionContext) {
  if (providerRegistration) {
    providerRegistration.dispose()
  }

  const config = vscode.workspace.getConfiguration('promiseColorizer')
  const method = config.get<'heuristic' | 'tsc' | 'hybrid'>('detectionMethod', 'heuristic')

  logger.info(`Detection method set to: '${method}'. Registering the appropriate provider.`)

  const selector: vscode.DocumentSelector = [
    { language: 'javascript', scheme: 'file' },
    { language: 'typescript', scheme: 'file' },
    { language: 'javascriptreact', scheme: 'file' },
    { language: 'typescriptreact', scheme: 'file' },
  ]

  let provider: vscode.DocumentSemanticTokensProvider

  if (method === 'tsc') {
    const { TscSemanticTokenProvider } = await import('./tscSemanticTokenProvider.js')
    provider = new TscSemanticTokenProvider()
  } else if (method === 'hybrid') {
    const { HybridSemanticTokenProvider } = await import('./hybridSemanticTokenProvider.js')
    provider = new HybridSemanticTokenProvider()
  } else {
    const { HeuristicSemanticTokenProvider } = await import('./heuristicSemanticTokenProvider.js')
    provider = new HeuristicSemanticTokenProvider()
  }

  providerRegistration = vscode.languages.registerDocumentSemanticTokensProvider(
    selector,
    provider,
    legend
  )

  context.subscriptions.push(providerRegistration)
}

async function showWelcomeMessage(context: vscode.ExtensionContext) {
  const hasShownWelcome = context.globalState.get('hasShownWelcome', false)
  if (!hasShownWelcome) {
    logger.info('First-time activation, showing welcome message.')
    vscode.window
      .showInformationMessage(
        '🎉 Promise Colorizer is active! You can customize the color and detection method in settings.',
        'Open Settings'
      )
      .then((action) => {
        if (action === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'promiseColorizer')
        }
      })
    await context.globalState.update('hasShownWelcome', true)
  }
}

export async function activate(context: vscode.ExtensionContext) {
  Logger.initialize()
  logger.info('Promise Colorizer extension activating...')

  showWelcomeMessage(context).catch((error) => {
    logger.error('Failed to show welcome message', error)
  })

  try {
    updateColorConfiguration()
  } catch (error) {
    logger.error('Failed to apply initial color configuration', error)
  }

  try {
    await updateProviderRegistration(context)
  } catch (error) {
    logger.error('Failed to register initial semantic token provider', error)
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      const needsColorUpdate = event.affectsConfiguration('promiseColorizer.color')
      const needsProviderUpdate = event.affectsConfiguration('promiseColorizer.detectionMethod')

      if (needsColorUpdate) {
        logger.info('Color configuration changed, updating...')
        try {
          updateColorConfiguration()
        } catch (error) {
          logger.error('Failed to update color configuration', error)
        }
      }

      if (needsProviderUpdate) {
        logger.info('Detection method changed, re-registering provider...')
        try {
          await updateProviderRegistration(context)
        } catch (error) {
          logger.error('Failed to re-register semantic token provider', error)
        }
      }
    })
  )

  logger.info('Promise Colorizer extension activation completed.')
}

export function deactivate() {
  logger.info('Promise Colorizer extension deactivated.')
}
