import type { ApiErrorBody, ApiErrorCode } from '@bot/contracts';

type ErrorDetails = NonNullable<ApiErrorBody['error']['details']>;

/** Ожидаемая ошибка API: превращается в ответ `{ error: { code, message, details } }`. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
  }

  static badRequest(message: string, details?: ErrorDetails) {
    return new ApiError(400, 'VALIDATION_FAILED', message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Access denied') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static botNotInGuild() {
    return new ApiError(403, 'BOT_NOT_IN_GUILD', 'The bot is not a member of this guild');
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static preconditionFailed(message = 'The resource was modified by someone else') {
    return new ApiError(412, 'PRECONDITION_FAILED', message);
  }

  static discordUnavailable(message = 'Discord API request failed') {
    return new ApiError(502, 'DISCORD_UNAVAILABLE', message);
  }
}
