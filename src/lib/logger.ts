type LogMeta = Record<string, unknown> | undefined;
type Level = 'info' | 'warn' | 'error';

const isProd = process.env.NODE_ENV === 'production';

function write(level: Level, message: string, meta?: LogMeta) {
  const console_ = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (isProd) {
    console_(JSON.stringify({ level, message, meta, time: new Date().toISOString() }));
    return;
  }

  console_(`[${level.toUpperCase()}] ${message}`, meta ?? '');
}

export const logger = {
  info: (message: string, meta?: LogMeta) => write('info', message, meta),
  warn: (message: string, meta?: LogMeta) => write('warn', message, meta),
  error: (message: string, meta?: LogMeta) => write('error', message, meta),
};
