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
      | 'PAYMENTS_UNAVAILABLE'
      /*
        The identity-verification provider is unreachable or unconfigured.
        503, like PAYMENTS_UNAVAILABLE: retrying the same request will not
        help until an operator acts.
      */
      | 'VERIFICATION_UNAVAILABLE'
      /*
        No SMS credentials, so no code can be sent. 503, for the same
        reason as the two above.
      */
      | 'SMS_UNAVAILABLE'
      /*
        The SMS provider was reached and refused this recipient. 502: the
        failure is theirs, not the caller's, and the provider's own token
        (InvalidPhoneNumber, InvalidSenderId) is logged rather than
        returned - it describes our configuration, and tells the person
        nothing they can act on. See docs/84.
      */
      | 'SMS_SEND_FAILED'
      /* A verification code that was wrong. */
      | 'INVALID_CODE'
      /* A code that expired, was already used, or ran out of attempts. */
      | 'CODE_UNUSABLE'
      /* Consent to be texted, asked for before the number was proved. */
      | 'PHONE_NOT_VERIFIED';
    message: string;
    field?: string;
    requestId: string;
  };
}

export type ApiResult<T = unknown> = ApiResponse<T> | ApiError;
