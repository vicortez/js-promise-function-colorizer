import * as ts from 'typescript'
import * as vscode from 'vscode'

// Token types and legend remain the same across all providers
const tokenTypes = ['promiseFunction']
const tokenModifiers: string[] = []
export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers)

export abstract class BaseSemanticTokenProvider implements vscode.DocumentSemanticTokensProvider {
  abstract provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens>

  protected pushToken(
    node: ts.Node,
    tokensBuilder: vscode.SemanticTokensBuilder,
    document: vscode.TextDocument
  ) {
    const startPosition = document.positionAt(node.getStart())
    const endPosition = document.positionAt(node.getEnd())
    tokensBuilder.push(new vscode.Range(startPosition, endPosition), 'promiseFunction', [])
  }
}
