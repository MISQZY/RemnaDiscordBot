import type { ApiErrorBody, ApiErrorCode } from '@bot/contracts';

export type HttpErrorDetails = NonNullable<ApiErrorBody['error']['details']>;

/**
 * Ожидаемая ошибка HTTP: API превращает её в `{ error: { code, message, details } }`.
 * Модули бросают её из своих роутов (`/v1/guilds/:guildId/modules/<id>/…`).
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
