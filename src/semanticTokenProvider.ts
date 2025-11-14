import * as ts from 'typescript'
import * as vscode from 'vscode'

// These are the token types and modifiers we will be using
const tokenTypes = ['promiseFunction']
const tokenModifiers: string[] = []
export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers)

export class DocumentSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  private readonly promiseReturningFunctions = new Set<string>()
  private readonly promiseReturningMethods = new Map<string, Set<string>>()
  private readonly instanceToClass = new Map<string, string>()
  private readonly objectToPromiseMethods = new Map<string, Set<string>>()

  private program: ts.Program | undefined
  private typeChecker: ts.TypeChecker | undefined

  public async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens> {
    // Clear previous collections
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

    // Create TypeScript program for type checking
    this.createTypeScriptProgram(document, sourceFile)

    // First pass: collect promise-returning function definitions AND instance variables
    this.collectPromiseFunctions(sourceFile)
    this.collectInstanceVariables(sourceFile)
    this.collectObjectLiterals(sourceFile)

    // Second pass: highlight both definitions and calls
    this.visit(sourceFile, tokensBuilder, document)

    return tokensBuilder.build()
  }

  private createTypeScriptProgram(document: vscode.TextDocument, sourceFile: ts.SourceFile) {
    try {
      const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        lib: ['ES2020', 'DOM', 'DOM.Iterable', 'ES6'],
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        allowJs: true,
        declaration: false,
        skipLibCheck: false,
        types: [],
        typeRoots: ['node_modules/@types'],
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
      }

      // Get the directory of the current file
      const path = require('path')
      const currentDir = path.dirname(document.fileName)

      // Create a proper compiler host that can read files
      const host = ts.createCompilerHost(compilerOptions, true)

      // Override getSourceFile to use our in-memory version for the current file
      const originalGetSourceFile = host.getSourceFile
      host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        if (fileName === document.fileName) {
          return sourceFile
        }
        // Use the default implementation for other files (including node_modules)
        return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      }

      // Set the current directory properly
      host.getCurrentDirectory = () => currentDir

      // Create program with the proper host
      this.program = ts.createProgram([document.fileName], compilerOptions, host)
      this.typeChecker = this.program.getTypeChecker()
    } catch (error) {
      this.program = undefined
      this.typeChecker = undefined
    }
  }

  private isPromiseType(type: ts.Type): boolean {
    if (!this.typeChecker) {
      return false
    }

    try {
      // Check if the type symbol is Promise
      const symbol = type.getSymbol()
      if (symbol?.getName() === 'Promise') {
        return true
      }

      // Check if it's a union type that includes Promise
      if (type.isUnion()) {
        return type.types.some((t) => this.isPromiseType(t))
      }

      // Check type string representation
      const typeString = this.typeChecker.typeToString(type)
      if (typeString.startsWith('Promise<') || typeString === 'Promise') {
        return true
      }

      // Check if it has .then method (duck typing for thenable objects)
      const thenProperty = type.getProperty('then')
      if (thenProperty) {
        const thenType = this.typeChecker.getTypeOfSymbolAtLocation(
          thenProperty,
          thenProperty.valueDeclaration || thenProperty.declarations?.[0]!
        )
        // Check if .then is a function
        const signatures = this.typeChecker.getSignaturesOfType(thenType, ts.SignatureKind.Call)
        return signatures.length > 0
      }

      return false
    } catch (error) {
      return false
    }
  }

  private isFunctionReturningPromise(node: ts.FunctionLikeDeclaration): boolean {
    // Fast checks first
    // 1. Check for async keyword (always reliable + cheap)
    if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)) {
      return true
    }

    // 2. Check explicit Promise return type annotation (always reliable + cheap)
    if (node.type) {
      const returnTypeText = node.type.getText()
      if (returnTypeText.startsWith('Promise<') || returnTypeText === 'Promise') {
        return true
      }
    }

    // 3. Check for promise returns in function body (cheap + reliable)
    if (this.hasPromiseReturnPattern(node)) {
      return true
    }

    // 4. Use type checker as last resort (expensive + potentially buggy)
    if (this.typeChecker && this.program) {
      // Method 1: Try getSignatureFromDeclaration (works for function declarations)
      try {
        const signature = this.typeChecker.getSignatureFromDeclaration(node)
        if (signature) {
          try {
            const returnType = this.typeChecker.getReturnTypeOfSignature(signature)
            if (this.isPromiseType(returnType)) {
              return true
            }
          } catch (error) {
            // Continue to next method
          }
        }
      } catch (error) {
        // Continue to next method
      }

      // Method 2: Get function type directly (works better for arrow functions)
      try {
        const functionType = this.typeChecker.getTypeAtLocation(node)
        const callSignatures = this.typeChecker.getSignaturesOfType(
          functionType,
          ts.SignatureKind.Call
        )

        for (const callSignature of callSignatures) {
          try {
            const returnType = this.typeChecker.getReturnTypeOfSignature(callSignature)
            if (this.isPromiseType(returnType)) {
              return true
            }
          } catch (error) {
            // Continue to next signature
          }
        }
      } catch (error) {
        // Type checker failed, return false
      }
    }

    return false
  }

  private hasPromiseReturnPattern(node: ts.FunctionLikeDeclaration): boolean {
    // Handle arrow function expression bodies: () => someFunc()
    if (ts.isArrowFunction(node) && node.body && !ts.isBlock(node.body)) {
      // Expression body - check if the expression returns a promise
      return this.isExpressionReturningPromise(node.body)
    }

    // Handle block bodies with explicit return statements
    if (node.body && ts.isBlock(node.body)) {
      return this.hasPromiseReturnStatement(node.body, node)
    }

    return false
  }

  private hasPromiseReturnStatement(
    block: ts.Block,
    originalFunction: ts.FunctionLikeDeclaration
  ): boolean {
    let hasPromiseReturn = false

    const visit = (n: ts.Node) => {
      // Look for return statements
      if (ts.isReturnStatement(n) && n.expression) {
        if (this.isExpressionReturningPromise(n.expression)) {
          hasPromiseReturn = true
          return
        }
      }

      // Don't traverse into nested functions
      if (
        n !== originalFunction &&
        (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))
      ) {
        return
      }

      ts.forEachChild(n, visit)
    }

    visit(block)
    return hasPromiseReturn
  }

  private isExpressionReturningPromise(expression: ts.Expression): boolean {
    // Check if it's "new Promise(...)"
    if (
      ts.isNewExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'Promise'
    ) {
      return true
    }

    // Check if it's "Promise.resolve(...)" or similar static Promise methods
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

    // Check if it's returning result of await
    if (ts.isAwaitExpression(expression)) {
      return true
    }

    return false
  }

  private isKnownPromiseReturningCall(callExpression: ts.CallExpression): boolean {
    // Check for direct function calls
    if (ts.isIdentifier(callExpression.expression)) {
      const functionName = callExpression.expression.text

      // Known global promise-returning functions
      if (functionName === 'fetch') {
        return true
      }

      // Functions we've already identified as promise-returning
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

        // Methods we've identified as promise-returning
        let methods = this.promiseReturningMethods.get(objectName)
        if (methods?.has(methodName)) {
          return true
        }

        // Instance methods
        const className = this.instanceToClass.get(objectName)
        if (className) {
          methods = this.promiseReturningMethods.get(className)
          if (methods?.has(methodName)) {
            return true
          }
        }

        // Object literal methods
        const objectMethods = this.objectToPromiseMethods.get(objectName)
        if (objectMethods?.has(methodName)) {
          return true
        }
      }
    }

    return false
  }

  private isPromiseReturningCall(node: ts.CallExpression): boolean {
    // Fast checks first: Check our collected data
    // 1. Direct function calls we've identified
    if (ts.isIdentifier(node.expression)) {
      const functionName = node.expression.text
      if (functionName === 'fetch' || this.promiseReturningFunctions.has(functionName)) {
        return true
      }
    }

    // 2. Method calls from our collected data
    if (ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text
      const objectExpression = node.expression.expression

      if (ts.isIdentifier(objectExpression)) {
        const objectName = objectExpression.text

        // Check direct class reference (e.g., DataService.staticMethod())
        let methods = this.promiseReturningMethods.get(objectName)
        if (methods?.has(methodName)) {
          return true
        }

        // Check instance variable (e.g., service.method())
        const className = this.instanceToClass.get(objectName)
        if (className) {
          methods = this.promiseReturningMethods.get(className)
          if (methods?.has(methodName)) {
            return true
          }
        }

        // Check object literal with promise methods
        const objectMethods = this.objectToPromiseMethods.get(objectName)
        if (objectMethods?.has(methodName)) {
          return true
        }

        // Check for Promise static methods
        if (objectName === 'Promise') {
          return true
        }

        // Try to check the method return type directly if type checker is available
        if (this.typeChecker && !objectMethods) {
          try {
            // Get the type of the object
            const objectType = this.typeChecker.getTypeAtLocation(objectExpression)

            // Get the property (method) from the object type
            const methodSymbol = this.typeChecker.getPropertyOfType(objectType, methodName)

            if (methodSymbol) {
              // Get the type of the method
              const methodType = this.typeChecker.getTypeOfSymbolAtLocation(
                methodSymbol,
                node.expression
              )

              // Get call signatures of the method
              const signatures = this.typeChecker.getSignaturesOfType(
                methodType,
                ts.SignatureKind.Call
              )

              // Check if any signature returns a Promise
              for (const sig of signatures) {
                const returnType = this.typeChecker.getReturnTypeOfSignature(sig)
                if (this.isPromiseType(returnType)) {
                  // Cache this for future use
                  if (!this.objectToPromiseMethods.has(objectName)) {
                    this.objectToPromiseMethods.set(objectName, new Set())
                  }
                  this.objectToPromiseMethods.get(objectName)!.add(methodName)
                  return true
                }
              }
            }
          } catch (error) {
            // Fall through to next check
          }
        }
      }
    }

    // 3. Only use expensive type checker for unknown cases
    if (this.typeChecker) {
      try {
        const type = this.typeChecker.getTypeAtLocation(node)
        if (this.isPromiseType(type)) {
          return true
        }
      } catch (error) {
        // Type checker failed, but we tried cheaper methods first
      }
    }

    return false
  }

  private collectObjectLiterals(node: ts.Node) {
    // Handle: const obj = { someFunc }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      if (ts.isIdentifier(node.name)) {
        const objectName = node.name.text
        const promiseMethods = new Set<string>()

        for (const property of node.initializer.properties) {
          if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            let propertyName: string | undefined
            let referencedFunction: string | undefined

            if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
              propertyName = property.name.text
              if (ts.isIdentifier(property.initializer)) {
                referencedFunction = property.initializer.text
              }
            } else if (ts.isShorthandPropertyAssignment(property)) {
              propertyName = property.name.text
              referencedFunction = property.name.text
            }

            if (
              propertyName &&
              referencedFunction &&
              this.promiseReturningFunctions.has(referencedFunction)
            ) {
              promiseMethods.add(propertyName)
            }
          }

          // Handle method definitions in object literals: { async someMethod() {} }
          if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name)) {
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

    // Handle function calls that return objects with async methods
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      if (ts.isIdentifier(node.name)) {
        const variableName = node.name.text

        // Check if this is a chained call like userEvent.setup()
        if (ts.isPropertyAccessExpression(node.initializer.expression)) {
          const methodName = node.initializer.expression.name.text
          const objectExpr = node.initializer.expression.expression

          // For userEvent.setup(), collect async methods from the return type
          if (ts.isIdentifier(objectExpr)) {
            const asyncMethods = this.getAsyncMethodsFromReturnType(node.initializer)
            if (asyncMethods.size > 0) {
              this.objectToPromiseMethods.set(variableName, asyncMethods)
            }
          }
        } else {
          // Regular function call
          const asyncMethods = this.getAsyncMethodsFromReturnType(node.initializer)
          if (asyncMethods.size > 0) {
            this.objectToPromiseMethods.set(variableName, asyncMethods)
          }
        }
      }
    }

    ts.forEachChild(node, (childNode) => this.collectObjectLiterals(childNode))
  }

  private getAsyncMethodsFromReturnType(callExpression: ts.CallExpression): Set<string> {
    const asyncMethods = new Set<string>()

    if (!this.typeChecker) {
      return asyncMethods
    }

    try {
      // Get the signature of the function being called
      const signature = this.typeChecker.getResolvedSignature(callExpression)
      if (!signature) {
        // Try getting type directly
        const type = this.typeChecker.getTypeAtLocation(callExpression)
        return this.getAsyncMethodsFromType(type)
      }

      // Get the return type of the function
      const returnType = this.typeChecker.getReturnTypeOfSignature(signature)
      if (!returnType) {
        return asyncMethods
      }

      return this.getAsyncMethodsFromType(returnType)
    } catch (error) {
      // Ignore errors, return empty set
    }

    return asyncMethods
  }

  private getAsyncMethodsFromType(type: ts.Type): Set<string> {
    const asyncMethods = new Set<string>()

    if (!this.typeChecker || !type) {
      return asyncMethods
    }

    try {
      // Get the apparent type (this resolves type aliases and intersections)
      const apparentType = this.typeChecker.getApparentType(type)

      // Get all properties including those from mapped types
      const properties = this.typeChecker.getPropertiesOfType(apparentType)

      // Also check for string index signatures (for mapped types)
      const stringIndexType = this.typeChecker.getIndexTypeOfType(apparentType, ts.IndexKind.String)

      for (const property of properties) {
        const propertyName = property.getName()

        // Skip certain properties
        if (propertyName.startsWith('__') || propertyName === 'constructor') {
          continue
        }

        // Get the type of the property
        const propertyType = this.typeChecker.getTypeOfSymbolAtLocation(
          property,
          property.valueDeclaration || property.declarations?.[0]!
        )

        // Check if it's a function
        const callSignatures = this.typeChecker.getSignaturesOfType(
          propertyType,
          ts.SignatureKind.Call
        )

        for (const callSig of callSignatures) {
          const methodReturnType = this.typeChecker.getReturnTypeOfSignature(callSig)

          // Check if return type is a Promise
          if (this.isPromiseType(methodReturnType)) {
            asyncMethods.add(propertyName)
            break
          }
        }
      }

      // If we have a string index type, check if it returns promises
      if (stringIndexType) {
        const callSignatures = this.typeChecker.getSignaturesOfType(
          stringIndexType,
          ts.SignatureKind.Call
        )

        for (const sig of callSignatures) {
          const returnType = this.typeChecker.getReturnTypeOfSignature(sig)
          if (this.isPromiseType(returnType)) {
            // We found that indexed properties return promises
            // but we can't enumerate them, so we need a different strategy
            // Let's check the base type more carefully
            const baseSymbol = type.getSymbol()
            if (baseSymbol) {
              // Try to get the original declaration
              const declarations = baseSymbol.getDeclarations()
              // This might help us understand the structure better
            }
          }
        }
      }
    } catch (error) {
      // Error getting async methods from type
    }

    return asyncMethods
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
      if (this.isPromiseReturningCall(node)) {
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