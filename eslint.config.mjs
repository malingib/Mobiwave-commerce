import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
  },
];
