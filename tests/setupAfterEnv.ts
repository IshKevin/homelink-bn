import { closeDb, resetDb } from "./helpers/db";

afterEach(async () => {
    await resetDb();
});

afterAll(async () => {
    await closeDb();
});
