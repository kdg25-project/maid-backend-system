import type { GenerateSpecOptions } from 'hono-openapi'

export const openApiOptions: Partial<GenerateSpecOptions> = {
  documentation: {
    info: {
      title: 'Cafe Backend API',
      description: 'API documentation for the cafe backend service.',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'http://localhost:8787',
        description: 'Local development',
      },
    ],
  },
  exclude: [/^\/docs/],
}
