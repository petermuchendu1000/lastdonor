import { z } from 'zod';

/**
 * What an organiser sends when choosing where their campaign's money goes
 * (`docs/113` §11, screen B3).
 *
 * ⚠️ `accountReference` is the bill or file number AT the institution, and
 * **nothing can check it**. The paybill was confirmed by an admin; this is
 * typed by the organiser. A right paybill with a wrong reference pays a
 * stranger's bill at the right hospital, and M-Pesa reversals are manual,
 * slow and not guaranteed.
 *
 * So the screen asks for it twice and compares the two, and this schema keeps
 * the floor the database CHECK also keeps. Neither is a substitute for the
 * confirmation step in B4.
 */
export const designatePayoutSchema = z.object({
  payoutAccountId: z.string().uuid('Choose a place from the list'),
  accountReference: z
    .string()
    .trim()
    .min(1, 'Enter the number this place uses for the bill')
    .max(80, 'That is longer than any bill number we have seen - please check it'),
});

export type DesignatePayoutInput = z.infer<typeof designatePayoutSchema>;
