import request from "supertest";
import app from "../../src/app";

export function testRequest() {
    return request(app);
}
