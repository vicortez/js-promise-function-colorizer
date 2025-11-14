import * as path from 'path'
import * as ts from 'typescript'
import * as vscode from 'vscode'
import { BaseSemanticTokenProvider, legend } from './baseSemanticTokenProvider'

export class TscSemanticTokenProvider extends BaseSemanticTokenProvider {
  private typeChecker: ts.TypeChecker | undefined

  public async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens> {
    const tokensBuilder = new vscode.SemanticTokensBuilder(legend)

    // Step 1: Create the TS Program and TypeChecker. This is the most expensive part.
    // If it fails, we cannot proceed.
    const sourceFile = this.createTypeScriptProgram(document)
    if (!sourceFile || !this.typeChecker) {
      // Log an error or handle this case where the program couldn't be created.
      console.error('Failed to create TypeScript program or TypeChecker.')
      return tokensBuilder.build()
    }

    // Step 2: Traverse the AST and use the TypeChecker to identify promise functions/calls.
    this.visit(sourceFile, tokensBuilder, document, this.typeChecker)

    return tokensBuilder.build()
  }

  /**
   * Creates the TypeScript program and initializes the TypeChecker.
   * This is a prerequisite for any type analysis.
   * @returns The SourceFile for the current document, or undefined on failure.
   */
  private createTypeScriptProgram(document: vscode.TextDocument): ts.SourceFile | undefined {
    try {
      const sourceFile = ts.createSourceFile(
        document.fileName,
        document.getText(),
        ts.ScriptTarget.Latest,
        true
      )

      // --- Compiler Options Explanation ---
      // These options are configured to accurately analyze modern, mixed-codebase projects.
      const compilerOptions: ts.CompilerOptions = {
        // Target modern JavaScript syntax.
        target: ts.ScriptTarget.ES2020,
        // Use ESNext for module *generation* to support ESM syntax (`import`/`export`).
        module: ts.ModuleKind.ESNext,
        // Use Bundler for module *resolution* - very permissive, works with most patterns.
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        // Include standard libraries for modern JS and browser environments (DOM).
        lib: ['ES2020', 'DOM'],
        // Allow and type-check JavaScript files, not just TypeScript. Crucial for mixed codebases.
        allowJs: true,
        checkJs: true,
        // Allow importing JSON files, a common practice.
        resolveJsonModule: true,
        // Improve interoperability between CommonJS and ES Modules. Highly recommended.
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        // Performance optimization: Don't type-check files from `node_modules`.
        skipLibCheck: true,
      }

      const currentDir = path.dirname(document.fileName)
      const host = ts.createCompilerHost(compilerOptions, true)
      const originalGetSourceFile = host.getSourceFile
      host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        if (fileName === document.fileName) {
          return sourceFile
        }
        return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      }
      host.getCurrentDirectory = () => currentDir

      const program = ts.createProgram([document.fileName], compilerOptions, host)
      this.typeChecker = program.getTypeChecker()

      // Return the source file that belongs to this program instance
      return program.getSourceFile(document.fileName)
    } catch (error) {
      console.error('Error creating TypeScript program:', error)
      this.typeChecker = undefined
      return undefined
    }
  }

  /**
   * Checks if a given TypeScript Type is a Promise or a "thenable" (an object with a `then` method).
   * This method relies solely on the TypeChecker's analysis.
   */
  private isPromiseType(type: ts.Type, typeChecker: ts.TypeChecker): boolean {
    // If the type is a union (e.g., string | Promise<number>), check if any part of it is a Promise.
    if (type.isUnion()) {
      return type.types.some((t) => this.isPromiseType(t, typeChecker))
    }

    // Get the symbol for the type. If its name is "Promise", we're good.
    // This handles `Promise<T>` and `Promise<any>`.
    const symbol = type.getSymbol()
    if (symbol?.getName() === 'Promise') {
      return true
    }

    // For "thenable" objects (duck-typing), check for a `then` property that is a function.
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

  /**
   * Determines if a function-like declaration returns a promise, using only the TypeChecker.
   */
  protected isFunctionReturningPromise(
    node: ts.FunctionLikeDeclaration,
    typeChecker: ts.TypeChecker
  ): boolean {
    // The `async` keyword is a language guarantee that the function returns a Promise.
    // This is a highly reliable and performant check that avoids a deeper type analysis.
    if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)) {
      return true
    }

    try {
      // Get the signature of the function declaration.
      const signature = typeChecker.getSignatureFromDeclaration(node)
      if (signature) {
        // Get the return type from the signature and check if it's a promise.
        const returnType = typeChecker.getReturnTypeOfSignature(signature)
        return this.isPromiseType(returnType, typeChecker)
      }
    } catch (e) {
      // The TypeChecker can sometimes fail on complex or malformed code.
      console.error('Error checking function signature:', e)
    }

    return false
  }

  /**
   * Determines if a call expression results in a promise, using only the TypeChecker.
   */
  protected isPromiseReturningCall(node: ts.CallExpression, typeChecker: ts.TypeChecker): boolean {
    try {
      // Get the signature of the function being called.
      const signature = typeChecker.getResolvedSignature(node)
      if (signature) {
        // Get the return type from the signature and check if it's a promise.
        const returnType = typeChecker.getReturnTypeOfSignature(signature)
        return this.isPromiseType(returnType, typeChecker)
      }
    } catch (e) {
      // The TypeChecker can sometimes fail on complex or malformed code.
      console.error('Error checking call expression signature:', e)
    }

    return false
  }

  /**
   * Recursively traverses the AST, checking each relevant node.
   */
  private visit(
    node: ts.Node,
    tokensBuilder: vscode.SemanticTokensBuilder,
    document: vscode.TextDocument,
    typeChecker: ts.TypeChecker
  ) {
    let identifierNode: ts.Node | undefined

    // Check for function definitions (declarations, methods, expressions)
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      if (this.isFunctionReturningPromise(node, typeChecker)) {
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
      }
    }

    // Check for function calls
    if (ts.isCallExpression(node)) {
      if (this.isPromiseReturningCall(node, typeChecker)) {
        if (ts.isIdentifier(node.expression)) {
          identifierNode = node.expression
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          identifierNode = node.expression.name
        }
      }
    }

    if (identifierNode) {
      this.pushToken(identifierNode, tokensBuilder, document)
    }

    ts.forEachChild(node, (childNode) =>
      this.visit(childNode, tokensBuilder, document, typeChecker)
    )
  }
}
