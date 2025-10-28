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
        url: 'https://api.kdgn.tech',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        MaidApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'メイド管理APIにアクセスするためのAPIキーを指定します。',
        },
      },
    },
  },
  exclude: [/^\/docs/],
}
