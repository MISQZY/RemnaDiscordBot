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
}
