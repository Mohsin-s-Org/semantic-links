import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const eslintEntry = process.argv[1];
const requireFromEslint = createRequire(eslintEntry ?? import.meta.url);
const tsParser = requireFromEslint("@typescript-eslint/parser");
const tsPlugin = requireFromEslint("@typescript-eslint/eslint-plugin");
const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

const typedLanguageOptions = {
  parser: tsParser,
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir,
    sourceType: "module"
  }
};

const typedRules = {
  "no-debugger": "error",
  "no-duplicate-imports": "error",
  "prefer-const": "error",
  "@typescript-eslint/consistent-type-imports": ["error", { "prefer": "type-imports" }],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/no-unnecessary-type-assertion": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
  "@typescript-eslint/require-await": "error"
};

export default [
  {
    ignores: ["main.js", "node_modules/**", "coverage/**"]
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: typedLanguageOptions,
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: typedRules
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: typedLanguageOptions,
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      ...typedRules,
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off"
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "prefer-const": "error"
    }
  }
];
