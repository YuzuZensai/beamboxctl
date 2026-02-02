/**
 * Log severity levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARNING = 2,
  ERROR = 3,
}

/**
 * Types of events that can be logged
 */
export enum LogEventType {
  SCAN_START = "scan_start",
  DEVICE_FOUND = "device_found",
  CONNECT_START = "connect_start",
  CONNECTED = "connected",
  DISCOVER_CHAR = "discover_char",
  STATUS_WAIT = "status_wait",
  STATUS_RECEIVED = "status_received",
  IMAGE_INFO_SEND = "image_info_send",
  DATA_SEND_START = "data_send_start",
  DATA_SEND_PROGRESS = "data_send_progress",
  DATA_SEND_COMPLETE = "data_send_complete",
  GENERIC = "generic",
}

/**
 * A single log entry
 */
export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: number;
  eventType?: LogEventType;
  data?: any;
};

/**
 * Logger class for handling application logging with severity levels and event tracking.
 * Supports console output at different levels (DEBUG, INFO, WARNING, ERROR) and
 * provides a listener system for external log processing.
 */
class Logger {
  private level: LogLevel = LogLevel.WARNING;
  private listeners: Set<(entry: LogEntry) => void> = new Set();

  /**
   * Sets the minimum log level to output. Messages below this level will be ignored.
   * @param level Minimum log level (DEBUG, INFO, WARNING, or ERROR)
   */
  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Registers a callback to be invoked for each log entry that meets the minimum level.
   * @param listener Callback function that receives the log entry
   * @returns Unsubscribe function to remove the listener
   */
  public onLog(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Internal logging method that processes log entries based on current level.
   * Outputs to appropriate console method and notifies all listeners.
   * @private
   * @param level Severity level of the log entry
   * @param message Log message text
   * @param eventType Optional event type for categorization
   * @param data Optional additional data associated with the log entry
   */
  private log(
    level: LogLevel,
    message: string,
    eventType?: LogEventType,
    data?: any,
  ): void {
    if (this.level <= level) {
      const timestamp = Date.now();
      const entry: LogEntry = { level, message, timestamp, eventType, data };

      const levelNames = ["DEBUG", "INFO", "WARNING", "ERROR"];
      const levelName = levelNames[level];
      const output = `[${levelName}] ${message}`;

      switch (level) {
        case LogLevel.DEBUG:
          console.debug(output);
          break;
        case LogLevel.INFO:
          console.log(output);
          break;
        case LogLevel.WARNING:
          console.warn(output);
          break;
        case LogLevel.ERROR:
          console.error(output);
          break;
      }

      this.listeners.forEach((listener) => listener(entry));
    }
  }

  /**
   * Logs a debug message. Only output if log level is DEBUG or lower.
   * @param message Debug message text
   * @param eventType Optional event type for categorization
   * @param data Optional additional data associated with this log entry
   */
  public debug(message: string, eventType?: LogEventType, data?: any): void {
    this.log(LogLevel.DEBUG, message, eventType, data);
  }

  /**
   * Logs an info message. Only output if log level is INFO or lower.
   * @param message Info message text
   * @param eventType Optional event type for categorization
   * @param data Optional additional data associated with this log entry
   */
  public info(message: string, eventType?: LogEventType, data?: any): void {
    this.log(LogLevel.INFO, message, eventType, data);
  }

  /**
   * Logs a warning message. Only output if log level is WARNING or lower.
   * @param message Warning message text
   * @param eventType Optional event type for categorization
   * @param data Optional additional data associated with this log entry
   */
  public warning(message: string, eventType?: LogEventType, data?: any): void {
    this.log(LogLevel.WARNING, message, eventType, data);
  }

  /**
   * Logs an error message. Always output regardless of log level.
   * @param message Error message text
   * @param eventType Optional event type for categorization
   * @param data Optional additional data associated with this log entry
   */
  public error(message: string, eventType?: LogEventType, data?: any): void {
    this.log(LogLevel.ERROR, message, eventType, data);
  }
}

/**
 * Global logger instance for application-wide logging.
 */
export const logger = new Logger();
