import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger };

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
  bindings?: Record<string, unknown>;
}

export function createLogger({
  service,
  level = process.env.LOG_LEVEL ?? 'info',
  pretty = process.env.NODE_ENV !== 'production',
  bindings = {},
}: CreateLoggerOptions): Logger {
  const options: LoggerOptions = {
    level,
    base: { service, ...bindings },
    timestamp: pino.stdTimeFunctions.isoTime,
    // discord.js puts the body of a failed request on its error: a bot avatar or banner as a data URI (megabytes), files.
    redact: {
      paths: [
        'err.requestBody', 'error.requestBody',
        'authorization', 'token', 'secret', 'password', 'cookie',
        '*.authorization', '*.token', '*.secret', '*.password', '*.cookie',
        'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]',
        'request.headers.authorization', 'request.headers.cookie', 'request.headers["x-api-key"]',
        'headers["set-cookie"]', 'res.headers["set-cookie"]',
        'err.headers.authorization', 'error.headers.authorization',
      ],
      censor: '[redacted]',
    },
  };

  if (!pretty) return pino(options);

  return pino({
    ...options,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
    },
  });
}
