/**
 * Oblique Enforcement Tests - Principles 9-12
 *
 * These are "chaos" security tests derived from oblique reasoning:
 * they test edge cases that standard security advice doesn't cover.
 *
 * P9  (Economy/salt):   Verify crypto module uses random IV per call
 * P10 (Privilege/mirror): Verify admin verification approval logs reviewer identity
 * P11 (Queries/knot):    Verify ORDER BY rejects injection via column names
 * P12 (Encoding/sponge): Verify sanitize doesn't double-encode on re-render
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── P9: Economy of Mechanism - "salt" oblique ───────────────────────────
// A simple AES-256-GCM call is secure only if the IV is unique per call.
// Two encryptions of the same plaintext MUST produce different ciphertexts.
describe('P9-oblique: AES-256-GCM IV uniqueness', () => {
  it('encrypts the same plaintext to different ciphertexts each time', async () => {
    /*
      This used to `return` early when `SETTINGS_ENCRYPTION_KEY` was unset,
      and log "Skipping". It is unset in every normal run, so a SECURITY
      property - that the IV is unique per call - was never actually checked
      and the test reported a pass for years. Same class as the ten E2E tests
      docs/99 found wrapped in `if (await locator.isVisible())`.

      It also made the test env-coupled in the other direction: a developer
      with a real key in their shell saw it run, and a key of the wrong
      LENGTH made it fail inside `getEncryptionKey` - which is correct
      fail-closed behaviour being reported as a broken test.

      So the test now supplies its own key and always runs. 64 hex chars is
      what `getEncryptionKey` requires (32 bytes for AES-256).
    */
    vi.stubEnv(
      'SETTINGS_ENCRYPTION_KEY',
      randomBytes(32).toString('hex'),
    );
    const { encryptSecret } = await import('@/lib/crypto.server');
    const plaintext = 'test-secret-value-12345';
    const encrypted1 = encryptSecret(plaintext);
    const encrypted2 = encryptSecret(plaintext);

    // Same plaintext, different IV -> different ciphertext
    expect(encrypted1).not.toBe(encrypted2);

    // Both should decrypt to the same value
    const { decryptSecret } = await import('@/lib/crypto.server');
    expect(decryptSecret(encrypted1)).toBe(plaintext);
    expect(decryptSecret(encrypted2)).toBe(plaintext);
  });
});

// ── P10: Separation of Privilege - "mirror" oblique ──────────────────────
// The "mirror" twist: an admin approving their own campaign's verification
// is a single-actor completing a high-risk transaction. The system should
// capture reviewer identity so this can be detected and audited.
describe('P10-oblique: Verification approval captures reviewer identity', () => {
  it('verification review route captures reviewer ID in the update', async () => {
    // Structural test: verify the verification review route stores
    // the reviewer/approver identity for accountability
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(
      process.cwd(),
      'src/app/api/v1/admin/campaigns/[campaignId]/verification/route.ts'
    );

    const content = fs.readFileSync(routePath, 'utf-8');

    // Must store the reviewing admin's identity
    expect(content).toMatch(/verificationReviewerId|reviewerId/);

    // Must create an audit log entry
    expect(content).toMatch(/auditLog|audit_log/i);

    // Verify the route uses requireRole (not just session check)
    expect(content).toContain("requireRole(['admin'])");
  });

  it('campaign schema stores the reviewer identity', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const schemaPath = path.join(process.cwd(), 'src/db/schema.ts');
    const content = fs.readFileSync(schemaPath, 'utf-8');

    // campaigns table must have verificationReviewerId column
    expect(content).toMatch(/verificationReviewerId/);
  });
});

// ── P11: Parameterized Queries - "knot" oblique ─────────────────────────
// The "knot" twist: parameterized queries protect VALUES but NOT identifiers
// (table names, column names, ORDER BY). If user input selects a sort column,
// the column name goes unparameterized into the query.
describe('P11-oblique: ORDER BY injection via column names', () => {
  it('verification queue sort parameter has an allowlist', async () => {
    const fs = await import('fs');
    const path = await import('path');

    // Check the verification queue validator
    const validatorPath = path.join(process.cwd(), 'src/lib/validators/verification.ts');
    const content = fs.readFileSync(validatorPath, 'utf-8');

    // Must have an enum or allowlist for sort fields
    expect(content).toMatch(/sort|orderBy|sortBy/i);
    // Should use z.enum() or a fixed set, not z.string()
    expect(content).toMatch(/z\.enum|\.refine|allowedSort|SORT_FIELDS|sortColumn/i);
  });

  it('no Drizzle query uses raw string interpolation for column names', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { readdirSync, statSync, readFileSync } = fs;

    function walk(dir: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
            results.push(...walk(full));
          } else if (entry.endsWith('.ts') && !entry.includes('.test.')) {
            results.push(full);
          }
        } catch { /* skip */ }
      }
      return results;
    }

    const apiDir = path.join(process.cwd(), 'src/app/api');
    const files = walk(apiDir);

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      // sql.raw() is the primary vector for identifier injection
      const hasSqlRaw = /sql\.raw\(/.test(content);
      if (hasSqlRaw) {
        // This is a violation
        throw new Error(
          `sql.raw() found in ${path.relative(process.cwd(), file)}. ` +
          'This bypasses parameterization and can allow injection via identifiers.'
        );
      }
    }
  });
});

// ── P12: Output Encoding - "sponge" oblique ─────────────────────────────
// The "sponge" twist: if you sanitize at WRITE time and ALSO at READ time,
// HTML entities get double-encoded: & -> &amp; -> &amp;amp;
// The correct approach: sanitize ONCE, at render time only.
describe('P12-oblique: Double-encoding detection', () => {
  it('sanitizeHtml does not double-encode already-safe HTML', async () => {
    const { sanitizeHtml } = await import('@/lib/utils/sanitize');

    const alreadySafe = '<p>Hello &amp; world</p>';
    const result = sanitizeHtml(alreadySafe);

    // DOMPurify should NOT double-encode &amp; to &amp;amp;
    expect(result).not.toContain('&amp;amp;');
    // The & entity should survive intact
    expect(result).toContain('&amp;');
  });

  it('sanitizeHtml strips dangerous tags without affecting safe content', async () => {
    const { sanitizeHtml } = await import('@/lib/utils/sanitize');

    const mixed = '<p>Safe text</p><script>alert("xss")</script><p>More safe</p>';
    const result = sanitizeHtml(mixed);

    expect(result).toContain('<p>Safe text</p>');
    expect(result).toContain('<p>More safe</p>');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
  });

  it('sanitizeHtml strips data: URIs from src attributes', async () => {
    const { sanitizeHtml } = await import('@/lib/utils/sanitize');

    const dataUri = '<img src="data:text/html,<script>alert(1)</script>" alt="xss">';
    const result = sanitizeHtml(dataUri);

    expect(result).not.toContain('data:');
    // Image tag may remain but src should be stripped
    if (result.includes('<img')) {
      expect(result).not.toMatch(/src=["']data:/);
    }
  });

  it('sanitizeHtml strips javascript: URIs from href attributes', async () => {
    const { sanitizeHtml } = await import('@/lib/utils/sanitize');

    const jsUri = '<a href="javascript:alert(1)">click me</a>';
    const result = sanitizeHtml(jsUri);

    expect(result).not.toContain('javascript:');
  });
});
