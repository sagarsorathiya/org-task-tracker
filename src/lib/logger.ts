// ──────────────────────────────────────────────
// Pino Logger — Structured JSON logging
// ──────────────────────────────────────────────

import pino from 'pino';

const logLevel = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level: logLevel,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  redact: {
    paths: ['password', 'LDAP_BIND_PASSWORD', 'NEXTAUTH_SECRET', 'req.headers.authorization'],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});

export default logger;
