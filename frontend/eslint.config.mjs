import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated PWA / Workbox artifacts
    "public/sw.js",
    "public/workbox-*.js",
    "public/sw.js.map",
    "public/workbox-*.js.map",
    "public/fallback-*.js",
    // Test artifacts
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
  ]),
  {
    rules: {
      // Generated PWA files are ignored above. Remaining page-level `any` and
      // loadX-before-useEffect patterns are warnings so CI stays green while
      // repositories + critical paths are typed strictly.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react/no-unescaped-entities": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
  // Repositories and pure libs: enforce no-explicit-any as errors (Phase D)
  {
    files: [
      "src/lib/repositories/**/*.{ts,tsx}",
      "src/lib/calculations.ts",
      "src/lib/offline-cache.ts",
      "src/lib/features.ts",
      "src/lib/password-policy.ts",
      "src/lib/platform-auth.ts",
      "src/lib/rate-limit.ts",
      "src/lib/errors.ts",
      "src/lib/trip-constants.ts",
      "src/lib/csp.ts",
      "src/components/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]);

export default eslintConfig;
