import { HttpError, type HttpErrorDetails } from '@bot/core';

/** API errors: the core `HttpError` plus factories for common cases. */
export class ApiError extends HttpError {
  static override badRequest(message: string, details?: HttpErrorDetails) {
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

  static override notFound(message = 'Not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static preconditionFailed(message = 'The resource was modified by someone else') {
    return new ApiError(412, 'PRECONDITION_FAILED', message);
  }

  static discordUnavailable(message = 'Discord API request failed') {
    return new ApiError(502, 'DISCORD_UNAVAILABLE', message);
  }

  /** Discord answered 429: the user's token has used up its requests for now. */
  static discordRateLimited(retryAfterSec: number) {
    return new ApiError(429, 'RATE_LIMITED', `Discord rate limit, retry in ${Math.ceil(retryAfterSec)}s`);
  }
}
