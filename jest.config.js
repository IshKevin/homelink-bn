/** @type {import('jest').Config} */
module.exports = {
    rootDir: ".",
    testEnvironment: "node",
    testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
    transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }]
    },
    globalSetup: "<rootDir>/tests/globalSetup.ts",
    globalTeardown: "<rootDir>/tests/globalTeardown.ts",
    setupFilesAfterEnv: ["<rootDir>/tests/setupAfterEnv.ts"],
    clearMocks: true,
    testTimeout: 30000,
    maxWorkers: 1
};
