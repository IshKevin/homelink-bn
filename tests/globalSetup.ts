import { execSync } from "node:child_process";
import dotenv from "dotenv";

export default async function globalSetup(): Promise<void> {
    dotenv.config({ path: ".env.test" });
    execSync("npx drizzle-kit push --force", {
        stdio: "inherit",
        env: process.env
    });
}
