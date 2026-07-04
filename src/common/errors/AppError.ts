export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly errors?: unknown;

    constructor(statusCode: number, message: string, errors?: unknown) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        this.errors = errors;
        Object.setPrototypeOf(this, AppError.prototype);
        Error.captureStackTrace(this, this.constructor);
    }

    static badRequest(message = "Bad request", errors?: unknown) {
        return new AppError(400, message, errors);
    }

    static unauthorized(message = "Unauthorized") {
        return new AppError(401, message);
    }

    static forbidden(message = "Forbidden") {
        return new AppError(403, message);
    }

    static notFound(message = "Resource not found") {
        return new AppError(404, message);
    }

    static conflict(message = "Conflict", errors?: unknown) {
        return new AppError(409, message, errors);
    }

    static internal(message = "Internal server error") {
        return new AppError(500, message);
    }
}
