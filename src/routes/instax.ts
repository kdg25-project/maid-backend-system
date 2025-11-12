import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { desc, eq } from 'drizzle-orm'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { instaxes, instaxHistories } from '../../drizzle/schema'
import { buildR2PublicUrl, deleteR2Object, uploadR2Object } from '../libs/storage'
import { adminApiAuthMiddleware } from '../middlewares/adminApiAuth'
import { maidApiAuthMiddleware } from '../middlewares/maidApiAuth'
import type { OpenAPIV3 } from 'openapi-types'

type InstaxRow = typeof instaxes.$inferSelect
type Database = ReturnType<typeof getDb>
const uuidStringSchema = z.string().uuid()
const instaxSchema = z
  .object({
    id: z.number().int().openapi({
      example: 1,
      description: 'Instax identifier.',
    }),
    user_id: z
      .string()
      .uuid()
      .openapi({
        example: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
        description: 'Identifier of the user associated with the instax.',
      }),
    maid_id: z
      .string()
      .uuid()
      .openapi({
        example: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
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

const instaxHistorySchema = z
  .object({
    id: z.number().int().openapi({
      example: 10,
      description: 'Instax history identifier.',
    }),
    instax_id: z.number().int().openapi({
      example: 3,
      description: 'Associated instax record identifier.',
    }),
    user_id: z
      .string()
      .uuid()
      .openapi({
        example: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
        description: 'User identifier linked to the instax history.',
      }),
    maid_id: z
      .string()
      .uuid()
      .openapi({
        example: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
        description: 'Maid identifier linked to the instax history.',
      }),
    image_url: z
      .string()
      .openapi({
        example: 'https://example.com/instax/history/1.jpg',
        description: 'Public URL of the archived instax image.',
      }),
    archived_at: z
      .string()
      .openapi({
        example: '2025-01-10T12:00:00.000Z',
        description: 'Timestamp when the image was archived.',
      }),
  })
  .openapi({
    description: 'Instax history resource representation.',
  })

const instaxHistoryResponseSchema = successResponseSchema(instaxHistorySchema)

const instaxHistoryListResponseSchema = successResponseSchema(
  z.array(instaxHistorySchema).openapi({
    description: 'List of instax history records.',
  }),
)

const mapInstaxHistory = (
  env: AppEnv['Bindings'],
  row: {
    id: number
    instaxId: number
    imageUrl: string
    archivedAt: string
    userId: string
    maidId: string
  },
) => ({
  id: row.id,
  instax_id: row.instaxId,
  user_id: row.userId,
  maid_id: row.maidId,
  image_url: buildR2PublicUrl(env, row.imageUrl),
  archived_at: row.archivedAt,
})

const maidApiSecurityRequirement: OpenAPIV3.SecurityRequirementObject = {
  MaidApiKey: [],
}

const adminApiSecurityRequirement: OpenAPIV3.SecurityRequirementObject = {
  AdminApiKey: [],
}

const createInstaxRecord = async (
  env: AppEnv['Bindings'],
  db: Database,
  params: { userId: string; maidId: string; file: File },
) => {
  const { key } = await uploadR2Object(env, `instax/${params.userId}`, params.file)

  const [inserted] = await db
    .insert(instaxes)
    .values({
      userId: params.userId,
      maidId: params.maidId,
      imageUrl: key,
    })
    .returning()

  if (!inserted) {
    throw new Error('Failed to create instax record.')
  }

  return inserted
}

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
  security: [maidApiSecurityRequirement],
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
    401: {
      description: 'Unauthorized.',
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

const getInstaxByUserRouteDocs = describeRoute({
  tags: ['Instax'],
  summary: 'Fetch instax by user id',
  description: 'Retrieve the most recent instax record for the specified user.',
  parameters: [
    {
      name: 'userId',
      in: 'path',
      required: true,
      description: 'User identifier.',
      schema: {
        type: 'string',
        format: 'uuid',
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
      description: 'Invalid user identifier.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    404: {
      description: 'Instax not found for the specified user.',
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
              type: 'string',
              format: 'uuid',
              description: 'User identifier.',
              example: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
            },
            maid_id: {
              type: 'string',
              format: 'uuid',
              description: 'Maid identifier.',
              example: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
            },
            instax: {
              type: 'string',
              format: 'binary',
              description: 'Instax image file.',
              example: 'instax-sample.jpg',
            },
          },
          required: ['user_id', 'maid_id', 'instax'],
        },
        examples: {
          default: {
            summary: 'Sample instax upload',
            value: {
              user_id: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
              maid_id: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
              instax: 'instax-sample.jpg',
            },
          },
        },
        encoding: {
          instax: {
            contentType: 'image/jpeg',
          },
        },
      },
    },
  },
  security: [maidApiSecurityRequirement],
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

const createInstaxBySeatRouteDocs = describeRoute({
  tags: ['Instax'],
  summary: 'Create an instax by seat',
  description:
    'Upload a new instax image while resolving the user by seat identifier. The most recently updated valid user assigned to the seat is used.',
  requestBody: {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: {
            seat_id: {
              type: 'integer',
              minimum: 1,
              description: 'Seat identifier used to resolve the user.',
              example: 12,
            },
            maid_id: {
              type: 'string',
              format: 'uuid',
              description: 'Maid identifier.',
              example: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
            },
            instax: {
              type: 'string',
              format: 'binary',
              description: 'Instax image file.',
              example: 'instax-seat-sample.jpg',
            },
          },
          required: ['seat_id', 'maid_id', 'instax'],
        },
        examples: {
          default: {
            summary: 'Upload instax using seat reference',
            value: {
              seat_id: 12,
              maid_id: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
              instax: 'instax-seat-sample.jpg',
            },
          },
        },
        encoding: {
          instax: {
            contentType: 'image/jpeg',
          },
        },
      },
    },
  },
  security: [maidApiSecurityRequirement],
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
    404: {
      description: 'Seat has no active user.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const updateInstaxRouteDocs = describeRoute({
  tags: ['Instax'],
  summary: 'Update an instax',
  description: 'Replace the image for an existing instax entry identified by instax id.',
  requestBody: {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: {
            instax_id: {
              type: 'integer',
              minimum: 1,
              description: 'Instax identifier.',
              example: 42,
            },
            instax: {
              type: 'string',
              format: 'binary',
              description: 'New instax image file.',
              example: 'instax-replacement.jpg',
            },
          },
          required: ['instax_id', 'instax'],
        },
        examples: {
          default: {
            summary: 'Replace instax image',
            value: {
              instax_id: 42,
              instax: 'instax-replacement.jpg',
            },
          },
        },
        encoding: {
          instax: {
            contentType: 'image/jpeg',
          },
        },
      },
    },
  },
  security: [maidApiSecurityRequirement],
  responses: {
    200: {
      description: 'Instax updated successfully.',
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
    404: {
      description: 'Instax not found for the provided instax id.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const listUserInstaxHistoryRouteDocs = describeRoute({
  tags: ['Instax'],
  summary: 'List instax history for a user (admin)',
  description: 'Retrieve archived instax images for a specific user. Requires admin API key.',
  parameters: [
    {
      name: 'userId',
      in: 'path',
      required: true,
      description: 'User identifier.',
      schema: {
        type: 'string',
        format: 'uuid',
      },
    },
  ],
  security: [adminApiSecurityRequirement],
  responses: {
    200: {
      description: 'Instax history list retrieved successfully.',
      content: {
        'application/json': {
          schema: resolver(instaxHistoryListResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid user identifier.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    401: {
      description: 'Unauthorized.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const deleteInstaxHistoryRouteDocs = describeRoute({
  tags: ['Instax'],
  summary: 'Delete an instax history record (admin)',
  description: 'Remove an archived instax image. Requires admin API key.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Instax history identifier.',
      schema: {
        type: 'integer',
        minimum: 1,
      },
    },
  ],
  security: [adminApiSecurityRequirement],
  responses: {
    200: {
      description: 'Instax history deleted successfully.',
      content: {
        'application/json': {
          schema: resolver(instaxHistoryResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid history identifier.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    401: {
      description: 'Unauthorized.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    404: {
      description: 'Instax history not found.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

export const registerInstaxRoutes = (app: Hono<AppEnv>) => {
  app.get('/api/instax/:id', maidApiAuthMiddleware, getInstaxRouteDocs, async (c) => {
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

  app.get('/api/users/:userId/instax', getInstaxByUserRouteDocs, async (c) => {
    const userIdParam = c.req.param('userId')

    const userIdResult = uuidStringSchema.safeParse(userIdParam)
    if (!userIdResult.success) {
      return c.json(createErrorResponse('Invalid user id.'), 400)
    }

    const userId = userIdResult.data
    const db = getDb(c.env)
    const instaxRecord = await db.query.instaxes.findFirst({
      where: (fields, { eq }) => eq(fields.userId, userId),
      orderBy: (fields, { desc }) => desc(fields.createdAt),
    })

    if (!instaxRecord) {
      return c.json(createErrorResponse('Instax not found.'), 404)
    }

    return c.json(createSuccessResponse(mapInstax(c.env, instaxRecord)))
  })

  app.post('/api/instax', maidApiAuthMiddleware, createInstaxRouteDocs, async (c) => {
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

    if (typeof userIdRaw !== 'string') {
      return c.json(createErrorResponse('user_id must be provided.'), 400)
    }

    if (typeof maidIdRaw !== 'string') {
      return c.json(createErrorResponse('maid_id must be provided.'), 400)
    }

    const userIdResult = uuidStringSchema.safeParse(userIdRaw.trim())
    if (!userIdResult.success) {
      return c.json(createErrorResponse('user_id must be a valid UUID.'), 400)
    }

    const maidIdResult = uuidStringSchema.safeParse(maidIdRaw.trim())
    if (!maidIdResult.success) {
      return c.json(createErrorResponse('maid_id must be a valid UUID.'), 400)
    }

    if (!(instaxFile instanceof File) || instaxFile.size === 0) {
      return c.json(createErrorResponse('instax file is required.'), 400)
    }

    const userId = userIdResult.data
    const maidId = maidIdResult.data

    const db = getDb(c.env)
    const inserted = await createInstaxRecord(c.env, db, {
      userId,
      maidId,
      file: instaxFile,
    })

    return c.json(
      createSuccessResponse(mapInstax(c.env, inserted), 'Instax created successfully.'),
      201,
    )
  })

  app.post('/api/instax/by-seat', maidApiAuthMiddleware, createInstaxBySeatRouteDocs, async (c) => {
    const contentType = c.req.header('content-type') ?? ''

    if (!contentType.includes('multipart/form-data')) {
      return c.json(
        createErrorResponse('Content-Type must be multipart/form-data.'),
        400,
      )
    }

    const formData = await c.req.parseBody()
    const seatIdRaw = formData['seat_id']
    const maidIdRaw = formData['maid_id']
    const instaxFile = formData['instax']

    if (typeof seatIdRaw !== 'string') {
      return c.json(createErrorResponse('seat_id must be provided.'), 400)
    }

    if (typeof maidIdRaw !== 'string') {
      return c.json(createErrorResponse('maid_id must be provided.'), 400)
    }

    const seatIdValue = Number.parseInt(seatIdRaw.trim(), 10)
    if (!Number.isFinite(seatIdValue) || seatIdValue < 1) {
      return c.json(
        createErrorResponse('seat_id must be a positive integer value.'),
        400,
      )
    }

    const maidIdResult = uuidStringSchema.safeParse(maidIdRaw.trim())
    if (!maidIdResult.success) {
      return c.json(createErrorResponse('maid_id must be a valid UUID.'), 400)
    }

    if (!(instaxFile instanceof File) || instaxFile.size === 0) {
      return c.json(createErrorResponse('instax file is required.'), 400)
    }

    const seatId = seatIdValue
    const maidId = maidIdResult.data
    const db = getDb(c.env)

    const latestUser = await db.query.users.findFirst({
      where: (fields, { eq, and }) =>
        and(eq(fields.seatId, seatId), eq(fields.isValid, true)),
      orderBy: (fields, { desc }) => desc(fields.updatedAt),
    })

    if (!latestUser) {
      return c.json(
        createErrorResponse('No active user found for the provided seat.'),
        404,
      )
    }

    const inserted = await createInstaxRecord(c.env, db, {
      userId: latestUser.id,
      maidId,
      file: instaxFile,
    })

    return c.json(
      createSuccessResponse(mapInstax(c.env, inserted), 'Instax created successfully.'),
      201,
    )
  })

  app.patch('/api/instax', maidApiAuthMiddleware, updateInstaxRouteDocs, async (c) => {
    const contentType = c.req.header('content-type') ?? ''

    if (!contentType.includes('multipart/form-data')) {
      return c.json(
        createErrorResponse('Content-Type must be multipart/form-data.'),
        400,
      )
    }

    const formData = await c.req.parseBody()
    const instaxIdRaw = formData['instax_id']
    const instaxFile = formData['instax']

    if (typeof instaxIdRaw !== 'string') {
      return c.json(createErrorResponse('instax_id must be provided.'), 400)
    }

    const instaxIdValue = Number.parseInt(instaxIdRaw.trim(), 10)
    if (!Number.isFinite(instaxIdValue) || instaxIdValue < 1) {
      return c.json(
        createErrorResponse('instax_id must be a positive integer value.'),
        400,
      )
    }

    if (!(instaxFile instanceof File) || instaxFile.size === 0) {
      return c.json(createErrorResponse('instax file is required.'), 400)
    }

    const instaxId = instaxIdValue
    const db = getDb(c.env)
    const existing = await db.query.instaxes.findFirst({
      where: (fields, { eq }) => eq(fields.id, instaxId),
    })

    if (!existing) {
      return c.json(createErrorResponse('Instax not found.'), 404)
    }

    const previousImageKey = existing.imageUrl
    const { key } = await uploadR2Object(c.env, `instax/${existing.userId}`, instaxFile)

    if (previousImageKey) {
      await db.insert(instaxHistories).values({
        instaxId: existing.id,
        imageUrl: previousImageKey,
      })
    }

    const [updated] = await db
      .update(instaxes)
      .set({ imageUrl: key })
      .where(eq(instaxes.id, existing.id))
      .returning()

    const result = updated ?? { ...existing, imageUrl: key }

    return c.json(
      createSuccessResponse(mapInstax(c.env, result), 'Instax updated successfully.'),
    )
  })

  app.get('/api/admin/users/:userId/instax-history', adminApiAuthMiddleware, listUserInstaxHistoryRouteDocs, async (c) => {
    const userIdParam = c.req.param('userId')

    const userIdResult = uuidStringSchema.safeParse(userIdParam)
    if (!userIdResult.success) {
      return c.json(createErrorResponse('Invalid user id.'), 400)
    }

    const userId = userIdResult.data
    const db = getDb(c.env)

    const rows = await db
      .select({
        id: instaxHistories.id,
        instaxId: instaxHistories.instaxId,
        imageUrl: instaxHistories.imageUrl,
        archivedAt: instaxHistories.archivedAt,
        userId: instaxes.userId,
        maidId: instaxes.maidId,
      })
      .from(instaxHistories)
      .innerJoin(instaxes, eq(instaxHistories.instaxId, instaxes.id))
      .where(eq(instaxes.userId, userId))
      .orderBy(desc(instaxHistories.archivedAt))
      .all()

    const result = rows.map((row) =>
      mapInstaxHistory(c.env, {
        id: row.id,
        instaxId: row.instaxId,
        imageUrl: row.imageUrl,
        archivedAt: row.archivedAt,
        userId: row.userId,
        maidId: row.maidId,
      }),
    )

    return c.json(createSuccessResponse(result))
  })

  app.delete('/api/admin/instax/history/:id', adminApiAuthMiddleware, deleteInstaxHistoryRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid instax history id.'), 400)
    }

    const historyId = Number.parseInt(idParam, 10)
    const db = getDb(c.env)

    const records = await db
      .select({
        id: instaxHistories.id,
        instaxId: instaxHistories.instaxId,
        imageUrl: instaxHistories.imageUrl,
        archivedAt: instaxHistories.archivedAt,
        userId: instaxes.userId,
        maidId: instaxes.maidId,
      })
      .from(instaxHistories)
      .innerJoin(instaxes, eq(instaxHistories.instaxId, instaxes.id))
      .where(eq(instaxHistories.id, historyId))
      .limit(1)
      .all()

    const existing = records[0]

    if (!existing) {
      return c.json(createErrorResponse('Instax history not found.'), 404)
    }

    await db.delete(instaxHistories).where(eq(instaxHistories.id, historyId))
    await deleteR2Object(c.env, existing.imageUrl)

    return c.json(
      createSuccessResponse(
        mapInstaxHistory(c.env, {
          id: existing.id,
          instaxId: existing.instaxId,
          imageUrl: existing.imageUrl,
          archivedAt: existing.archivedAt,
          userId: existing.userId,
          maidId: existing.maidId,
        }),
        'Instax history deleted successfully.',
      ),
    )
  })
}
