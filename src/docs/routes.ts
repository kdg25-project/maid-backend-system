import type { Hono } from 'hono'
import { swaggerUI } from '@hono/swagger-ui'
import { openAPIRouteHandler } from 'hono-openapi'
import { openApiOptions } from './config'
import type { AppEnv } from '../types/bindings'

const OPENAPI_JSON_ROUTE = '/docs/openapi.json'

export const registerDocsRoutes = (app: Hono<AppEnv>) => {
  app.get(
    '/docs',
    swaggerUI({
      title: 'Cafe Backend API Docs',
      url: OPENAPI_JSON_ROUTE,
    }),
  )

  app.get(
    OPENAPI_JSON_ROUTE,
    openAPIRouteHandler(app, {
      ...openApiOptions,
    }),
  )
}
