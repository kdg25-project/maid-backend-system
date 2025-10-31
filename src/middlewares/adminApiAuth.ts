import { createMiddleware } from 'hono/factory'
import { createErrorResponse } from '../libs/responses'
import type { AppEnv } from '../types/bindings'

const API_KEY_HEADER = 'x-api-key'

export const adminApiAuthMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const expectedApiKey = c.env.ADMIN_API_PASSWORD

  if (!expectedApiKey) {
    return c.json(
      createErrorResponse('Admin API password is not configured on the server.'),
      500,
    )
  }

  const providedApiKey = c.req.header(API_KEY_HEADER)

  if (providedApiKey !== expectedApiKey) {
    return c.json(
      createErrorResponse('Unauthorized: Missing or invalid x-api-key header.'),
      401,
    )
  }

  await next()
})
