import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { eq } from 'drizzle-orm'
import type { OpenAPIV3 } from 'openapi-types'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { maids } from '../../drizzle/schema'
import { buildR2PublicUrl, deleteR2Object, uploadR2Object } from '../libs/storage'
import { maidApiAuthMiddleware } from '../middlewares/maidApiAuth'

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

const maidsListSchema = z.array(maidSchema).openapi({
  description: 'List of maid resources.',
})
const maidsListResponseSchema = successResponseSchema(maidsListSchema)

type Bindings = AppEnv['Bindings']
type MaidRow = typeof maids.$inferSelect

const mapMaid = (env: Bindings, maid: MaidRow) => ({
  id: maid.id,
  name: maid.name,
  image_url: maid.imageUrl ? buildR2PublicUrl(env, maid.imageUrl) : null,
})

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

const updateMaidJsonBodySchema = z
  .object({
    name: z
      .string()
      .min(1, { message: 'Name must not be empty.' })
      .optional()
      .openapi({
        example: 'Alice',
        description: 'Updated maid name.',
      }),
  })
  .refine((payload) => payload.name !== undefined, {
    message: 'At least one field must be provided.',
  })
  .openapi({
    description: 'JSON payload for updating a maid (name only).',
  })

const maidApiSecurityRequirement: OpenAPIV3.SecurityRequirementObject = {
  MaidApiKey: [],
}

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
        examples: {
          default: {
            summary: 'Create maid request',
            value: {
              name: 'Alice',
            },
          },
        },
      },
    },
  },
  security: [maidApiSecurityRequirement],
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
    401: {
      description: 'Unauthorized. Missing or invalid x-api-key header.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const updateMaidRouteDocs = describeRoute({
  tags: ['Maids'],
  summary: 'Update a maid',
  description:
    'Update an existing maid profile. Supports JSON for name updates and multipart form-data when uploading images.',
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
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: resolver(updateMaidJsonBodySchema) as unknown as Record<string, unknown>,
        examples: {
          default: {
            summary: 'Update maid name',
            value: {
              name: 'Alice',
            },
          },
        },
      },
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Updated maid name.',
              example: 'Maid Alice',
            },
            image: {
              type: 'string',
              format: 'binary',
              description: 'Image file for the maid.',
              example: 'maid-alice.jpg',
            },
          },
        },
        examples: {
          default: {
            summary: 'Update maid profile with image',
            value: {
              name: 'Maid Alice',
              image: 'maid-alice.jpg',
            },
          },
        },
        encoding: {
          image: {
            contentType: 'image/jpeg',
          },
        },
      },
    },
  },
  security: [maidApiSecurityRequirement],
  responses: {
    200: {
      description: 'Maid updated successfully.',
      content: {
        'application/json': {
          schema: resolver(maidResponseSchema),
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
    401: {
      description: 'Unauthorized. Missing or invalid x-api-key header.',
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

const deleteMaidRouteDocs = describeRoute({
  tags: ['Maids'],
  summary: 'Delete a maid',
  description: 'Remove a maid profile and associated image assets.',
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
  security: [maidApiSecurityRequirement],
  responses: {
    200: {
      description: 'Maid deleted successfully.',
      content: {
        'application/json': {
          schema: resolver(maidResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid maid identifier provided.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    401: {
      description: 'Unauthorized. Missing or invalid x-api-key header.',
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

export const registerMaidRoutes = (app: Hono<AppEnv>) => {
  app.get('/api/maids', describeRoute({
    tags: ['Maids'],
    summary: 'List maids',
    description: 'Fetch a paginated list of maids.',
    parameters: [
      { name: 'page', in: 'query', required: false, description: 'Page number (1-based).', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'per_page', in: 'query', required: false, description: 'Items per page (max 100).', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      { name: 'is_active', in: 'query', required: false, description: 'Filter by active flag. true returns only active maids, false returns only inactive maids. If omitted defaults to true.', schema: { type: 'boolean', default: true } },
    ],
    responses: {
      200: { description: 'List of maids.', content: { 'application/json': { schema: resolver(maidsListResponseSchema) } } },
      400: { description: 'Invalid query parameters.', content: { 'application/json': { schema: resolver(errorResponseSchema) } } },
    },
  }), async (c) => {
  const pageParam = c.req.query('page') ?? '1'
  const perParam = c.req.query('per_page') ?? c.req.query('perPage') ?? '20'
  const isActiveQuery = c.req.query('is_active') ?? c.req.query('isActive')

    const page = Number.parseInt(String(pageParam), 10)
    const per = Number.parseInt(String(perParam), 10)

    if (!Number.isFinite(page) || page < 1 || !Number.isFinite(per) || per < 1 || per > 100) {
      return c.json(createErrorResponse('Invalid pagination parameters.'), 400)
    }

    let isActiveFilter = true
    if (typeof isActiveQuery !== 'undefined') {
      const val = String(isActiveQuery).trim().toLowerCase()
      if (['true', '1', 'yes'].includes(val)) {
        isActiveFilter = true
      } else if (['false', '0', 'no'].includes(val)) {
        isActiveFilter = false
      } else {
        return c.json(createErrorResponse('Invalid is_active parameter. Use true/false.'), 400)
      }
    }

    const offset = (page - 1) * per
    const db = getDb(c.env)

    const rows = await db
      .select()
      .from(maids)
      .where(eq(maids.isActive, isActiveFilter))
      .limit(per)
      .offset(offset)
      .orderBy(maids.id)
      .all()

    const result = rows.map((r) => mapMaid(c.env, r))

    return c.json(createSuccessResponse(result))
  })

  app.get('/api/maids/:id', getMaidRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const id = Number.parseInt(idParam, 10)

    const db = getDb(c.env)
    const maid = await db.query.maids.findFirst({
      where: (fields, { eq, and }) => and(eq(fields.id, id), eq(fields.isActive, true)),
    })

    if (!maid) {
      return c.json(createErrorResponse('Maid not found.'), 404)
    }

    return c.json(createSuccessResponse(mapMaid(c.env, maid)))
  })

  app.post('/api/maids', maidApiAuthMiddleware, createMaidRouteDocs, async (c) => {
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
      createSuccessResponse(mapMaid(c.env, inserted), 'Maid created successfully.'),
      201,
    )
  })

  app.patch('/api/maids/:id', maidApiAuthMiddleware, updateMaidRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const id = Number.parseInt(idParam, 10)
    const contentType = c.req.header('content-type') ?? ''
    let name: string | undefined
    let imageFile: File | undefined

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.parseBody()
      const maybeName = formData['name']
      if (typeof maybeName === 'string' && maybeName.trim().length > 0) {
        name = maybeName.trim()
      }

      const maybeImage = formData['image']
      if (maybeImage instanceof File && maybeImage.size > 0) {
        imageFile = maybeImage
      }

      if (!name && !imageFile) {
        return c.json(createErrorResponse('No updatable fields provided.'), 400)
      }
    } else {
      const body = await c.req
        .json()
        .catch(() => null)
      const parsed = updateMaidJsonBodySchema.safeParse(body)

      if (!parsed.success) {
        return c.json(
          createErrorResponse('Invalid request body.', parsed.error.flatten()),
          400,
        )
      }

      name = parsed.data.name?.trim()
    }

    const db = getDb(c.env)
    const existing = await db.query.maids.findFirst({
      where: (fields, { eq }) => eq(fields.id, id),
    })

    if (!existing) {
      return c.json(createErrorResponse('Maid not found.'), 404)
    }

    const updateValues: Partial<typeof maids.$inferInsert> = {}

    if (name) {
      updateValues.name = name
    }

    if (imageFile) {
      const { key } = await uploadR2Object(c.env, `maids/${id}`, imageFile)
      await deleteR2Object(c.env, existing.imageUrl)
      updateValues.imageUrl = key
      existing.imageUrl = key
    }

    if (name) {
      existing.name = name
    }

    if (Object.keys(updateValues).length === 0) {
      return c.json(
        createSuccessResponse(mapMaid(c.env, existing), 'No changes applied.'),
      )
    }

    const [updated] = await db
      .update(maids)
      .set(updateValues)
      .where(eq(maids.id, id))
      .returning()

    const result = updated ?? { ...existing, ...updateValues }

    return c.json(
      createSuccessResponse(mapMaid(c.env, result), 'Maid updated successfully.'),
    )
  })

  app.delete('/api/maids/:id', maidApiAuthMiddleware, deleteMaidRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const id = Number.parseInt(idParam, 10)
    const db = getDb(c.env)

    const existing = await db.query.maids.findFirst({
      where: (fields, { eq }) => eq(fields.id, id),
    })

    if (!existing) {
      return c.json(createErrorResponse('Maid not found.'), 404)
    }

    await db.delete(maids).where(eq(maids.id, id))
    await deleteR2Object(c.env, existing.imageUrl)

    return c.json(
      createSuccessResponse(mapMaid(c.env, existing), 'Maid deleted successfully.'),
    )
  })
}
