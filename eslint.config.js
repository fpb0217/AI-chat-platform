import eslint from "@eslint/js";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["apps/web/**/*.{ts,vue}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".vue"],
      },
    },
  },
  {
    files: ["apps/api/**/*.ts", "packages/**/*.ts", "e2e/**/*.ts", "*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "vue/max-attributes-per-line": "off",
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/singleline-html-element-content-newline": "off",
    },
  },
);
