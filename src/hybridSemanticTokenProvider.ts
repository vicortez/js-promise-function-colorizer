// hybridSemanticTokenProvider.ts

import * as path from 'path'
import * as ts from 'typescript'
import * as vscode from 'vscode'
import { BaseSemanticTokenProvider, legend } from './baseSemanticTokenProvider'

export class HybridSemanticTokenProvider extends BaseSemanticTokenProvider {
  private readonly promiseReturningFunctions = new Set<string>()
  private readonly promiseReturningMethods = new Map<string, Set<string>>()
  private readonly instanceToClass = new Map<string, string>()
  private readonly objectToPromiseMethods = new Map<string, Set<string>>()
  private readonly heuristicTokens = new Set<string>() // Track nodes already identified by heuristics
  private typeChecker: ts.TypeChecker | undefined

  public async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens> {
    // Clear previous collections for each run
    this.promiseReturningFunctions.clear()
    this.promiseReturningMethods.clear()
    this.instanceToClass.clear()
    this.objectToPromiseMethods.clear()
    this.heuristicTokens.clear()
    this.typeChecker = undefined

    const tokensBuilder = new vscode.SemanticTokensBuilder(legend)
    const sourceFile = ts.createSourceFile(
      document.fileName,
      document.getText(),
      ts.ScriptTarget.Latest,
      true
    )

    // Phase 1: Run heuristic analysis (fast)
    this.collectPromiseFunctions(sourceFile)
    this.collectInstanceVariables(sourceFile)
    this.collectObjectLiterals(sourceFile)
    this.visitHeuristic(sourceFile, tokensBuilder, document)

    // Phase 2: Try to create TypeScript program for fallback analysis (expensive)
    // Only proceed if heuristic analysis didn't find everything we might expect
    const tscSourceFile = this.createTypeScriptProgram(document, sourceFile)
    if (tscSourceFile && this.typeChecker) {
      // Phase 3: Run TypeScript analysis on remaining nodes
      this.visitTypeScript(tscSourceFile, tokensBuilder, document, this.typeChecker)
    }

    return tokensBuilder.build()
  }

  /**
   * Creates the TypeScript program and initializes the TypeChecker for fallback analysis.
   */
  private createTypeScriptProgram(
    document: vscode.TextDocument,
    existingSourceFile: ts.SourceFile
  ): ts.SourceFile | undefined {
    try {
      const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['ES2020', 'DOM'],
        allowJs: true,
        checkJs: true,
        resolveJsonModule: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
      }

      const currentDir = path.dirname(document.fileName)
      const host = ts.createCompilerHost(compilerOptions, true)
      const originalGetSourceFile = host.getSourceFile
      host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        if (fileName === document.fileName) {
          return existingSourceFile
        }
        return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      }
      host.getCurrentDirectory = () => currentDir

      const program = ts.createProgram([document.fileName], compilerOptions, host)
      this.typeChecker = program.getTypeChecker()

