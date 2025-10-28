import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { instaxes } from '../../drizzle/schema'
import { buildR2PublicUrl } from '../libs/storage'

type InstaxRow = typeof instaxes.$inferSelect

const instaxSchema = z
  .object({
    id: z.number().int().openapi({
      example: 1,
      description: 'Instax identifier.',
    }),
    user_id: z.number().int().openapi({
      example: 101,
      description: 'Identifier of the user associated with the instax.',
    }),
    maid_id: z.number().int().openapi({
      example: 5,
      description: 'Identifier of the maid associated with the instax.',
    }),
    image_url: z
      .string()
      .nullable()
      .openapi({
        example: 'https://example.com/instax/1.jpg',
        description: 'Public URL for the instax image.',
        nullable: true,
      }),
    created_at: z
      .string()
      .openapi({
        example: '2025-01-09T10:00:00.000Z',
        description: 'Creation timestamp in ISO 8601 format.',
      }),
  })
  .openapi({
    description: 'Instax resource representation.',
  })

const instaxResponseSchema = successResponseSchema(instaxSchema)

const mapInstax = (env: AppEnv['Bindings'], instax: InstaxRow) => ({
  id: instax.id,
  user_id: instax.userId,
  maid_id: instax.maidId,
  image_url: instax.imageUrl ? buildR2PublicUrl(env, instax.imageUrl) : null,
  created_at: instax.createdAt,
})

const getInstaxRouteDocs = describeRoute({
  tags: ['Instax'],
  summary: 'Fetch instax by id',
  description: 'Retrieve an instax record by identifier.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Instax identifier.',
      schema: {
        type: 'integer',
        minimum: 1,
      },
    },
  ],
  responses: {
    200: {
      description: 'Instax retrieved successfully.',
      content: {
        'application/json': {
          schema: resolver(instaxResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid instax identifier.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    404: {
      description: 'Instax not found.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

export const registerInstaxRoutes = (app: Hono<AppEnv>) => {
  app.get('/api/instax/:id', getInstaxRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid instax id.'), 400)
    }

    const id = Number.parseInt(idParam, 10)
    const db = getDb(c.env)
    const instaxRecord = await db.query.instaxes.findFirst({
      where: (fields, { eq }) => eq(fields.id, id),
    })

    if (!instaxRecord) {
      return c.json(createErrorResponse('Instax not found.'), 404)
    }

    return c.json(createSuccessResponse(mapInstax(c.env, instaxRecord)))
  })
}
