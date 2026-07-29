/**
 * Operational errors carry a status and a stable machine code. Anything
 * that is not an AppError is a bug and becomes a 500 with no detail leaked.
 */
export class AppError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
/** Step 1 passed but Step 2 has not — session exists, agent not yet bound. */
export const agentNotBound = (message = 'Agent authentication required') => new AppError(401, 'AGENT_NOT_BOUND', message);
export const forbidden = (message = 'Not permitted') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
//# sourceMappingURL=errors.js.map