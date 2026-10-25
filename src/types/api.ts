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
        The campaign is denominated in a currency the platform has no rail
        for. 503, like PAYMENTS_UNAVAILABLE: the donor can do nothing about
        it and a retry cannot succeed until an operator enables the currency
        in `src/lib/money/currencies.ts`.
      */
      | 'CURRENCY_UNSUPPORTED'
      /*
        The currency is supported, but not by the gateway the donor reached.
        A KES campaign sent to the card checkout, or a USD campaign sent to
        the M-Pesa route. 400, not 503: the request is answerable, just on a
        different endpoint, and the client knows which from the campaign.
      */
      | 'WRONG_PAYMENT_RAIL'
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
      | 'PHONE_NOT_VERIFIED'
      /*
        An unverified campaign has raised everything it may raise before
        verification, so no donation to it can succeed right now. 409: the
        caller did nothing wrong and nothing they change about this request
        will help - the campaign's organiser must get verified.
        See `src/lib/campaign-raise-cap.ts`.
      */
      | 'CAP_REACHED'
      /*
        This particular donation would carry an unverified campaign past its
        pre-verification cap, but a smaller one still fits. 409 with the
        remaining headroom named in the message.
      */
      | 'CAP_EXCEEDED'
      /*
        ── Institutional vouches (docs/108) ──────────────────────────────
        One vocabulary, shared with `src/lib/trust-network/decide.ts`,
        rather than a mapping table between its codes and these - a
        mapping is one more place for the two to drift.
      */
      /* The organisation is suspended, so it cannot vouch. 409. */
      | 'INSTITUTION_SUSPENDED'
      /*
        The organisation has used its whole rolling vouch budget. 429:
        this is a rate limit, and the same request later - or after an
        admin raises the limit - can succeed.
      */
      | 'INSTITUTION_BUDGET_SPENT'
      /* The campaign's status does not admit a vouch. 409. */
      | 'CAMPAIGN_STATE'
      /*
        The campaign's verification does not admit a vouch - usually
        because it is already verified, so a vouch would add nothing or
        would be a downgrade. 409.
      */
      | 'VERIFICATION_STATE'
      /* This organisation already has a live vouch for this campaign. 409. */
      | 'ALREADY_VOUCHED'
      /* The vouch being revoked was already revoked. 409. */
      | 'ALREADY_REVOKED';
    message: string;
    field?: string;
    requestId: string;
  };
}

export type ApiResult<T = unknown> = ApiResponse<T> | ApiError;
