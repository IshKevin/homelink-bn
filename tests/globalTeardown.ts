export default async function globalTeardown(): Promise<void> {
    // Connections are closed per-test-file in tests/setupAfterEnv.ts (afterAll).
}
