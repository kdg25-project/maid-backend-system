import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { eq } from 'drizzle-orm'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { users } from '../../drizzle/schema'
import { maidApiAuthMiddleware } from '../middlewares/maidApiAuth'
import type { OpenAPIV3 } from 'openapi-types'

type UserRow = typeof users.$inferSelect
type Database = ReturnType<typeof getDb>

const userIdParamSchema = z.string().uuid()
const seatIdParamSchema = z
  .coerce.number()
  .int({ message: 'seat id must be an integer.' })
  .min(1, { message: 'seat id must be greater than zero.' })

const normalizeNullableString = (value: string | null | undefined) =>
  value && value.trim().length > 0 ? value : null

const sanitizeStatus = (value: string | null | undefined) => {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const statusInputSchema = z
  .string()
  .max(200, { message: 'status must be at most 200 characters.' })
  .refine((val) => val.trim().length > 0, {
    message: 'status must not be empty when provided.',
  })

export const userSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .openapi({
        example: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
        description: 'User identifier.',
      }),
    name: z
      .string()
      .nullable()
      .openapi({
        example: null,
        description: 'User name if registered.',
        nullable: true,
      }),
    status: z
      .string()
      .nullable()
      .openapi({
        example: 'Waiting for order.',
        description: 'Current free-form status text for the user.',
        nullable: true,
      }),
    maid_id: z
      .string()
      .uuid()
      .nullable()
      .openapi({
        example: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
        description: 'Assigned maid identifier.',
        nullable: true,
      }),
    instax_maid_id: z
      .string()
      .uuid()
      .nullable()
      .openapi({
        example: null,
        description: 'Instax maid identifier if assigned.',
        nullable: true,
      }),
    seat_id: z
      .number()
      .int()
      .nullable()
      .openapi({
        example: 12,
        description: 'Seat identifier for the user.',
        nullable: true,
      }),
    is_valid: z
      .boolean()
      .openapi({
        example: true,
        description: 'Indicates if the user is currently valid.',
      }),
    created_at: z
      .string()
      .openapi({
        example: '2025-01-15T10:00:00.000Z',
        description: 'Creation timestamp in ISO 8601 format.',
      }),
    updated_at: z
      .string()
      .openapi({
        example: '2025-01-16T10:00:00.000Z',
        description: 'Last update timestamp in ISO 8601 format.',
      }),
  })
  .openapi({
    description: 'User resource representation.',
  })

const userResponseSchema = successResponseSchema(userSchema)

const validateMaidReference = async (
  db: Database,
  maidId: string | null | undefined,
  fieldName: 'maid_id' | 'instax_maid_id',
) => {
  if (maidId === undefined || maidId === null) {
    return null
  }

  const maid = await db.query.maids.findFirst({
    where: (fields, { eq: equals }) => equals(fields.id, maidId),
  })

  if (!maid) {
    return `${fieldName} does not reference an existing maid.`
  }

  return null
}

const createUserBodySchema = z
  .object({
    seat_id: z
      .number()
      .int({ message: 'seat_id must be an integer.' })
      .min(1, { message: 'seat_id must be greater than zero.' })
      .openapi({
        example: 12,
        description: 'Seat identifier assigned to the user.',
      }),
    maid_id: z
      .string({ required_error: 'maid_id is required.' })
      .uuid({ message: 'maid_id must be a valid UUID.' })
      .openapi({
        example: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
        description: 'Maid identifier responsible for the user.',
      }),
    status: statusInputSchema
      .optional()
      .openapi({
        example: 'Waiting at entrance.',
        description: 'Optional current status text to store for the user.',
      }),
  })
  .openapi({
    description: 'Payload for registering a user into the cafe.',
  })

