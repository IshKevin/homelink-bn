const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**", "coverage/**", "eslint.config.js"]
    },
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
    {
        languageOptions: {
            parserOptions: {
                sourceType: "module"
            }
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
            ],
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-non-null-assertion": "off",
            "no-console": "off"
        }
    }
);
