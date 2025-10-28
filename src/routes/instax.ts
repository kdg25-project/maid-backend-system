import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { instaxes } from '../../drizzle/schema'
import { buildR2PublicUrl, uploadR2Object } from '../libs/storage'

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

const createInstaxRouteDocs = describeRoute({
  tags: ['Instax'],
  summary: 'Create an instax',
  description: 'Upload a new instax image and associate it with a user and maid.',
  requestBody: {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: {
            user_id: {
              type: 'integer',
              minimum: 1,
              description: 'User identifier.',
            },
            maid_id: {
              type: 'integer',
              minimum: 1,
              description: 'Maid identifier.',
            },
            instax: {
              type: 'string',
              format: 'binary',
              description: 'Instax image file.',
            },
          },
          required: ['user_id', 'maid_id', 'instax'],
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Instax created successfully.',
      content: {
        'application/json': {
          schema: resolver(instaxResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid form-data payload.',
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

  app.post('/api/instax', createInstaxRouteDocs, async (c) => {
    const contentType = c.req.header('content-type') ?? ''

    if (!contentType.includes('multipart/form-data')) {
      return c.json(
        createErrorResponse('Content-Type must be multipart/form-data.'),
        400,
      )
    }

    const formData = await c.req.parseBody()
    const userIdRaw = formData['user_id']
    const maidIdRaw = formData['maid_id']
    const instaxFile = formData['instax']

    if (typeof userIdRaw !== 'string' || !/^[1-9]\d*$/.test(userIdRaw)) {
      return c.json(createErrorResponse('user_id must be a positive integer.'), 400)
    }

    if (typeof maidIdRaw !== 'string' || !/^[1-9]\d*$/.test(maidIdRaw)) {
      return c.json(createErrorResponse('maid_id must be a positive integer.'), 400)
    }

    if (!(instaxFile instanceof File) || instaxFile.size === 0) {
      return c.json(createErrorResponse('instax file is required.'), 400)
    }

    const userId = Number.parseInt(userIdRaw, 10)
    const maidId = Number.parseInt(maidIdRaw, 10)

    const { key } = await uploadR2Object(c.env, `instax/${userId}`, instaxFile)

    const db = getDb(c.env)
    const [inserted] = await db
      .insert(instaxes)
      .values({
        userId,
        maidId,
        imageUrl: key,
      })
      .returning()

    return c.json(
      createSuccessResponse(mapInstax(c.env, inserted), 'Instax created successfully.'),
      201,
    )
  })
}
