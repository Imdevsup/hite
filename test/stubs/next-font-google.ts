/**
 * test/stubs/next-font-google.ts — `next/font/google` for vitest.
 *
 * The real module is an SWC-transformed call that only exists inside the Next build, so any
 * component that loads a font cannot be rendered by a node test without this. The stub returns the
 * same shape Next does (`className`, `variable`, `style`) with deterministic names, so SSR tests
 * can render the page and the honesty lint can read its copy. `vitest.config.ts` aliases it.
 */
interface FontHandle {
  readonly className: string;
  readonly variable: string;
  readonly style: { readonly fontFamily: string };
}

interface FontOptions {
  readonly variable?: string;
}

function font(name: string) {
  return (options: FontOptions = {}): FontHandle => ({
    className: `font-${name}`,
    variable: options.variable ? `var-${options.variable.replace(/^--/, "")}` : `font-${name}`,
    style: { fontFamily: name.replace(/_/g, " ") },
  });
}

export const Inter_Tight = font("Inter_Tight");
export const JetBrains_Mono = font("JetBrains_Mono");
export const Instrument_Sans = font("Instrument_Sans");
export const Martian_Mono = font("Martian_Mono");
export const Fraunces = font("Fraunces");
