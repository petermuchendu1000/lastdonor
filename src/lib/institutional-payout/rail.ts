/**
 * ⛔ THE DISBURSEMENT BOUNDARY. NOTHING BEHIND THIS SENDS MONEY, YET.
 *
 * ── WHY THERE IS AN INTERFACE AND NO IMPLEMENTATION ─────────────────────────
 *
 * Every other part of `docs/113` §11 is built: an admin can record a payee,
 * an organiser can choose one, a donor is told, and the organiser's own
 * withdrawal is refused. The single thing missing is the call that moves the
 * money, and it is missing deliberately, for three reasons that all point the
 * same way:
 *
 *   1. **No rail exists.** `src/lib/payhero.ts` exports exactly three
 *      operations - `initiateStkPush`, `getTransactionStatus`,
 *      `getWalletBalance`. Collections only. Whether PayHero can disburse at
 *      all is [UNKNOWN] (`docs/113` §3), and the one probe run against it was
 *      non-discriminating.
 *   2. **`docs/81`, `docs/76` and `docs/77` all say the same thing**: never
 *      ship a provider path nobody has exercised. A guessed payout call is
 *      the worst possible way to discover an API, and this account is shared
 *      with another company (`docs/92`).
 *   3. **§5 is a licensing question**, not an engineering one. Willingness is
 *      not a licence.
 *
 * ── WHAT THIS FILE BUYS ─────────────────────────────────────────────────────
 *
 * A seam that is checked by the compiler instead of remembered. The release
 * route depends on `resolvePayoutRail()`, which returns `null` today, so the
 * route's refusal is structural: there is no code path from the queue to a
 * payment, and adding one means implementing this interface on purpose.
 *
 * ⛔ When a rail IS built, it must be probed the way `docs/92` probed
 * collections - against the real endpoint, reading the real responses -
 * before it is wired here. `docs/92` found four traps in PayHero that its own
 * documentation either omitted or contradicted, including `success: true`
 * arriving beside `status: "FAILED"`.
 */

export interface PayoutInstruction {
  /** Our reference, in the `LD-` namespace that isolates this platform. */
  reference: string;
  /** Minor units of `currency`, never "cents" (`docs/92`). */
  amountMinor: number;
  currency: string;
  /** The institution's destination on the rail, e.g. an M-Pesa paybill. */
  accountIdentifier: string;
  /** The bill number AT that institution. Organiser-typed, unverifiable. */
  accountReference: string;
}

export interface PayoutResult {
  /**
   * ⚠️ `accepted` means the provider took the instruction, NOT that money
   * arrived. `docs/92` observed PayHero returning `success: true` alongside
   * `status: "FAILED"`. Settlement is a separate, later read.
   */
  accepted: boolean;
  /** The PROVIDER's reference. Must be persisted or the payment is unverifiable. */
  providerReference: string | null;
  failureReason: string | null;
}

export interface PayoutRail {
  readonly name: string;
  send(instruction: PayoutInstruction): Promise<PayoutResult>;
}

/**
 * Why no rail is available, in words an admin screen can print.
 *
 * Returned rather than thrown: the queue is still worth looking at, and an
 * admin needs to know which of these is the blocker.
 */
export const NO_RAIL_REASON =
  'No payout rail is connected. The live gateway can collect money but has never been shown to send it, and nothing may be wired until it has been probed against the real endpoint.';

/**
 * The rail, or null.
 *
 * ⛔ Returns `null` unconditionally and that is not a stub to be quietly
 * filled in. Implementing it is a deliberate act that needs: a probed
 * provider, the licensing answer in `docs/113` §5, and a re-read of this
 * file's header.
 */
export function resolvePayoutRail(): PayoutRail | null {
  return null;
}
