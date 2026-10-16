import { NewsletterForm } from './NewsletterForm';

/*
 * `py-20` flat was 80px top and bottom on a 390px phone: 160px of the
 * section's 432px, 37%, before any content. The card inside supplies its own
 * padding, so the section only needs enough to separate it from the band
 * above. See docs/65.
 */
export function Newsletter() {
  return (
    <section id="newsletter" className="bg-surface-amber py-10 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <NewsletterForm />
      </div>
    </section>
  );
}
