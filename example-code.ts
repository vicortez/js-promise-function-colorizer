const aaaa = async () => {
  return new Promise()
}

aaaa()
// ==================== POSITIVE CASES (Should be highlighted) ====================

// 1. Async function declarations
async function fetchUserData() {
  return await fetch('/api/user')
}

async function processData(data: any) {
  return data.map((x) => x.value)
}

// 2. Functions with explicit Promise return type
function loadConfig(): Promise<any> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({}), 1000)
  })
}

function getData(): Promise<string[]> {
  return fetch('/api/data').then((r) => r.json())
}

// 3. Functions that return Promise constructors
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeRequest() {
  return Promise.resolve({ status: 'ok' })
}

// 4. Arrow functions - async
const asyncArrowFunc = async () => {
  return await fetch('/test')
}

const promiseArrowFunc = (): Promise<void> => {
  return Promise.resolve()
}

const implicitPromiseArrow = () => {
  return new Promise((resolve) => resolve(true))
}

// 5. Class methods - async and Promise-returning
class DataService {
  async fetchUsers() {
    return await fetch('/users')
  }

  async saveUser(user: any) {
    return fetch('/users', { method: 'POST', body: JSON.stringify(user) })
  }

  loadSettings(): Promise<any> {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ theme: 'dark' }), 500)
    })
  }

  getCache(): Promise<string> {
    return Promise.resolve('cached-data')
  }

  // Static async method
  static async initialize() {
    return await this.loadInitialData()
  }

  static loadInitialData(): Promise<any> {
    return fetch('/init')
  }
}

// 6. Function calls that should be highlighted
async function testCalls() {
  // Calls to our async functions
  await fetchUserData() // Should highlight 'fetchUserData'
  await processData([]) // Should highlight 'processData'
  await loadConfig() // Should highlight 'loadConfig'
  await getData() // Should highlight 'getData'
  await delay(1000) // Should highlight 'delay'
  await makeRequest() // Should highlight 'makeRequest'
  await asyncArrowFunc() // Should highlight 'asyncArrowFunc'
  await promiseArrowFunc() // Should highlight 'promiseArrowFunc'
  await implicitPromiseArrow() // Should highlight 'implicitPromiseArrow'

  // Method calls on class instances
  const service = new DataService()
  await service.fetchUsers() // Should highlight 'fetchUsers'
  await service.saveUser({}) // Should highlight 'saveUser'
  await service.loadSettings() // Should highlight 'loadSettings'
  await service.getCache() // Should highlight 'getCache'

  // Static method calls
  await DataService.initialize() // Should highlight 'initialize'
  await DataService.loadInitialData() // Should highlight 'loadInitialData'

  // Common async APIs
  await fetch('/api/test') // Should highlight 'fetch'
  fetch('/api/test2') // Should highlight 'fetch' (even without await)

  // Promise static methods
  await Promise.resolve(42) // Should highlight 'resolve'
  await Promise.reject('err') // Should highlight 'reject'
  await Promise.all([]) // Should highlight 'all'
  await Promise.race([]) // Should highlight 'race'

  // Promise instance methods
  const promise = fetch('/test')
  promise.then((r) => r.json()) // Should highlight 'then'
  promise.catch((err) => {}) // Should highlight 'catch'
  promise.finally(() => {}) // Should highlight 'finally'
}

// ==================== NEGATIVE CASES (Should NOT be highlighted) ====================

// 1. Regular synchronous functions
function calculateSum(a: number, b: number) {
  return a + b
}

function formatString(str: string): string {
  return str.toLowerCase()
}

function processArray(arr: any[]) {
  return arr.filter((x) => x.active)
}

// 2. Functions with non-Promise return types
function getNumber(): number {
  return 42
}

function getObject(): { name: string } {
  return { name: 'test' }
}

function getArray(): string[] {
  return ['a', 'b', 'c']
}

// 3. Regular arrow functions
const syncArrowFunc = (x: number) => x * 2

const stringArrowFunc = (): string => {
  return 'hello'
}

const voidArrowFunc = () => {
  console.log('side effect')
}

// 4. Synchronous class methods
class Calculator {
  add(a: number, b: number): number {
    return a + b
  }

  multiply(x: number, y: number) {
    return x * y
  }

  getVersion(): string {
    return '1.0.0'
  }

  static createInstance() {
    return new Calculator()
  }

  static getDefaultValue(): number {
    return 0
  }
}

// 5. Regular function calls and method invocations
function testSyncCalls() {
  // Calls to synchronous functions
  calculateSum(1, 2) // Should NOT highlight 'calculateSum'
  formatString('TEST') // Should NOT highlight 'formatString'
  processArray([]) // Should NOT highlight 'processArray'
  getNumber() // Should NOT highlight 'getNumber'
  getObject() // Should NOT highlight 'getObject'
  getArray() // Should NOT highlight 'getArray'
  syncArrowFunc(5) // Should NOT highlight 'syncArrowFunc'
  stringArrowFunc() // Should NOT highlight 'stringArrowFunc'
  voidArrowFunc() // Should NOT highlight 'voidArrowFunc'

  // Synchronous method calls
  const calc = new Calculator()
  calc.add(1, 2) // Should NOT highlight 'add'
  calc.multiply(3, 4) // Should NOT highlight 'multiply'
  calc.getVersion() // Should NOT highlight 'getVersion'

  // Static method calls
  Calculator.createInstance() // Should NOT highlight 'createInstance'
  Calculator.getDefaultValue() // Should NOT highlight 'getDefaultValue'

  // Built-in synchronous methods
  console.log('test') // Should NOT highlight 'log'
  Math.max(1, 2, 3) // Should NOT highlight 'max'
  JSON.stringify({}) // Should NOT highlight 'stringify'
  Array.from([1, 2, 3]) // Should NOT highlight 'from'
  Object.keys({}) // Should NOT highlight 'keys'
}

// 6. Variable assignments and other constructs
const regularVar = 'string'
const numberVar = 42
const objectVar = { key: 'value' }
const arrayVar = [1, 2, 3]

// Regular object methods that aren't promises
const utils = {
  format(str: string) {
    return str.trim()
  },

  parse(data: string) {
    return JSON.parse(data)
  },
}

// 7. Edge cases that might be confusing
function notActuallyAsync() {
  // This contains promise-related keywords but doesn't return a promise
  const promise = 'this is just a string'
  const then = 'also just a string'
  console.log(promise, then)
  return 'not a promise'
}

function mentionsPromiseButSync() {
  // Mentions Promise in comments but isn't async
  // This function creates a Promise but doesn't return it
  new Promise((resolve) => resolve(42))
  return 'sync result'
}

// Test the edge cases
function testEdgeCases() {
  notActuallyAsync() // Should NOT highlight
  mentionsPromiseButSync() // Should NOT highlight
  utils.format('  test  ') // Should NOT highlight 'format'
  utils.parse('{"a": 1}') // Should NOT highlight 'parse'
}
