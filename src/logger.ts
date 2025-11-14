import * as vscode from 'vscode'

class Logger {
  private static _instance: Logger
  private readonly channel: vscode.OutputChannel

  private constructor() {
    // Create a new output channel with a specific name
    this.channel = vscode.window.createOutputChannel('Promise Colorizer')

    // Log a silent initialization message to ensure the channel exists
    this.channel.appendLine(
      `[${new Date().toLocaleTimeString()}] Promise Colorizer output channel initialized`
    )
  }

  public static get instance(): Logger {
    if (!Logger._instance) {
      Logger._instance = new Logger()
    }
    return Logger._instance
  }

  /**
   * Force initialization of the logger (creates the output channel)
   */
  public static initialize(): void {
    // Simply accessing the instance will create it if it doesn't exist
    Logger.instance
  }

  /**
   * Shows the output channel to the user
   */
  public show(): void {
    this.channel.show(true)
  }

  /**
   * Logs a message to the output channel.
   */
  public log(message: string, ...data: any[]): void {
    const timestamp = new Date().toLocaleTimeString()
    this.channel.appendLine(`[${timestamp}] ${message}`)
    if (data.length > 0) {
      data.forEach((item) => {
        const formattedData = JSON.stringify(item, null, 2)
        this.channel.appendLine(formattedData)
      })
    }
  }

  /**
   * Logs an error message and automatically shows the output channel.
   */
  public error(message: string, error?: any): void {
    this.log(`ERROR: ${message}`)
    if (error) {
      if (error instanceof Error) {
        this.log('Error Details:', { name: error.name, message: error.message, stack: error.stack })
      } else {
        this.log('Error Details:', error)
      }
    }
    this.channel.show(true)
  }

  /**
   * Logs a debug message (only in development)
   */
  public debug(message: string, ...data: any[]): void {
    this.log(`DEBUG: ${message}`, ...data)
  }

  /**
   * Logs an info message without showing the channel
   */
  public info(message: string, ...data: any[]): void {
    this.log(`INFO: ${message}`, ...data)
  }
}

// Export the singleton instance and force its creation immediately
export const logger = Logger.instance

// Also export the class for the initialize method
export { Logger }
