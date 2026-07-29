import js from "@eslint/js";

const nodeGlobals = {
  Buffer: "readonly",
  URL: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  process: "readonly",
  setTimeout: "readonly",
};

export default [
  {
    ignores: [".otito/**", "coverage/**", "dist/**", "node_modules/**", "package-lock.json"],
  },
  {
    files: ["src/**/*.js", "tests/**/*.js", "codex/skills/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: nodeGlobals,
      sourceType: "module",
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];
