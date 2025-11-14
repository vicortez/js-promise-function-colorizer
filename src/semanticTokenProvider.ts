import * as ts from 'typescript'
import * as vscode from 'vscode'

// These are the token types and modifiers we will be using
const tokenTypes = ['promiseFunction']
const tokenModifiers: string[] = []
export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers)

export class DocumentSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  private readonly promiseReturningFunctions = new Set<string>()
  private readonly promiseReturningMethods = new Map<string, Set<string>>()
  // Track instance variables to their class types
  private readonly instanceToClass = new Map<string, string>()

  public async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens> {
    // Clear previous collections
    this.promiseReturningFunctions.clear()
    this.promiseReturningMethods.clear()
    this.instanceToClass.clear()

    const tokensBuilder = new vscode.SemanticTokensBuilder(legend)
    const sourceFile = ts.createSourceFile(
      document.fileName,
      document.getText(),
      ts.ScriptTarget.Latest,
      true
    )

    // First pass: collect promise-returning function definitions AND instance variables
    this.collectPromiseFunctions(sourceFile)
    this.collectInstanceVariables(sourceFile)

    // Second pass: highlight both definitions and calls
    this.visit(sourceFile, tokensBuilder, document)

    return tokensBuilder.build()
  }

  private collectInstanceVariables(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isNewExpression(node.initializer)
    ) {
      if (ts.isIdentifier(node.name) && ts.isIdentifier(node.initializer.expression)) {
        const variableName = node.name.text
        const className = node.initializer.expression.text
        this.instanceToClass.set(variableName, className)
      }
    }

    ts.forEachChild(node, (childNode) => this.collectInstanceVariables(childNode))
  }

  private collectPromiseFunctions(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      const isPromise = this.isFunctionReturningPromise(node)

      if (isPromise) {
        if (ts.isFunctionDeclaration(node) && node.name) {
          this.promiseReturningFunctions.add(node.name.text)
        } else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
          // For methods, we need to track the class/object they belong to
          const className = this.getContainingClassName(node)
          if (className) {
            if (!this.promiseReturningMethods.has(className)) {
              this.promiseReturningMethods.set(className, new Set())
            }
            this.promiseReturningMethods.get(className)!.add(node.name.text)
          }
        } else if (
          (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
          ts.isVariableDeclaration(node.parent) &&
          ts.isIdentifier(node.parent.name)
        ) {
          this.promiseReturningFunctions.add(node.parent.name.text)
        }
      }
    }

    ts.forEachChild(node, (childNode) => this.collectPromiseFunctions(childNode))
  }

  private visit(
    node: ts.Node,
    tokensBuilder: vscode.SemanticTokensBuilder,
    document: vscode.TextDocument
  ) {
    // Handle function definitions
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      const isPromise = this.isFunctionReturningPromise(node)

      if (isPromise) {
        let identifierNode: ts.Node | undefined

        if (ts.isFunctionDeclaration(node) && node.name) {
          identifierNode = node.name
        } else if (ts.isMethodDeclaration(node) && node.name) {
          identifierNode = node.name
        } else if (
          (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
          ts.isVariableDeclaration(node.parent)
        ) {
          identifierNode = node.parent.name
        }

        if (identifierNode) {
          this.pushToken(identifierNode, tokensBuilder, document)
        }
      }
    }

    // Handle function calls
    if (ts.isCallExpression(node)) {
      const shouldHighlight = this.isPromiseReturningCall(node)

      if (shouldHighlight) {
        let identifierNode: ts.Node | undefined

        if (ts.isIdentifier(node.expression)) {
          // Simple function call: myFunction()
          identifierNode = node.expression
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          // Method call: object.method() or Class.staticMethod()
          identifierNode = node.expression.name
        }

        if (identifierNode) {
          this.pushToken(identifierNode, tokensBuilder, document)
        }
      }
    }

    ts.forEachChild(node, (childNode) => this.visit(childNode, tokensBuilder, document))
  }

  private isFunctionReturningPromise(node: ts.FunctionLikeDeclaration): boolean {
    // Check for async keyword
    if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)) {
      return true
    }

    // Check for explicit Promise return type
    if (node.type) {
      const returnTypeText = node.type.getText()
      if (returnTypeText.startsWith('Promise<') || returnTypeText === 'Promise') {
        return true
      }
    }

    // Check for common promise patterns in the function body
    if (node.body) {
      const bodyText = node.body.getText()

      // Look for return statements with Promise constructors or promise-returning calls
      if (
        bodyText.includes('return new Promise') ||
        bodyText.includes('return Promise.') ||
        bodyText.includes('return fetch(') ||
        bodyText.includes('return axios.') ||
        bodyText.includes('.then(') ||
        bodyText.includes('.catch(') ||
        bodyText.includes('await ')
      ) {
        return true
      }
    }

    return false
  }

  private isPromiseReturningCall(node: ts.CallExpression): boolean {
    // Check for direct function calls
    if (ts.isIdentifier(node.expression)) {
      const functionName = node.expression.text

      // Known async functions
      if (['fetch', 'setTimeout', 'setInterval'].includes(functionName)) {
        return true
      }

      // Functions we've identified as returning promises
      if (this.promiseReturningFunctions.has(functionName)) {
        return true
      }
    }

    // Check for method calls
    if (ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text

      // Common promise-returning methods
      const commonAsyncMethods = [
        'then',
        'catch',
        'finally',
        'all',
        'race',
        'resolve',
        'reject',
        'get',
        'post',
        'put',
        'delete',
        'patch', // HTTP methods
        'query',
        'save',
        'update',
        'delete',
        'find',
        'findOne', // Database methods
        'readFile',
        'writeFile',
        'stat',
        'readdir', // File system methods
        'exec',
        'spawn', // Process methods
      ]

      if (commonAsyncMethods.includes(methodName)) {
        return true
      }

      // Check our collected methods
      const objectExpression = node.expression.expression
      if (ts.isIdentifier(objectExpression)) {
        const objectName = objectExpression.text

        // First check if this is a direct class reference (e.g., DataService.staticMethod())
        let methods = this.promiseReturningMethods.get(objectName)
        if (methods && methods.has(methodName)) {
          return true
        }

        // Then check if this is an instance variable (e.g., service.method())
        const className = this.instanceToClass.get(objectName)
        if (className) {
          methods = this.promiseReturningMethods.get(className)
          if (methods && methods.has(methodName)) {
            return true
          }
        }
      }

      // Check for Promise static methods
      if (ts.isIdentifier(objectExpression) && objectExpression.text === 'Promise') {
        return true
      }
    }

    return false
  }

  private getContainingClassName(node: ts.Node): string | undefined {
    let current = node.parent
    while (current) {
      if (ts.isClassDeclaration(current) && current.name) {
        return current.name.text
      }
      current = current.parent
    }
    return undefined
  }

  private pushToken(
    node: ts.Node,
    tokensBuilder: vscode.SemanticTokensBuilder,
    document: vscode.TextDocument
  ) {
    const start = node.getStart()
    const end = node.getEnd()
    const startPosition = document.positionAt(start)
    const endPosition = document.positionAt(end)

    tokensBuilder.push(new vscode.Range(startPosition, endPosition), 'promiseFunction', [])
  }
}
