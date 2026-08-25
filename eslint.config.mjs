// ESLint flat config (ESLint 9 / Next 16).
//
// Replaces .eslintrc.json. That file had stopped being read at all: `next lint` was removed in
// Next 16 and ESLint 9 only loads flat config by default, so `pnpm lint` exited 1 without linting
// anything — which silently disabled the determinism guard below for an unknown period. The guard
// is the load-bearing part of this file: the EDL reducer, the render compiler and the Remotion
// composition must be pure functions of their input, because IR hashing and segment caching assume
// identical input produces an identical artifact. A stray Math.random()/Date.now() in those paths
// is not a style problem, it silently breaks caching and makes renders unreproducible.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const DETERMINISTIC_PATHS = ["lib/edl/**/*.ts", "lib/render/**/*.{ts,tsx}", "lib/remotion/**/*.{ts,tsx}"];

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-*/**",
      "out/**",
      "coverage/**",
      "sandbox/**",
      // Local scratch work (one-off probes, screenshot scripts). Untracked, imported by nothing, and
      // not held to the repo's rules — but `eslint .` walked into it and failed the gate on a
      // throwaway `let`. Ignored here and in .gitignore so the two agree.
      ".scratch/**",
      "public/registry/manifest.json",
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  {
    files: DETERMINISTIC_PATHS,
    // Tests are exempt: they legitimately need seeded randomness and fixed clocks.
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Non-deterministic: banned in edl/render/remotion paths (breaks IR hashing + segment caching). Use lib/edl/ids.ts.",
        },
        {
          object: "Date",
          property: "now",
          message:
            "Non-deterministic: banned in edl/render/remotion paths. Pass timestamps in from the boundary.",
        },
        {
          object: "crypto",
          property: "randomUUID",
          message:
            "Non-deterministic: use lib/edl/ids.ts, or the envelope ULID minted once at the command boundary.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Non-deterministic new Date(): banned in edl/render/remotion paths.",
        },
        {
          selector: "CallExpression[callee.name='setInterval']",
          message: "Banned in edl/render/remotion paths (non-deterministic timing).",
        },
      ],
    },
  },

  {
    // A test file is never a Next.js page, so the <Image /> advice does not apply to it: the only
    // <img> in the suite is the stub that stands in for Remotion's <Img> while asserting on the
    // props HiteRoot passes (lib/remotion/HiteRoot.render.test.tsx). next/image there would render
    // something the component under test never renders. Scoped off rather than silenced inline so
    // the reason lives in one place; the a11y rules still apply.
    files: ["**/*.test.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
];

export default config;
