/**
 * Centralized Error Handling System
 *
 * All application errors flow through this module. Internal details are
 * captured for logging/Sentry; only safe, generic messages reach the client.
 */

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import type { ApiError } from '@/types/api';

// ─── Error Code Registry ────────────────────────────────────────────────────

export type ErrorCode = ApiError['error']['code'];

/** Maps error codes to default user-safe messages and HTTP status codes. */
const ERROR_DEFAULTS: Record<ErrorCode, { status: number; message: string }> = {
  VALIDATION_ERROR: { status: 400, message: 'The request contains invalid data.' },
  UNAUTHORIZED: { status: 401, message: 'Authentication required.' },
  FORBIDDEN: { status: 403, message: 'You do not have permission to perform this action.' },
  NOT_FOUND: { status: 404, message: 'The requested resource was not found.' },
  CONFLICT: { status: 409, message: 'This action conflicts with the current state.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please try again later.' },
  INTERNAL_ERROR: { status: 500, message: 'Something went wrong. Please try again later.' },
  CONNECT_NOT_ENABLED: { status: 400, message: 'This feature is not currently available.' },
  PAYMENTS_UNAVAILABLE: {
    status: 503,
    message:
      'Card payments are unavailable right now. This is a problem on our side, not with ' +
      'your card, and nothing has been charged.',
  },
  VERIFICATION_UNAVAILABLE: {
    status: 503,
    message:
      'Identity verification is temporarily unavailable. This is a problem on our side, ' +
      'not with your documents.',
  },
};

// ─── Application Error Classes ──────────────────────────────────────────────

/**
 * Base application error. Carries a user-safe message, an error code, and
 * (optionally) a specific field name for validation errors.
 *
 * Internal details (the original Error) are attached as `cause` and are
 * NEVER sent to the client.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly field?: string;

  constructor(
    code: ErrorCode,
    userMessage?: string,
    opts?: { field?: string; cause?: unknown; statusCode?: number },
  ) {
    const defaults = ERROR_DEFAULTS[code];
    super(userMessage ?? defaults.message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = opts?.statusCode ?? defaults.status;
    this.field = opts?.field;
    if (opts?.cause) this.cause = opts.cause;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string, cause?: unknown) {
    super('VALIDATION_ERROR', message, { field, cause });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message?: string, cause?: unknown) {
    super('NOT_FOUND', message, { cause });
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message?: string, cause?: unknown) {
    super('UNAUTHORIZED', message ?? 'Authentication required.', { cause });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message?: string, cause?: unknown) {
    super('FORBIDDEN', message ?? 'You do not have permission to perform this action.', { cause });
    this.name = 'ForbiddenError';
  }
}

// ─── Error Sanitization ─────────────────────────────────────────────────────

/** Patterns that indicate sensitive content that must NEVER reach the client. */
const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /authorization/i,
  /bearer/i,
  /select\s+.*\s+from/i, // SQL
  /insert\s+into/i,
  /update\s+.*\s+set/i,
  /delete\s+from/i,
  /\/[a-z]+\/[a-z]+\.(ts|js|tsx|jsx)/i, // file paths
  /at\s+\w+\s+\(/i, // stack trace frames
  /node_modules/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /supabase/i,
  /drizzle/i,
  /postgres/i,
  /stripe.*error/i,
  /openrouter/i,
  /resend/i,
];

/**
 * Returns true if a message contains sensitive internal information.
 * Used as a safety net: even if code accidentally passes an internal message,
 * this catches it before it reaches the client.
 */
function containsSensitiveInfo(message: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Sanitize an error message for client consumption.
 * If the message contains sensitive patterns, replace with a generic message.
 */
export function sanitizeErrorMessage(message: string, fallback?: string): string {
  if (containsSensitiveInfo(message)) {
    return fallback ?? ERROR_DEFAULTS.INTERNAL_ERROR.message;
  }
  return message;
}

// ─── Structured Error Logging ───────────────────────────────────────────────

interface ErrorLogContext {
  requestId: string;
  route?: string;
  method?: string;
  userId?: string;
  ip?: string;
  /** Sanitized subset of the request payload (no passwords/tokens). */
  input?: Record<string, unknown>;
}

/** Keys to strip from logged payloads. */
const REDACTED_KEYS = new Set([
  'password', 'passwordHash', 'token', 'secret', 'apiKey', 'api_key',
  'authorization', 'securityToken', 'creditCard', 'cvv', 'ssn',
  'cardNumber', 'securityAnswer',
]);

/** Deep-redact an object for logging (removes sensitive fields). */
export function redactSensitiveFields(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string' && obj.length > 500) return obj.slice(0, 500) + '...[truncated]';
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map((v) => redactSensitiveFields(v, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''))) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSensitiveFields(value, depth + 1);
    }
  }
  return result;
}

