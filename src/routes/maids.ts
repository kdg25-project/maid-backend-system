import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { maids } from '../../drizzle/schema'

const maidSchema = z
  .object({
    id: z.number().int().openapi({
      example: 1,
      description: 'Unique maid identifier.',
    }),
    name: z.string().openapi({
      example: 'Alice',
      description: 'Maid display name.',
    }),
    image_url: z
      .string()
      .url()
      .nullable()
      .openapi({
        example: 'https://example.com/images/maids/1.jpg',
        description: 'Public URL of the maid image if available.',
        nullable: true,
      }),
  })
  .openapi({
    description: 'Maid resource representation.',
  })

const maidResponseSchema = successResponseSchema(maidSchema)

const createMaidBodySchema = z
  .object({
    name: z
      .string()
      .min(1, { message: 'Name is required.' })
      .openapi({
        example: 'Alice',
        description: 'Name to register for the maid.',
      }),
  })
  .openapi({
    description: 'Payload to create a maid.',
  })

const createMaidResponseSchema = successResponseSchema(maidSchema)

const getMaidRouteDocs = describeRoute({
  tags: ['Maids'],
  summary: 'Fetch a maid',
  description: 'Retrieve a single maid resource by its identifier.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Maid identifier.',
      schema: {
        type: 'integer',
        minimum: 1,
      },
    },
  ],
  responses: {
    200: {
      description: 'Maid found.',
      content: {
        'application/json': {
          schema: resolver(maidResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid identifier supplied.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    404: {
      description: 'Maid not found.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const createMaidRouteDocs = describeRoute({
  tags: ['Maids'],
  summary: 'Create a maid',
  description: 'Register a new maid profile.',
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: resolver(createMaidBodySchema) as unknown as Record<string, unknown>,
      },
    },
  },
  responses: {
    201: {
      description: 'Maid created successfully.',
      content: {
        'application/json': {
          schema: resolver(createMaidResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid request payload.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

export const registerMaidRoutes = (app: Hono<AppEnv>) => {
  app.get('/api/maids/:id', getMaidRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const id = Number.parseInt(idParam, 10)

    const db = getDb(c.env)
    const maid = await db.query.maids.findFirst({
      where: (fields, { eq }) => eq(fields.id, id),
    })

    if (!maid) {
      return c.json(createErrorResponse('Maid not found.'), 404)
    }

    return c.json(
      createSuccessResponse({
        id: maid.id,
        name: maid.name,
        image_url: maid.imageUrl ?? null,
      }),
    )
  })

  app.post('/api/maids', createMaidRouteDocs, async (c) => {
    const body = await c.req
      .json()
      .catch(() => null)
    const parsed = createMaidBodySchema.safeParse(body)

    if (!parsed.success) {
      return c.json(
        createErrorResponse('Invalid request body.', parsed.error.flatten()),
        400,
      )
    }

    const db = getDb(c.env)
    const [inserted] = await db
      .insert(maids)
      .values({
        name: parsed.data.name,
      })
      .returning()

    return c.json(
      createSuccessResponse(
        {
          id: inserted.id,
          name: inserted.name,
          image_url: inserted.imageUrl ?? null,
        },
        'Maid created successfully.',
      ),
      201,
    )
  })
}
