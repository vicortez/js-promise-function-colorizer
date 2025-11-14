// heuristicSemanticTokenProvider.ts

import * as ts from 'typescript'
import * as vscode from 'vscode'
import { BaseSemanticTokenProvider, legend } from './baseSemanticTokenProvider'

export class HeuristicSemanticTokenProvider extends BaseSemanticTokenProvider {
  private readonly promiseReturningFunctions = new Set<string>()
  private readonly promiseReturningMethods = new Map<string, Set<string>>()
  private readonly instanceToClass = new Map<string, string>()
  private readonly objectToPromiseMethods = new Map<string, Set<string>>()

  public async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens> {
    // Clear previous collections for each run
    this.promiseReturningFunctions.clear()
    this.promiseReturningMethods.clear()
    this.instanceToClass.clear()
    this.objectToPromiseMethods.clear()

    const tokensBuilder = new vscode.SemanticTokensBuilder(legend)
    const sourceFile = ts.createSourceFile(
      document.fileName,
      document.getText(),
      ts.ScriptTarget.Latest,
      true
    )

    // First pass: collect promise-returning function definitions and instance variables
    this.collectPromiseFunctions(sourceFile)
    this.collectInstanceVariables(sourceFile)
    this.collectObjectLiterals(sourceFile)

    // Second pass: highlight both definitions and calls
    this.visit(sourceFile, tokensBuilder, document)

    return tokensBuilder.build()
  }

  /**
   * Determines if a function returns a promise using only fast heuristics.
   * NO TypeChecker is used here.
   */
  protected isFunctionReturningPromise(node: ts.FunctionLikeDeclaration): boolean {
    // 1. Check for async keyword (most reliable and cheap)
    if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)) {
      return true
    }

    // 2. Check explicit Promise return type annotation (text-based, cheap)
    if (node.type) {
      const returnTypeText = node.type.getText()
      if (returnTypeText.startsWith('Promise<') || returnTypeText === 'Promise') {
        return true
      }
    }

    // 3. Check for common promise return patterns in the function body (cheap)
    if (this.hasPromiseReturnPattern(node)) {
      return true
    }

    return false
  }

  private hasPromiseReturnPattern(node: ts.FunctionLikeDeclaration): boolean {
    // Handle arrow function expression bodies: () => someFunc()
    if (ts.isArrowFunction(node) && node.body && !ts.isBlock(node.body)) {
      return this.isExpressionReturningPromise(node.body)
    }

    // Handle block bodies with explicit return statements
    if (node.body && ts.isBlock(node.body)) {
      let hasPromiseReturn = false
      const visit = (n: ts.Node) => {
        if (ts.isReturnStatement(n) && n.expression) {
          if (this.isExpressionReturningPromise(n.expression)) {
            hasPromiseReturn = true
            return // Stop searching this branch
          }
        }
        // Don't traverse into nested functions
        if (
          n !== node &&
          (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))
        ) {
          return
        }
        ts.forEachChild(n, visit)
      }
      visit(node.body)
      return hasPromiseReturn
    }

    return false
  }

  private isExpressionReturningPromise(expression: ts.Expression): boolean {
    // Check for "new Promise(...)"
    if (
      ts.isNewExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'Promise'
    ) {
      return true
    }

    // Check for "Promise.resolve(...)" or other static methods
    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      ts.isIdentifier(expression.expression.expression) &&
      expression.expression.expression.text === 'Promise'
    ) {
      return true
    }

    // Check if it's calling a function we know returns a promise
    if (ts.isCallExpression(expression)) {
      return this.isKnownPromiseReturningCall(expression)
    }

    // Check if it's returning the result of an await expression
    if (ts.isAwaitExpression(expression)) {
      return true
    }

    return false
  }

  protected isKnownPromiseReturningCall(callExpression: ts.CallExpression): boolean {
    // Check for direct function calls
    if (ts.isIdentifier(callExpression.expression)) {
      const functionName = callExpression.expression.text
      // Known global promise-returning functions
      if (functionName === 'fetch') {
        return true
      }
      // Functions we've already identified
      if (this.promiseReturningFunctions.has(functionName)) {
        return true
      }
    }

    // Check for method calls
    if (ts.isPropertyAccessExpression(callExpression.expression)) {
      const methodName = callExpression.expression.name.text
      const objectExpression = callExpression.expression.expression

      if (ts.isIdentifier(objectExpression)) {
        const objectName = objectExpression.text
        // Promise static methods
        if (objectName === 'Promise') {
          return true
        }
        // Methods on classes we've identified
        let methods = this.promiseReturningMethods.get(objectName)
        if (methods?.has(methodName)) {
          return true
        }
        // Methods on instances of classes
        const className = this.instanceToClass.get(objectName)
        if (className) {
          methods = this.promiseReturningMethods.get(className)
          if (methods?.has(methodName)) {
            return true
          }
        }
        // Methods on object literals
        const objectMethods = this.objectToPromiseMethods.get(objectName)
        if (objectMethods?.has(methodName)) {
          return true
        }
      }
    }

    return false
  }

  private collectObjectLiterals(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      if (ts.isIdentifier(node.name)) {
        const objectName = node.name.text
        const promiseMethods = new Set<string>()

        for (const property of node.initializer.properties) {
          // Handle: const obj = { promiseFunc }
          if (ts.isShorthandPropertyAssignment(property)) {
            const propertyName = property.name.text
            if (this.promiseReturningFunctions.has(propertyName)) {
              promiseMethods.add(propertyName)
            }
          }
          // Handle: const obj = { newName: promiseFunc }
          else if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            ts.isIdentifier(property.initializer)
          ) {
            const propertyName = property.name.text
            const referencedFunction = property.initializer.text
            if (this.promiseReturningFunctions.has(referencedFunction)) {
              promiseMethods.add(propertyName)
            }
          }
          // Handle: const obj = { async myMethod() {} }
          else if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name)) {
            if (this.isFunctionReturningPromise(property)) {
              promiseMethods.add(property.name.text)
            }
          }
        }

        if (promiseMethods.size > 0) {
          this.objectToPromiseMethods.set(objectName, promiseMethods)
        }
      }
    }
    ts.forEachChild(node, (childNode) => this.collectObjectLiterals(childNode))
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
      if (this.isFunctionReturningPromise(node)) {
        if (ts.isFunctionDeclaration(node) && node.name) {
          this.promiseReturningFunctions.add(node.name.text)
        } else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
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
      if (this.isFunctionReturningPromise(node)) {
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
      if (this.isKnownPromiseReturningCall(node)) {
        let identifierNode: ts.Node | undefined
        if (ts.isIdentifier(node.expression)) {
          identifierNode = node.expression
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          identifierNode = node.expression.name
        }
        if (identifierNode) {
          this.pushToken(identifierNode, tokensBuilder, document)
        }
      }
    }

    ts.forEachChild(node, (childNode) => this.visit(childNode, tokensBuilder, document))
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
}
