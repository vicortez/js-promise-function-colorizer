import * as ts from 'typescript'
import * as vscode from 'vscode'

// Define the token types and modifiers we will be using
const tokenTypes = ['promiseFunction']
const tokenModifiers = ['declaration'] // Not used in this simple case, but good to have
export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers)

export class DocumentSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  public async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens> {
    const tokensBuilder = new vscode.SemanticTokensBuilder(legend)
    const sourceFile = ts.createSourceFile(
      document.fileName,
      document.getText(),
      ts.ScriptTarget.Latest,
      true // setParentNodes
    )

    // Traverse the AST to find promise-returning functions.
    // We pass the 'document' object down the visitor function.
    this.visit(sourceFile, tokensBuilder, document)

    return tokensBuilder.build()
  }

  // The 'visit' function now accepts the 'document' as a parameter.
  private visit(
    node: ts.Node,
    tokensBuilder: vscode.SemanticTokensBuilder,
    document: vscode.TextDocument
  ) {
    // Check if the node is a function-like declaration
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      let isPromise = false

      // 1. Check for an explicit 'async' keyword
      if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)) {
        isPromise = true
      }

      // 2. Check for an explicit return type of Promise<...>
      // We only do this if it's not already identified as an async function.
      if (!isPromise && node.type) {
        // Using the full text of the type node is a simple but effective way
        // to check for a Promise return type without a full type-checker.
        const returnTypeText = node.type.getText()
        if (returnTypeText.startsWith('Promise<') || returnTypeText === 'Promise') {
          isPromise = true
        }
      }

      if (isPromise) {
        let identifierNode: ts.Node | undefined

        // Find the name/identifier of the function to highlight
        if (ts.isFunctionDeclaration(node) && node.name) {
          identifierNode = node.name
        } else if (ts.isMethodDeclaration(node) && node.name) {
          identifierNode = node.name
        } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          // For arrow functions like `const myFunc = async () => {}`
          // we need to look at the parent variable declaration.
          if (ts.isVariableDeclaration(node.parent)) {
            identifierNode = node.parent.name
          }
        }

        if (identifierNode) {
          const start = identifierNode.getStart()
          const end = identifierNode.getEnd()

          // We now use the 'document' object that was passed in.
          // This is the robust way to convert character offsets to VS Code positions.
          const startPosition = document.positionAt(start)
          const endPosition = document.positionAt(end)

          // Push the token to the builder
          tokensBuilder.push(
            new vscode.Range(startPosition, endPosition),
            'promiseFunction', // The type of token we defined in package.json
            [] // No modifiers
          )
        }
      }
    }

    // Continue traversing the rest of the tree, passing the 'document' object along.
    ts.forEachChild(node, (childNode) => this.visit(childNode, tokensBuilder, document))
  }
}
