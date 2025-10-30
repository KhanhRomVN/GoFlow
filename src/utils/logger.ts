import * as vscode from "vscode";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static outputChannel: vscode.OutputChannel | undefined;
  private static logLevel: LogLevel = LogLevel.DEBUG;
  private static showTimestamp: boolean = true;

  static initialize(level: LogLevel = LogLevel.DEBUG) {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel("GoFlow");
    }
    this.logLevel = level;
  }

  static debug(message: string, data?: any) {
    this.log(LogLevel.DEBUG, message, data);
  }

  static info(message: string, data?: any) {
    this.log(LogLevel.INFO, message, data);
  }

  static warn(message: string, data?: any) {
    this.log(LogLevel.WARN, message, data);
  }

  static error(message: string, error?: any) {
    this.log(LogLevel.ERROR, message, error);
  }

  private static log(level: LogLevel, message: string, data?: any) {
    if (!this.outputChannel) {
      this.initialize();
    }

    if (level < this.logLevel) {
      return;
    }

    const timestamp = this.showTimestamp ? `[${new Date().toISOString()}]` : "";
    const levelStr = LogLevel[level].padEnd(5);
    let logMessage = `${timestamp} [${levelStr}] ${message}`;

    if (data !== undefined) {
      if (data instanceof Error) {
        logMessage += `\n  → Error: ${data.message}`;
        if (data.stack) {
          logMessage += `\n  → Stack:\n${data.stack
            .split("\n")
            .map((line) => `    ${line}`)
            .join("\n")}`;
        }
      } else if (typeof data === "object") {
        try {
          logMessage += `\n  → Data: ${JSON.stringify(data, null, 2)
            .split("\n")
            .map((line, idx) => (idx === 0 ? line : `    ${line}`))
            .join("\n")}`;
        } catch (e) {
          logMessage += `\n  → Data: [Could not stringify object]`;
        }
      } else {
        logMessage += `\n  → ${data}`;
      }
    }

    this.outputChannel!.appendLine(logMessage);
  }

  static show() {
    if (this.outputChannel) {
      this.outputChannel.show();
    }
  }

  static clear() {
    if (this.outputChannel) {
      this.outputChannel.clear();
    }
  }

  static dispose() {
    if (this.outputChannel) {
      this.outputChannel.dispose();
      this.outputChannel = undefined;
    }
  }

  static setLogLevel(level: LogLevel) {
    this.logLevel = level;
    this.info(`Log level changed to ${LogLevel[level]}`);
  }

  static setShowTimestamp(show: boolean) {
    this.showTimestamp = show;
  }
}
