// Simple logger for webview (browser context)
// Does NOT use VSCode API

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static logLevel: LogLevel = LogLevel.DEBUG;
  private static showTimestamp: boolean = true;

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
          logMessage += `\n  → Stack:\n${data.stack}`;
        }
      } else if (typeof data === "object") {
        try {
          logMessage += `\n  → Data: ${JSON.stringify(data, null, 2)}`;
        } catch (e) {
          logMessage += `\n  → Data: [Could not stringify object]`;
        }
      } else {
        logMessage += `\n  → ${data}`;
      }
    }

    // Use appropriate console method
    switch (level) {
      case LogLevel.DEBUG:
        console.log(logMessage);
        break;
      case LogLevel.INFO:
        console.info(logMessage);
        break;
      case LogLevel.WARN:
        console.warn(logMessage);
        break;
      case LogLevel.ERROR:
        console.error(logMessage);
        break;
    }
  }

  static setLogLevel(level: LogLevel) {
    this.logLevel = level;
    this.info(`Log level changed to ${LogLevel[level]}`);
  }
}
