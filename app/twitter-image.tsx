/**
 * Twitter/X card image for `/` — re-exports the OpenGraph image generator so the
 * link unfurl is identical across OG and Twitter (one image source, no drift).
 * Next.js picks up `twitter-image` by filename convention and emits the
 * `twitter:image` + `twitter:image:alt` tags; `summary_large_image` is set in
 * the metadata (app/layout.tsx). Spec: LANDING-SPEC-RECONCILED §6 P0-#6.
 */
export { default, alt, size, contentType } from "./opengraph-image";
