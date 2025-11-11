import type { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { desc, eq, inArray } from 'drizzle-orm'
import type { OpenAPIV3 } from 'openapi-types'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { instaxes, maids, users } from '../../drizzle/schema'
import { buildR2PublicUrl, deleteR2Object, uploadR2Object } from '../libs/storage'
import { maidApiAuthMiddleware } from '../middlewares/maidApiAuth'
import { mapUser, userSchema } from './users'

const maidSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .openapi({
        example: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
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
    is_instax_available: z
      .boolean()
      .openapi({
        example: true,
        description: 'Indicates whether the maid can handle instax/cheki requests.',
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

const maidEngagementStateSchema = z
  .enum(['serving', 'leaving'])
  .openapi({
    description: 'Derived engagement state. `leaving` when the user status equals "leaving" (case-insensitive), otherwise `serving`.',
    example: 'serving',
  })

const maidEngagementFilterSchema = z
  .enum(['serving', 'leaving', 'both'])
  .openapi({
    description: 'Query filter for engagement state. `both` returns every assigned user while still tagging each row.',
    example: 'both',
  })

const maidAssignedUserSchema = userSchema
  .extend({
    engagement_state: maidEngagementStateSchema,
  })
  .openapi({
    description: 'User assigned to a maid together with the derived engagement state.',
  })

const maidAssignedUsersResponseSchema = successResponseSchema(
  z
    .object({
      maid_id: z
        .string()
        .uuid()
        .openapi({
          example: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
          description: 'Target maid identifier.',
        }),
      status_filter: maidEngagementFilterSchema,
      users: z
        .array(maidAssignedUserSchema)
        .openapi({
          description: 'Users assigned to the maid that satisfy the filter.',
        }),
    })
    .openapi({
      description: 'Assigned users grouped by engagement state.',
    }),
)

type Bindings = AppEnv['Bindings']
type Database = ReturnType<typeof getDb>
type MaidRow = typeof maids.$inferSelect
type MaidAssignedUserRow = typeof users.$inferSelect
type MaidEngagementState = z.infer<typeof maidEngagementStateSchema>

const maidIdParamSchema = z.string().uuid()

const mapMaid = (env: Bindings, maid: MaidRow) => ({
  id: maid.id,
  name: maid.name,
  image_url: maid.imageUrl ? buildR2PublicUrl(env, maid.imageUrl) : null,
  is_instax_available: Boolean(maid.isInstaxAvailable),
  is_active: Boolean(maid.isActive),
})

const deriveEngagementState = (status: string | null | undefined): MaidEngagementState => {
  if (!status) {
    return 'serving'
  }

  return status.trim().toLowerCase() === 'leaving' ? 'leaving' : 'serving'
}

const mapMaidAssignedUser = (user: MaidAssignedUserRow, instaxId: number | null) => {
  const mapped = mapUser(user, { instaxId })
  return {
    ...mapped,
    honorific: mapped.honorific ?? null,
    engagement_state: deriveEngagementState(user.status ?? null),
  }
}

const fetchLatestInstaxIdsForUsers = async (db: Database, userIds: string[]) => {
  if (userIds.length === 0) {
    return {}
  }

  const rows = await db
    .select({
      id: instaxes.id,
      userId: instaxes.userId,
      createdAt: instaxes.createdAt,
    })
    .from(instaxes)
    .where(inArray(instaxes.userId, userIds))
    .orderBy(desc(instaxes.createdAt))
    .all()

  const map: Record<string, number> = {}
  for (const row of rows) {
    if (map[row.userId] === undefined) {
      map[row.userId] = row.id
    }
  }

  return map
}

const createMaidBodySchema = z
  .object({
    name: z
      .string()
      .min(1, { message: 'Name must not be empty when provided.' })
      .optional()
      .openapi({
        example: 'Alice',
        description: 'Optional name to register for the maid. Can be provided later via update.',
      }),
    is_instax_available: z
      .boolean()
      .optional()
      .openapi({
        example: true,
        description: 'Whether the maid can handle instax/cheki requests. Defaults to false.',
        default: false,
      }),
  })
  .openapi({
    description: 'Payload to create a maid. All fields are optional.',
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
    is_instax_available: z
      .boolean()
      .optional()
      .openapi({
        example: false,
        description: 'Updated instax/cheki availability flag.',
      }),
  })
  .refine(
    (payload) => payload.name !== undefined || payload.is_instax_available !== undefined,
    {
      message: 'At least one field must be provided.',
    },
  )
  .openapi({
    description: 'JSON payload for updating a maid.',
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
        type: 'string',
        format: 'uuid',
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
  description:
    'Register a new maid profile by specifying the identifier up front. Optional fields such as name and instax availability can be provided later; instax availability defaults to false when omitted.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Maid identifier to reserve.',
      schema: {
        type: 'string',
        format: 'uuid',
      },
    },
  ],
  requestBody: {
    required: false,
    content: {
      'application/json': {
        schema: resolver(createMaidBodySchema) as unknown as Record<string, unknown>,
        examples: {
          default: {
            summary: 'Create maid placeholder with instax flag',
            value: {
              is_instax_available: true,
            },
          },
          minimal: {
            summary: 'Create maid placeholder without optional fields',
            value: {},
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
      description: 'Invalid request payload or identifier.',
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
    409: {
      description: 'Maid identifier already exists.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const listMaidAssignedUsersRouteDocs = describeRoute({
  tags: ['Maids'],
  summary: 'List assigned users for a maid',
  description:
    'Returns the users currently assigned to the specified maid. A user is treated as `leaving` when their status is "leaving" (case-insensitive); any other status is treated as `serving`.',
  security: [maidApiSecurityRequirement],
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Maid identifier.',
      schema: {
        type: 'string',
        format: 'uuid',
      },
    },
    {
      name: 'status',
      in: 'query',
      required: false,
      description:
        'Filter assigned users by engagement state. Accepts `serving`, `leaving`, or `both` (default).',
      schema: {
        type: 'string',
        enum: ['serving', 'leaving', 'both'],
        default: 'both',
      },
    },
  ],
  responses: {
    200: {
      description: 'Assigned users retrieved successfully.',
      content: {
        'application/json': {
          schema: resolver(maidAssignedUsersResponseSchema),
          examples: {
            default: {
              summary: 'Assigned users including honorific',
              value: {
                success: true,
                message: 'Assigned users retrieved successfully.',
                data: {
                  maid_id: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
                  status_filter: 'both',
                  users: [
                    {
                      id: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
                      name: 'John Doe',
                      honorific: 'ご主人様',
                      status: 'Enjoying parfait.',
                      maid_id: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
                      instax_maid_id: null,
                      instax_id: 42,
                      seat_id: 7,
                      is_valid: true,
                      created_at: '2025-01-15T10:00:00.000Z',
                      updated_at: '2025-01-15T12:00:00.000Z',
                      engagement_state: 'serving',
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    400: {
      description: 'Invalid identifier or status filter supplied.',
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
      description: 'Maid not found.',
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
        type: 'string',
        format: 'uuid',
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
            is_instax_available: {
              type: 'boolean',
              description: 'Flag indicating if the maid can handle instax/cheki requests.',
              example: true,
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
        type: 'string',
        format: 'uuid',
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

const toggleMaidActiveBodySchema = z
  .object({
    is_active: z.boolean().openapi({
      description: 'Whether the maid should be active (true) or inactive (false).',
      example: true,
    }),
  })
  .openapi({
    description: 'Payload to change maid active flag.',
  })

const toggleMaidActiveBodyValidator = validator('json', toggleMaidActiveBodySchema, (result, c) => {
  if (!result.success) {
    const fallback = toggleMaidActiveBodySchema.safeParse((result as { data: unknown }).data)
    return c.json(
      createErrorResponse(
        'Invalid request body.',
        fallback.success ? undefined : fallback.error.flatten(),
      ),
      400,
    )
  }
})

const toggleMaidActiveRouteDocs = describeRoute({
  tags: ['Maids'],
  summary: 'Toggle maid active flag',
  description: 'Set the maid\'s isActive flag',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Maid identifier.',
      schema: { type: 'string', format: 'uuid' },
    },
  ],
  requestBody: {
    required: true,
    description: 'Payload to change maid active flag.',
  } as OpenAPIV3.RequestBodyObject,
  security: [maidApiSecurityRequirement],
  responses: {
    200: { description: 'Maid updated successfully.', content: { 'application/json': { schema: resolver(maidResponseSchema) } } },
    400: { description: 'Invalid request.', content: { 'application/json': { schema: resolver(errorResponseSchema) } } },
    401: { description: 'Unauthorized.', content: { 'application/json': { schema: resolver(errorResponseSchema) } } },
    404: { description: 'Maid not found.', content: { 'application/json': { schema: resolver(errorResponseSchema) } } },
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
      {
        name: 'is_active',
        in: 'query',
        required: false,
        description: 'Filter by active flag. true returns only active maids, false returns only inactive maids. When omitted no filtering is applied.',
        schema: { type: 'boolean' },
      },
    ],
    responses: {
      200: { description: 'List of maids.', content: { 'application/json': { schema: resolver(maidsListResponseSchema) } } },
      400: { description: 'Invalid query parameters.', content: { 'application/json': { schema: resolver(errorResponseSchema) } } },
    },
  }), async (c) => {
    try {
      const pageParam = c.req.query('page') ?? '1'
      const perParam = c.req.query('per_page') ?? c.req.query('perPage') ?? '20'
      const isActiveQuery = c.req.query('is_active') ?? c.req.query('isActive')

      const page = Number.parseInt(String(pageParam), 10)
      const per = Number.parseInt(String(perParam), 10)

      if (!Number.isFinite(page) || page < 1 || !Number.isFinite(per) || per < 1 || per > 100) {
        return c.json(createErrorResponse('Invalid pagination parameters.'), 400)
      }

      let isActiveFilter: boolean | undefined
      // なんか冗長で嫌いだけどまぁ、いいか
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

      const rows =
        typeof isActiveFilter === 'undefined'
          ? await db
              .select()
              .from(maids)
              .limit(per)
              .offset(offset)
              .orderBy(maids.id)
              .all()
          : await db
              .select()
              .from(maids)
              .where(eq(maids.isActive, isActiveFilter))
              .limit(per)
              .offset(offset)
              .orderBy(maids.id)
              .all()

      const result = rows.map((r) => mapMaid(c.env, r))

      return c.json(createSuccessResponse(result))
    } catch (err: any) {
      // Log for diagnostics
      console.error('GET /api/maids error:', err)
  const debug = (c.env as any)?.DEBUG === '1' || c.req.header('x-debug') === '1'
      const message = debug ? String(err?.message ?? err) : 'Internal Server Error'
      return c.json(createErrorResponse(message), 500)
    }
  })

  app.get('/api/maids/:id', getMaidRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    const idResult = maidIdParamSchema.safeParse(idParam)
    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const id = idResult.data

    const db = getDb(c.env)
    const maid = await db.query.maids.findFirst({
      where: (fields, { eq }) => eq(fields.id, id),
    })

    if (!maid) {
      return c.json(createErrorResponse('Maid not found.'), 404)
    }

    return c.json(createSuccessResponse(mapMaid(c.env, maid)))
  })

  app.get('/api/maids/:id/users', maidApiAuthMiddleware, listMaidAssignedUsersRouteDocs, async (c) => {
    const idParam = c.req.param('id')
    const idResult = maidIdParamSchema.safeParse(idParam)

    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const rawStatusQuery = c.req.query('status')
    const normalizedStatusQuery = rawStatusQuery ? rawStatusQuery.trim().toLowerCase() : ''
    const statusInput = normalizedStatusQuery.length > 0 ? normalizedStatusQuery : 'both'
    const statusResult = maidEngagementFilterSchema.safeParse(statusInput)

    if (!statusResult.success) {
      return c.json(
        createErrorResponse('Invalid status filter. Use serving, leaving, or both.'),
        400,
      )
    }

    const maidId = idResult.data
    const statusFilter = statusResult.data
    const db = getDb(c.env)

    const maid = await db.query.maids.findFirst({
      where: (fields, { eq }) => eq(fields.id, maidId),
    })

    if (!maid) {
      return c.json(createErrorResponse('Maid not found.'), 404)
    }

    const assignedUsers = await db.query.users.findMany({
      where: (fields, { eq, and }) => and(eq(fields.maidId, maidId), eq(fields.isValid, true)),
      orderBy: (fields, { desc }) => desc(fields.updatedAt),
    })

    const userIds = assignedUsers.map((user) => user.id)
    const latestInstaxMap = await fetchLatestInstaxIdsForUsers(db, userIds)

    const usersByFilter = assignedUsers
      .map((user) => mapMaidAssignedUser(user, latestInstaxMap[user.id] ?? null))
      .filter((user) => statusFilter === 'both' || user.engagement_state === statusFilter)

    return c.json(
      createSuccessResponse({
        maid_id: maidId,
        status_filter: statusFilter,
        users: usersByFilter,
      }),
    )
  })

  app.post('/api/maids/:id', maidApiAuthMiddleware, createMaidRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    const idResult = maidIdParamSchema.safeParse(idParam)
    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const body = await c.req
      .json()
      .catch(() => ({}))

    const payload = body ?? {}
    const parsed = createMaidBodySchema.safeParse(payload)

    if (!parsed.success) {
      return c.json(
        createErrorResponse('Invalid request body.', parsed.error.flatten()),
        400,
      )
    }

    const id = idResult.data
    const db = getDb(c.env)
    const existing = await db.query.maids.findFirst({
      where: (fields, { eq }) => eq(fields.id, id),
    })

    if (existing) {
      return c.json(createErrorResponse('Maid id already exists.'), 409)
    }

    const trimmedName =
      parsed.data.name !== undefined ? parsed.data.name.trim() : undefined

    const insertValues: typeof maids.$inferInsert = {
      id,
      name: trimmedName ?? '',
    }

    if (parsed.data.is_instax_available !== undefined) {
      insertValues.isInstaxAvailable = parsed.data.is_instax_available
    }

    const [inserted] = await db.insert(maids).values(insertValues).returning()

    return c.json(
      createSuccessResponse(mapMaid(c.env, inserted), 'Maid created successfully.'),
      201,
    )
  })

  app.patch('/api/maids/:id', maidApiAuthMiddleware, updateMaidRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    const idResult = maidIdParamSchema.safeParse(idParam)
    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const id = idResult.data
    const contentType = c.req.header('content-type') ?? ''
    let name: string | undefined
    let imageFile: File | undefined
    let isInstaxAvailable: boolean | undefined

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

      if ('is_instax_available' in formData) {
        const raw = formData['is_instax_available']
        if (typeof raw === 'string') {
          const normalized = raw.trim().toLowerCase()
          if (['true', '1', 'yes', 'on'].includes(normalized)) {
            isInstaxAvailable = true
          } else if (['false', '0', 'no', 'off'].includes(normalized)) {
            isInstaxAvailable = false
          } else {
            return c.json(
              createErrorResponse('Invalid is_instax_available value. Use true or false.'),
              400,
            )
          }
        }
      }

      if (!name && !imageFile && isInstaxAvailable === undefined) {
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
      if (parsed.data.is_instax_available !== undefined) {
        isInstaxAvailable = parsed.data.is_instax_available
      }
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

    if (isInstaxAvailable !== undefined) {
      updateValues.isInstaxAvailable = isInstaxAvailable
      existing.isInstaxAvailable = isInstaxAvailable
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

  // 管理: メイドの公開フラグを切り替えるエンドポイント
  app.patch('/api/maids/:id/active', maidApiAuthMiddleware, toggleMaidActiveBodyValidator, toggleMaidActiveRouteDocs, async (c) => {
    const idParam = c.req.param('id')
    const idResult = maidIdParamSchema.safeParse(idParam)
    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const id = idResult.data

    const parsed = c.req.valid('json')

    const db = getDb(c.env)
    const existing = await db.query.maids.findFirst({ where: (fields, { eq }) => eq(fields.id, id) })
    if (!existing) {
      return c.json(createErrorResponse('Maid not found.'), 404)
    }

    const [updated] = await db.update(maids).set({ isActive: parsed.is_active }).where(eq(maids.id, id)).returning()
    const result = updated ?? { ...existing, isActive: parsed.is_active }

    return c.json(createSuccessResponse(mapMaid(c.env, result), 'Maid active flag updated.'))
  })

  app.delete('/api/maids/:id', maidApiAuthMiddleware, deleteMaidRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    const idResult = maidIdParamSchema.safeParse(idParam)
    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid maid id.'), 400)
    }

    const id = idResult.data
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