const updateUserBodySchema = z
  .object({
    name: z
      .string()
      .min(1, { message: 'name must not be empty when provided.' })
      .optional()
      .openapi({
        example: 'John Doe',
        description: 'Updated user name.',
      }),
    maid_id: z
      .string()
      .uuid({ message: 'maid_id must be a valid UUID.' })
      .nullable()
      .optional()
      .openapi({
        example: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
        description: 'Updated assigned maid id.',
        nullable: true,
      }),
    instax_maid_id: z
      .string()
      .uuid({ message: 'instax_maid_id must be a valid UUID.' })
      .nullable()
      .optional()
      .openapi({
        example: null,
        description: 'Updated instax maid id.',
        nullable: true,
      }),
    seat_id: z
      .number()
      .int({ message: 'seat_id must be an integer.' })
      .min(1, { message: 'seat_id must be greater than zero.' })
      .nullable()
      .optional()
      .openapi({
        example: 10,
        description: 'Updated seat id.',
        nullable: true,
      }),
    status: statusInputSchema
      .nullable()
      .optional()
      .openapi({
        example: 'Serving Omurice.',
        description: 'Updated status text (null to clear).',
        nullable: true,
      }),
    is_valid: z
      .boolean()
      .optional()
      .openapi({
        example: true,
        description: 'Updated validity flag.',
      }),
  })
  .refine(
    (payload) =>
      payload.name !== undefined ||
      payload.maid_id !== undefined ||
      payload.instax_maid_id !== undefined ||
      payload.seat_id !== undefined ||
      payload.status !== undefined ||
      payload.is_valid !== undefined,
    {
      message: 'At least one field must be provided.',
    },
  )
  .openapi({
    description: 'Payload for updating user details.',
  })

