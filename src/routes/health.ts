import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { z } from '../libs/zod'

const healthResponseSchema = z
  .object({
    message: z.string().openapi({
      example: 'Hello Hono!',
      description: 'Greeting returned by the API.',
    }),
  })
  .openapi({
    description: 'Health check response payload.',
  })

const healthRouteDocs = describeRoute({
  tags: ['Health'],
  summary: 'Health check endpoint',
  description: 'Returns a greeting to confirm the API is running.',
  responses: {
    200: {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: resolver(healthResponseSchema),
        },
      },
    },
  },
})

export const registerHealthRoutes = (app: Hono) => {
  app.get('/', healthRouteDocs, (c) => c.json({ message: 'Hello Hono!' }))
}
