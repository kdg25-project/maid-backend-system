import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { eq } from 'drizzle-orm'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { maids } from '../../drizzle/schema'
import { buildR2PublicUrl, deleteR2Object, uploadR2Object } from '../libs/storage'

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
      },
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Updated maid name.',
            },
            image: {
              type: 'string',
              format: 'binary',
              description: 'Image file for the maid.',
            },
          },
        },
      },
    },
  },
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

    return c.json(createSuccessResponse(mapMaid(c.env, maid)))
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
      createSuccessResponse(mapMaid(c.env, inserted), 'Maid created successfully.'),
      201,
    )
  })

  app.patch('/api/maids/:id', updateMaidRouteDocs, async (c) => {
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

  app.delete('/api/maids/:id', deleteMaidRouteDocs, async (c) => {
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
