/**
 * Rule documentation links.
 *
 * The docs site does not exist yet, so by default we emit NO docsUrl rather than
 * shipping links that 404 — dead links would undercut the whole "explainable
 * output" promise. When the site is live, set the base (here or via
 * RN_GUARDIAN_DOCS_BASE) and every rule link lights up at once.
 */
const DOCS_BASE = process.env.RN_GUARDIAN_DOCS_BASE ?? "";

/** URL for a rule's docs, or undefined while no docs base is configured. */
export function docs(slug: string): string | undefined {
  if (!DOCS_BASE) return undefined;
  return `${DOCS_BASE.replace(/\/$/, "")}/${slug}`;
}
