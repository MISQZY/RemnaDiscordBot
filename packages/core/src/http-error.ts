import type { ApiErrorBody, ApiErrorCode } from '@bot/contracts';

export type HttpErrorDetails = NonNullable<ApiErrorBody['error']['details']>;

/**
 * An expected HTTP error: the API turns it into `{ error: { code, message, details } }`.
 * Modules throw it from their routes (`/v1/guilds/:guildId/modules/<id>/…`).
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: HttpErrorDetails,
  ) {
    super(message);
  }

  static badRequest(message: string, details?: HttpErrorDetails) {
    return new HttpError(400, 'VALIDATION_FAILED', message, details);
  }

  static notFound(message = 'Not found') {
    return new HttpError(404, 'NOT_FOUND', message);
  }

  /** An action that would make the bot post or act in Discord, while the module is disabled in the guild. */
  static moduleDisabled(moduleId: string) {
    return new HttpError(409, 'MODULE_DISABLED', `Module "${moduleId}" is disabled in this guild`);
  }

  /** The module works only in guilds with VIP, and this one has none. */
  static vipRequired(moduleId: string) {
    return new HttpError(403, 'VIP_REQUIRED', `Module "${moduleId}" needs VIP in this guild`);
  }

  static tooManyRequests(message: string) {
    return new HttpError(429, 'RATE_LIMITED', message);
  }
}
