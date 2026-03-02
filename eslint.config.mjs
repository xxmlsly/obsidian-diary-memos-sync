// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        console: "readonly",
        window: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: ["Memos", "DailyNotes", "Obsidian"],
          ignoreRegex: ["^YYYY", "HH:mm", "⚠️"],
          allowAutoFix: true,
        },
      ],
    },
  },
]);
