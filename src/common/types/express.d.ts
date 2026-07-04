import "express";

declare global {
    namespace Express {
        interface AuthUser {
            id: string;
            role: "tenant" | "owner" | "agent" | "admin";
            email: string;
        }

        interface Request {
            user?: AuthUser;
        }
    }
}

export {};