/**
 * Log an error with full internal context. Sends to Sentry in production
 * and to console in development. NEVER sends details to the client.
 */
export function logError(error: unknown, routeOrContext: string | ErrorLogContext, extra?: Record<string, unknown>): void {
  const context: ErrorLogContext = typeof routeOrContext === 'string'
    ? { requestId: (extra?.requestId as string) ?? 'unknown', route: routeOrContext, ...extra }
    : routeOrContext;
  const err = error instanceof Error ? error : new Error(String(error));
  const timestamp = new Date().toISOString();

  // Structured log entry for server-side observability
  const logEntry = {
    timestamp,
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    userId: context.userId ?? 'anonymous',
    ip: context.ip ?? 'unknown',
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      cause: err.cause instanceof Error ? err.cause.message : undefined,
    },
    input: context.input ? redactSensitiveFields(context.input) : undefined,
  };

  // Always log to server console (structured JSON in production)
  if (process.env.NODE_ENV === 'production') {
    console.error(JSON.stringify(logEntry));
  } else {
    console.error(`[${context.requestId}] ${context.route ?? 'unknown'} -`, err);
  }

  // Send to Sentry with full context
  Sentry.withScope((scope) => {
    scope.setTag('requestId', context.requestId);
    if (context.route) scope.setTag('route', context.route);
    if (context.method) scope.setTag('method', context.method);
    if (context.userId) scope.setUser({ id: context.userId });
    if (context.ip) scope.setTag('ip', context.ip);
    if (context.input) scope.setExtra('input', redactSensitiveFields(context.input));
    Sentry.captureException(err);
  });
}

// ─── API Response Builder ───────────────────────────────────────────────────

/**
 * Build a safe API error response. This is the ONLY function that should
 * be used to return errors from API routes.
 */
export function apiError(
  code: ErrorCode,
  message: string,
  requestId: string,
  opts?: { status?: number; field?: string },
): NextResponse<ApiError> {
  const defaults = ERROR_DEFAULTS[code];
  const safeMessage = sanitizeErrorMessage(message, defaults.message);

  const body: ApiError = {
    ok: false,
    error: {
      code,
      message: safeMessage,
      requestId,
      ...(opts?.field ? { field: opts.field } : {}),
    },
  };

  return NextResponse.json(body, { status: opts?.status ?? defaults.status });
}

/**
 * Convert any caught error into a safe API response.
 * This is the catch-all handler for API route try/catch blocks.
 */
export function handleApiError(
  error: unknown,
  requestId: string,
  context?: Omit<ErrorLogContext, 'requestId'>,
): NextResponse<ApiError> {
  // Log the full error internally
  logError(error, { requestId, ...context });

  // If it's a known AppError, use its code and safe message
  if (error instanceof AppError) {
    return apiError(error.code, error.message, requestId, {
      status: error.statusCode,
      field: error.field,
    });
  }

  // For auth errors from the existing auth.ts module
  if (error instanceof Error) {
    if (error.name === 'UnauthorizedError') {
      return apiError('UNAUTHORIZED', 'Authentication required.', requestId);
    }
    if (error.name === 'ForbiddenError') {
      return apiError('FORBIDDEN', 'You do not have permission to perform this action.', requestId);
    }
  }

  // Unknown errors: always return generic message
  return apiError('INTERNAL_ERROR', 'Something went wrong. Please try again later.', requestId);
}

// ─── Safe Cron Error Logger ─────────────────────────────────────────────────

/**
 * Extract a safe, non-leaking error message for cron audit logs.
 * Internal details are logged separately; the audit log only gets a category.
 */
export function safeCronError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'An internal error occurred during processing.';
}