const createUserRouteDocs = describeRoute({
  tags: ['Users'],
  summary: 'Register a user (entry registration)',
  description:
    'Registers a new user placeholder or re-registers an existing user by assigning seat and maid ids while marking the record as valid.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'User identifier to create or update.',
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
        schema: resolver(createUserBodySchema) as unknown as Record<string, unknown>,
        examples: {
          register: {
            summary: 'Register or re-register user',
            value: {
              seat_id: 12,
              maid_id: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
              status: 'Waiting at entrance.',
            },
          },
        },
      },
    },
  },
  responses: {
    200: {
      description:
        'User registered successfully. Returns the up-to-date user resource.',
      content: {
        'application/json': {
          schema: resolver(userResponseSchema),
          examples: {
            success: {
              summary: 'Registered user response',
              value: {
                success: true,
                message: 'User registered successfully.',
                data: {
                  id: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
                  name: null,
                  status: 'Waiting at entrance.',
                  maid_id: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
                  instax_maid_id: null,
                  seat_id: 12,
                  is_valid: true,
                  created_at: '2025-01-15T10:00:00.000Z',
                  updated_at: '2025-01-15T10:05:00.000Z',
                },
              },
            },
          },
        },
      },
    },
    400: {
      description: 'Invalid payload or identifier.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const getUserRouteDocs = describeRoute({
  tags: ['Users'],
  summary: 'Fetch user by id',
  description: 'Retrieve a single user entry by identifier.',
  parameters: [
    {
      name: 'id',
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
      description: 'User retrieved successfully.',
      content: {
        'application/json': {
          schema: resolver(userResponseSchema),
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
      description: 'User not found.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const maidApiSecurityRequirement: OpenAPIV3.SecurityRequirementObject = {
  MaidApiKey: [],
}

const listUsersRouteDocs = describeRoute({
  tags: ['Users'],
  summary: 'List all users',
  description: 'Retrieve all user records in the system.',
  security: [maidApiSecurityRequirement],
  responses: {
    200: {
      description: 'Users retrieved successfully.',
      content: {
        'application/json': {
          schema: resolver(
            successResponseSchema(
              z.object({
                users: z.array(userSchema).openapi({
                  description: 'List of all users.',
                }),
              })
            )
          ),
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

const getUserBySeatRouteDocs = describeRoute({
  tags: ['Users'],
  summary: 'Fetch user by seat',
  description:
    'Retrieve the most recently updated valid user currently assigned to the specified seat.',
  parameters: [
    {
      name: 'seatId',
      in: 'path',
      required: true,
      description: 'Seat identifier.',
      schema: {
        type: 'integer',
        minimum: 1,
      },
    },
  ],
  security: [maidApiSecurityRequirement],
  responses: {
    200: {
      description: 'User occupying the seat.',
      content: {
        'application/json': {
          schema: resolver(userResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid seat identifier.',
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

const updateUserRouteDocs = describeRoute({
  tags: ['Users'],
  summary: 'Update user details',
  description:
    'Updates mutable fields for a user record, allowing partial updates of name, maid assignments, seat, and validity.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'User identifier.',
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
        schema: resolver(updateUserBodySchema) as unknown as Record<string, unknown>,
        examples: {
          updateAssignments: {
            summary: 'Update name and assignments',
            value: {
              name: 'John Doe',
              maid_id: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
              instax_maid_id: null,
              seat_id: 18,
              status: 'Enjoying parfait.',
            },
          },
          deactivate: {
            summary: 'Invalidate user',
            value: {
              is_valid: false,
            },
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: 'User updated successfully.',
      content: {
        'application/json': {
          schema: resolver(userResponseSchema),
          examples: {
            success: {
              summary: 'Updated user response',
              value: {
                success: true,
                message: 'User updated successfully.',
                data: {
                  id: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
                  name: 'John Doe',
                  status: 'Enjoying parfait.',
                  maid_id: 'c2608c61-4a4a-405a-8024-1cc403a53c1d',
                  instax_maid_id: null,
                  seat_id: 18,
                  is_valid: true,
                  created_at: '2025-01-15T10:00:00.000Z',
                  updated_at: '2025-01-15T12:00:00.000Z',
                },
              },
            },
          },
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
    404: {
      description: 'User not found.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

export const mapUser = (user: UserRow) => ({
  id: user.id,
  name: normalizeNullableString(user.name),
  status: normalizeNullableString(user.status),
  maid_id: user.maidId ?? null,
  instax_maid_id: user.instaxMaidId ?? null,
  seat_id: user.seatId ?? null,
  is_valid: Boolean(user.isValid),
  created_at: user.createdAt,
  updated_at: user.updatedAt,
})

export const registerUserRoutes = (app: Hono<AppEnv>) => {
  app.get('/api/users/seat/:seatId', maidApiAuthMiddleware, getUserBySeatRouteDocs, async (c) => {
    const seatParam = c.req.param('seatId')

    const seatResult = seatIdParamSchema.safeParse(seatParam)
    if (!seatResult.success) {
      return c.json(createErrorResponse('Invalid seat id.'), 400)
    }

    const seatId = seatResult.data
    const db = getDb(c.env)

    const user = await db.query.users.findFirst({
      where: (fields, { eq, and }) =>
        and(eq(fields.seatId, seatId), eq(fields.isValid, true)),
      orderBy: (fields, { desc }) => desc(fields.updatedAt),
    })

    if (!user) {
      return c.json(createErrorResponse('No active user found for the specified seat.'), 404)
    }

    return c.json(createSuccessResponse(mapUser(user)))
  })

  app.get('/api/users', maidApiAuthMiddleware, listUsersRouteDocs, async (c) => {
    const db = getDb(c.env)
    const userList = await db.query.users.findMany({
      orderBy: (fields, { desc }) => desc(fields.updatedAt),
    })

    return c.json(
      createSuccessResponse({
        users: userList.map((user) => mapUser(user)),
      }),
    )
  })

  app.get('/api/users/:id', getUserRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    const idResult = userIdParamSchema.safeParse(idParam)
    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid user id.'), 400)
    }

    const id = idResult.data
    const db = getDb(c.env)
    const user = await db.query.users.findFirst({
      where: (fields, { eq: equals }) => equals(fields.id, id),
    })

    if (!user) {
      return c.json(createErrorResponse('User not found.'), 404)
    }

    return c.json(createSuccessResponse(mapUser(user)))
  })

  app.post('/api/users/:id', createUserRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    const idResult = userIdParamSchema.safeParse(idParam)
    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid user id.'), 400)
    }

    const body = await c.req
      .json()
      .catch(() => null)
    const parsed = createUserBodySchema.safeParse(body)

    if (!parsed.success) {
      return c.json(
        createErrorResponse('Invalid request body.', parsed.error.flatten()),
        400,
      )
    }

    const id = idResult.data
    const db = getDb(c.env)

    const maidValidationError = await validateMaidReference(db, parsed.data.maid_id, 'maid_id')
    if (maidValidationError) {
      return c.json(createErrorResponse(maidValidationError), 400)
    }

    const existing = await db.query.users.findFirst({
      where: (fields, { eq: equals }) => equals(fields.id, id),
    })

    const now = new Date().toISOString()
    const sanitizedStatus = sanitizeStatus(parsed.data.status)

    if (existing) {
      const updatePayload: Partial<typeof users.$inferInsert> = {
        maidId: parsed.data.maid_id,
        seatId: parsed.data.seat_id,
        instaxMaidId: null,
        isValid: true,
        name: existing.name ?? '',
        updatedAt: now,
      }

      if (sanitizedStatus !== undefined) {
        updatePayload.status = sanitizedStatus
        existing.status = sanitizedStatus ?? null
      }

      const [updated] = await db
        .update(users)
        .set(updatePayload)
        .where(eq(users.id, id))
        .returning()

      const result = updated ?? {
        ...existing,
        ...updatePayload,
      }

      return c.json(
        createSuccessResponse(mapUser(result), 'User registered successfully.'),
      )
    }

    const insertValues: typeof users.$inferInsert = {
      id,
      maidId: parsed.data.maid_id,
      seatId: parsed.data.seat_id,
      instaxMaidId: null,
      isValid: true,
      name: '',
    }

    if (sanitizedStatus !== undefined) {
      insertValues.status = sanitizedStatus
    }

    const [inserted] = await db
      .insert(users)
      .values(insertValues)
      .returning()

    return c.json(
      createSuccessResponse(mapUser(inserted), 'User registered successfully.'),
    )
  })

  app.patch('/api/users/:id', updateUserRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    const idResult = userIdParamSchema.safeParse(idParam)
    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid user id.'), 400)
    }

    const body = await c.req
      .json()
      .catch(() => null)
    const parsed = updateUserBodySchema.safeParse(body)

    if (!parsed.success) {
      return c.json(
        createErrorResponse('Invalid request body.', parsed.error.flatten()),
        400,
      )
    }

    const id = idResult.data
    const db = getDb(c.env)
    const existing = await db.query.users.findFirst({
      where: (fields, { eq: equals }) => equals(fields.id, id),
    })

    if (!existing) {
      return c.json(createErrorResponse('User not found.'), 404)
    }

    const maidValidationError = await validateMaidReference(db, parsed.data.maid_id, 'maid_id')
    if (maidValidationError) {
      return c.json(createErrorResponse(maidValidationError), 400)
    }

    const instaxMaidValidationError = await validateMaidReference(
      db,
      parsed.data.instax_maid_id,
      'instax_maid_id',
    )
    if (instaxMaidValidationError) {
      return c.json(createErrorResponse(instaxMaidValidationError), 400)
    }

    const updateValues: Partial<typeof users.$inferInsert> = {}

    if (parsed.data.name !== undefined) {
      updateValues.name = parsed.data.name.trim()
      existing.name = updateValues.name
    }

    if (parsed.data.maid_id !== undefined) {
      updateValues.maidId = parsed.data.maid_id ?? null
      existing.maidId = parsed.data.maid_id ?? null
    }

    if (parsed.data.instax_maid_id !== undefined) {
      updateValues.instaxMaidId = parsed.data.instax_maid_id ?? null
      existing.instaxMaidId = parsed.data.instax_maid_id ?? null
    }

    if (parsed.data.seat_id !== undefined) {
      updateValues.seatId = parsed.data.seat_id ?? null
      existing.seatId = parsed.data.seat_id ?? null
    }

    if (parsed.data.status !== undefined) {
      const sanitized = sanitizeStatus(parsed.data.status)
      updateValues.status = sanitized ?? null
      existing.status = sanitized ?? null
    }

    if (parsed.data.is_valid !== undefined) {
      updateValues.isValid = parsed.data.is_valid
      existing.isValid = parsed.data.is_valid
    }

    if (Object.keys(updateValues).length === 0) {
      return c.json(
        createSuccessResponse(mapUser(existing), 'No changes applied.'),
      )
    }

    const now = new Date().toISOString()
    updateValues.updatedAt = now
    existing.updatedAt = now

    const [updated] = await db
      .update(users)
      .set(updateValues)
      .where(eq(users.id, id))
      .returning()

    const result = updated ?? { ...existing, ...updateValues }

    return c.json(
      createSuccessResponse(mapUser(result), 'User updated successfully.'),
    )
  })
}
