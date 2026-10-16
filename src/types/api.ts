export interface ApiResponse<T = unknown> {
  ok: true;
  data: T;
  meta?: {
    cursor?: string;
    hasMore?: boolean;
  };
}

export interface ApiError {
  ok: false;
  error: {
    code:
      | 'VALIDATION_ERROR'
      | 'UNAUTHORIZED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'RATE_LIMITED'
      | 'INTERNAL_ERROR'
      | 'CONNECT_NOT_ENABLED'
      /*
        The deployment cannot take money at all - a Stripe credential it was
        given does not work - as distinct from one payment failing. Answered
        with 503, because retrying will not help until an operator acts.
      */
      | 'PAYMENTS_UNAVAILABLE';
    message: string;
    field?: string;
    requestId: string;
  };
}

export type ApiResult<T = unknown> = ApiResponse<T> | ApiError;