      return program.getSourceFile(document.fileName)
    } catch (error) {
      console.error('Error creating TypeScript program for hybrid analysis:', error)
      this.typeChecker = undefined
      return undefined
    }
  }

  // ============= HEURISTIC METHODS (from HeuristicSemanticTokenProvider) =============

  private isFunctionReturningPromiseHeuristic(node: ts.FunctionLikeDeclaration): boolean {
    if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)) {
      return true
    }

    if (node.type) {
      const returnTypeText = node.type.getText()
      if (returnTypeText.startsWith('Promise<') || returnTypeText === 'Promise') {
        return true
      }
    }

    if (this.hasPromiseReturnPattern(node)) {
      return true
    }

    return false
  }

  private hasPromiseReturnPattern(node: ts.FunctionLikeDeclaration): boolean {
    if (ts.isArrowFunction(node) && node.body && !ts.isBlock(node.body)) {
      return this.isExpressionReturningPromise(node.body)
    }

    if (node.body && ts.isBlock(node.body)) {
      let hasPromiseReturn = false
      const visit = (n: ts.Node) => {
        if (ts.isReturnStatement(n) && n.expression) {
          if (this.isExpressionReturningPromise(n.expression)) {
            hasPromiseReturn = true
            return
          }
        }
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
    if (
      ts.isNewExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'Promise'
    ) {
      return true
    }

    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      ts.isIdentifier(expression.expression.expression) &&
      expression.expression.expression.text === 'Promise'
    ) {
      return true
    }

    if (ts.isCallExpression(expression)) {
      return this.isKnownPromiseReturningCall(expression)
    }

    if (ts.isAwaitExpression(expression)) {
      return true
    }

    return false
  }

  private isKnownPromiseReturningCall(callExpression: ts.CallExpression): boolean {
    if (ts.isIdentifier(callExpression.expression)) {
      const functionName = callExpression.expression.text
      if (functionName === 'fetch') {
        return true
      }
      if (this.promiseReturningFunctions.has(functionName)) {
        return true
      }
    }

    if (ts.isPropertyAccessExpression(callExpression.expression)) {
      const methodName = callExpression.expression.name.text
      const objectExpression = callExpression.expression.expression

      if (ts.isIdentifier(objectExpression)) {
        const objectName = objectExpression.text
        if (objectName === 'Promise') {
          return true
        }
        let methods = this.promiseReturningMethods.get(objectName)
        if (methods?.has(methodName)) {
          return true
        }
        const className = this.instanceToClass.get(objectName)
        if (className) {
          methods = this.promiseReturningMethods.get(className)
          if (methods?.has(methodName)) {
            return true
          }
        }
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
          if (ts.isShorthandPropertyAssignment(property)) {
            const propertyName = property.name.text
            if (this.promiseReturningFunctions.has(propertyName)) {
              promiseMethods.add(propertyName)
            }
          } else if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            ts.isIdentifier(property.initializer)
          ) {
            const propertyName = property.name.text
            const referencedFunction = property.initializer.text
            if (this.promiseReturningFunctions.has(referencedFunction)) {
              promiseMethods.add(propertyName)
            }
          } else if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name)) {
            if (this.isFunctionReturningPromiseHeuristic(property)) {
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
      if (this.isFunctionReturningPromiseHeuristic(node)) {
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

  // ============= TYPESCRIPT METHODS (from TscSemanticTokenProvider) =============

  private isPromiseType(type: ts.Type, typeChecker: ts.TypeChecker): boolean {
    if (type.isUnion()) {
      return type.types.some((t) => this.isPromiseType(t, typeChecker))
    }

    const symbol = type.getSymbol()
    if (symbol?.getName() === 'Promise') {
      return true
    }

    const thenProperty = type.getProperty('then')
    if (thenProperty && thenProperty.valueDeclaration) {
      const thenType = typeChecker.getTypeOfSymbolAtLocation(
        thenProperty,
        thenProperty.valueDeclaration
      )
      const signatures = thenType.getCallSignatures()
      return signatures.length > 0
    }

    return false
  }

  private isFunctionReturningPromiseTypeScript(
    node: ts.FunctionLikeDeclaration,
    typeChecker: ts.TypeChecker
  ): boolean {
    if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)) {
      return true
    }

    try {
      const signature = typeChecker.getSignatureFromDeclaration(node)
      if (signature) {
        const returnType = typeChecker.getReturnTypeOfSignature(signature)
        return this.isPromiseType(returnType, typeChecker)
      }
    } catch (e) {
      console.error('Error checking function signature in hybrid mode:', e)
    }

    return false
  }

  private isPromiseReturningCallTypeScript(
    node: ts.CallExpression,
    typeChecker: ts.TypeChecker
  ): boolean {
    try {
      const signature = typeChecker.getResolvedSignature(node)
      if (signature) {
        const returnType = typeChecker.getReturnTypeOfSignature(signature)
        return this.isPromiseType(returnType, typeChecker)
      }
    } catch (e) {
      console.error('Error checking call expression signature in hybrid mode:', e)
    }

    return false
  }

  // ============= VISITOR METHODS =============

  private visitHeuristic(
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
      if (this.isFunctionReturningPromiseHeuristic(node)) {
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
          this.heuristicTokens.add(this.getNodeKey(identifierNode))
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
          this.heuristicTokens.add(this.getNodeKey(identifierNode))
        }
      }
    }

    ts.forEachChild(node, (childNode) => this.visitHeuristic(childNode, tokensBuilder, document))
  }

  private visitTypeScript(
    node: ts.Node,
    tokensBuilder: vscode.SemanticTokensBuilder,
    document: vscode.TextDocument,
    typeChecker: ts.TypeChecker
  ) {
    let identifierNode: ts.Node | undefined

    // Check for function definitions (only if not already found by heuristics)
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      let candidateIdentifierNode: ts.Node | undefined
      if (ts.isFunctionDeclaration(node) && node.name) {
        candidateIdentifierNode = node.name
      } else if (ts.isMethodDeclaration(node) && node.name) {
        candidateIdentifierNode = node.name
      } else if (
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        ts.isVariableDeclaration(node.parent)
      ) {
        candidateIdentifierNode = node.parent.name
      }

      if (
        candidateIdentifierNode &&
        !this.heuristicTokens.has(this.getNodeKey(candidateIdentifierNode))
      ) {
        if (this.isFunctionReturningPromiseTypeScript(node, typeChecker)) {
          identifierNode = candidateIdentifierNode
        }
      }
    }

    // Check for function calls (only if not already found by heuristics)
    if (ts.isCallExpression(node)) {
      let candidateIdentifierNode: ts.Node | undefined
      if (ts.isIdentifier(node.expression)) {
        candidateIdentifierNode = node.expression
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        candidateIdentifierNode = node.expression.name
      }

      if (
        candidateIdentifierNode &&
        !this.heuristicTokens.has(this.getNodeKey(candidateIdentifierNode))
      ) {
        if (this.isPromiseReturningCallTypeScript(node, typeChecker)) {
          identifierNode = candidateIdentifierNode
        }
      }
    }

    if (identifierNode) {
      this.pushToken(identifierNode, tokensBuilder, document)
    }

    ts.forEachChild(node, (childNode) =>
      this.visitTypeScript(childNode, tokensBuilder, document, typeChecker)
    )
  }

  private getNodeKey(node: ts.Node): string {
    return `${node.getStart()}-${node.getEnd()}`
  }
}
