import path from "node:path";
import swaggerJsdoc from "swagger-jsdoc";
import { getApiServers } from "./servers";

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: "3.0.3",
        info: {
            title: "HomeLink API",
            version: "1.0.0",
            description:
                "HomeLink is a property rental management platform connecting tenants, property owners, agents, " +
                "and administrators. This document covers accounts, listings, leases, payments, maintenance, " +
                "notifications, dashboards, reports, and admin operations."
        },
        servers: getApiServers("/api/v1"),
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT"
                }
            },
            schemas: {
                ApiError: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: false },
                        message: { type: "string" },
                        errors: { type: "array", items: { type: "object" } }
                    }
                },
                PaginationMeta: {
                    type: "object",
                    properties: {
                        page: { type: "integer", example: 1 },
                        limit: { type: "integer", example: 20 },
                        total: { type: "integer", example: 100 },
                        totalPages: { type: "integer", example: 5 }
                    }
                },
                SuccessResponse: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        message: { type: "string", example: "Success" },
                        data: { type: "object" }
                    }
                },
                PaginatedResponse: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        message: { type: "string", example: "Success" },
                        data: { type: "array", items: { type: "object" } },
                        meta: { $ref: "#/components/schemas/PaginationMeta" }
                    }
                }
            }
        },
        security: [{ bearerAuth: [] }]
    },
    apis: [
        path.join(process.cwd(), "src/modules/**/*.routes.ts"),
        path.join(process.cwd(), "src/modules/**/*.docs.ts"),
        path.join(process.cwd(), "src/routes/*.ts")
    ]
};

export const swaggerSpec = swaggerJsdoc(options);
