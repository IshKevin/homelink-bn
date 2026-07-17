import "express";

declare global {
    namespace Express {
        interface AuthUser {
            id: string;
            role: "tenant" | "owner" | "agent" | "admin" | "superadmin" | "house_manager";
            email: string;
        }

        interface Request {
            user?: AuthUser;
        }
    }
}

export {};
