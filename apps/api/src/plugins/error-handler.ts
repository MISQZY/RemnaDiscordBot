import type { ApiErrorBody } from '@bot/contracts';
import { HttpError, UnknownModuleError } from '@bot/core';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { z } from 'zod';

type Details = NonNullable<ApiErrorBody['error']['details']>;

function zodDetails(error: z.ZodError): Details {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
    message: issue.message,
  }));
}

/** All errors are returned in the common `ApiErrorBody` format. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const send = (statusCode: number, body: Omit<ApiErrorBody['error'], 'requestId'>) =>
      reply.status(statusCode).send({ error: { ...body, requestId: request.id } } satisfies ApiErrorBody);

    if (error instanceof HttpError) {
      return send(error.statusCode, { code: error.code, message: error.message, details: error.details });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return send(400, {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: error.validation.map((v) => ({
          path: v.instancePath.split('/').filter(Boolean),
          message: v.message ?? 'Invalid value',
        })),
      });
    }
    if (error instanceof z.ZodError) {
      return send(400, { code: 'VALIDATION_FAILED', message: 'Validation failed', details: zodDetails(error) });
    }
    if (error instanceof UnknownModuleError) {
      return send(404, { code: 'MODULE_NOT_FOUND', message: error.message });
    }

    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode === 429) {
      return send(429, { code: 'RATE_LIMITED', message: 'Too many requests' });
    }
    if (statusCode < 500 && !isResponseSerializationError(error)) {
      return send(statusCode, { code: statusCode === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED', message: error.message });
    }

    request.log.error({ err: error }, 'Unhandled API error');
    return send(500, { code: 'INTERNAL', message: 'Internal server error' });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found`, requestId: request.id },
    } satisfies ApiErrorBody),
  );
}
