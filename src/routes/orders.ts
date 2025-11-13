import type { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { eq, sql } from 'drizzle-orm'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { orders } from '../../drizzle/schema'
import type { OpenAPIV3 } from 'openapi-types'

type OrderRow = typeof orders.$inferSelect
const userIdParamSchema = z.string().uuid()

const orderStateSchema = z.enum(['pending', 'preparing', 'served']).openapi({
  description: 'Order state value.',
  example: 'pending',
})

const orderSchema = z
  .object({
    id: z.number().int().openapi({
      example: 1,
      description: 'Order identifier.',
    }),
    user_id: z
      .string()
      .uuid()
      .openapi({
        example: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
        description: 'User identifier associated with the order.',
      }),
    menu_id: z.number().int().openapi({
      example: 15,
      description: 'Menu identifier for the order.',
    }),
    state: orderStateSchema,
    created_at: z
      .string()
      .openapi({
        example: '2025-01-15T10:00:00.000Z',
        description: 'Order creation timestamp in ISO 8601 format.',
      }),
    updated_at: z
      .string()
      .openapi({
        example: '2025-01-15T10:30:00.000Z',
        description: 'Order last update timestamp in ISO 8601 format.',
      }),
  })
  .openapi({
    description: 'Order resource representation.',
  })

const orderListResponseSchema = successResponseSchema(
  z
    .object({
      orders: z.array(orderSchema),
    })
    .openapi({
      description: 'Collection of order resources.',
    }),
)

const orderResponseSchema = successResponseSchema(orderSchema)

const createOrderBodySchema = z
  .object({
    user_id: z
      .string({ required_error: 'user_id is required.' })
      .uuid({ message: 'user_id must be a valid UUID.' })
      .openapi({
        example: 'f1d2e3c4-b5a6-47d8-9123-abcdefabcdef',
        description: 'Identifier of the user placing the order.',
      }),
    menu_id: z
      .number()
      .int({ message: 'menu_id must be an integer.' })
      .min(1, { message: 'menu_id must be greater than zero.' })
      .openapi({
        example: 15,
        description: 'Identifier of the menu item being ordered.',
      }),
  })
  .openapi({
    description: 'Payload for creating an order.',
  })

const updateOrderBodySchema = z
  .object({
    state: orderStateSchema.openapi({
      example: 'preparing',
      description: 'Updated order state.',
    }),
  })
  .openapi({
    description: 'Payload for updating the order state.',
  })

const createJsonBodyValidator =
  <Schema extends z.ZodTypeAny>(schema: Schema) =>
  validator('json', schema, (result, c) => {
    if (!result.success) {
      const fallback = schema.safeParse((result as { data: unknown }).data)
      return c.json(
        createErrorResponse(
          'Invalid request body.',
          fallback.success ? undefined : fallback.error.flatten(),
        ),
        400,
      )
    }
  })

const createOrderBodyValidator = createJsonBodyValidator(createOrderBodySchema)
const updateOrderBodyValidator = createJsonBodyValidator(updateOrderBodySchema)

const mapOrder = (order: OrderRow) => ({
  id: order.id,
  user_id: order.userId,
  menu_id: order.menuId,
  state: order.state,
  created_at: order.createdAt,
  updated_at: order.updatedAt,
})

const listOrdersRouteDocs = describeRoute({
  tags: ['Orders'],
  summary: 'List orders',
  description: 'Retrieve every order currently recorded.',
  responses: {
    200: {
      description: 'Orders retrieved successfully.',
      content: {
        'application/json': {
          schema: resolver(orderListResponseSchema),
        },
      },
    },
  },
})

const getOrderRouteDocs = describeRoute({
  tags: ['Orders'],
  summary: 'Fetch order by id',
  description: 'Retrieve a single order by identifier.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Order identifier.',
      schema: {
        type: 'integer',
        minimum: 1,
      },
    },
  ],
  responses: {
    200: {
      description: 'Order retrieved successfully.',
      content: {
        'application/json': {
          schema: resolver(orderResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid order identifier.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    404: {
      description: 'Order not found.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const getOrdersByUserRouteDocs = describeRoute({
  tags: ['Orders'],
  summary: 'List orders by user',
  description: 'Retrieve orders associated with a specific user identifier.',
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
      description: 'User orders retrieved successfully.',
      content: {
        'application/json': {
          schema: resolver(orderListResponseSchema),
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
  },
})

const createOrderRouteDocs = describeRoute({
  tags: ['Orders'],
  summary: 'Create an order',
  description: 'Create a new order with default state pending.',
  requestBody: {
    required: true,
    description: 'Payload for creating an order.',
  } as OpenAPIV3.RequestBodyObject,
  responses: {
    201: {
      description: 'Order created successfully.',
      content: {
        'application/json': {
          schema: resolver(orderResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid payload.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const updateOrderRouteDocs = describeRoute({
  tags: ['Orders'],
  summary: 'Update order state',
  description: 'Update the state for an existing order.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Order identifier.',
      schema: {
        type: 'integer',
        minimum: 1,
      },
    },
  ],
  requestBody: {
    required: true,
    description: 'Payload for updating the order state.',
  } as OpenAPIV3.RequestBodyObject,
  responses: {
    200: {
      description: 'Order updated successfully.',
      content: {
        'application/json': {
          schema: resolver(orderResponseSchema),
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
      description: 'Order not found.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

export const registerOrderRoutes = (app: Hono<AppEnv>) => {
  app.get('/api/orders', listOrdersRouteDocs, async (c) => {
    const db = getDb(c.env)

    const orderList = await db.query.orders.findMany({
      orderBy: (fields, { desc }) => desc(fields.createdAt),
    })

    return c.json(
      createSuccessResponse({
        orders: orderList.map((order) => mapOrder(order)),
      }),
    )
  })

  app.get('/api/orders/users/:id', getOrdersByUserRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    const idResult = userIdParamSchema.safeParse(idParam)
    if (!idResult.success) {
      return c.json(createErrorResponse('Invalid user id.'), 400)
    }

    const userId = idResult.data
    const db = getDb(c.env)
    const orderList = await db.query.orders.findMany({
      where: (fields, { eq: equals }) => equals(fields.userId, userId),
      orderBy: (fields, { desc }) => desc(fields.createdAt),
    })

    return c.json(
      createSuccessResponse({
        orders: orderList.map((order) => mapOrder(order)),
      }),
    )
  })

  app.post('/api/orders', createOrderBodyValidator, createOrderRouteDocs, async (c) => {
    const parsed = c.req.valid('json')
    const db = getDb(c.env)
    const [inserted] = await db
      .insert(orders)
      .values({
        userId: parsed.user_id,
        menuId: parsed.menu_id,
      })
      .returning()

    return c.json(
      createSuccessResponse(mapOrder(inserted), 'Order created successfully.'),
      201,
    )
  })

  app.patch('/api/orders/:id', updateOrderBodyValidator, updateOrderRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid order id.'), 400)
    }

    const parsed = c.req.valid('json')

    const id = Number.parseInt(idParam, 10)
    const db = getDb(c.env)
    const existing = await db.query.orders.findFirst({
      where: (fields, { eq: equals }) => equals(fields.id, id),
    })

    if (!existing) {
      return c.json(createErrorResponse('Order not found.'), 404)
    }

    if (existing.state === parsed.state) {
      return c.json(
        createSuccessResponse(mapOrder(existing), 'No changes applied.'),
      )
    }

    const [updated] = await db
      .update(orders)
      .set({ state: parsed.state, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(orders.id, id))
      .returning()

    const result =
      updated ??
      (await db.query.orders.findFirst({
        where: (fields, { eq: equals }) => equals(fields.id, id),
      })) ?? { ...existing, state: parsed.state }

    return c.json(
      createSuccessResponse(mapOrder(result), 'Order updated successfully.'),
    )
  })

  app.get('/api/orders/:id', getOrderRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid order id.'), 400)
    }

    const id = Number.parseInt(idParam, 10)
    const db = getDb(c.env)
    const order = await db.query.orders.findFirst({
      where: (fields, { eq: equals }) => equals(fields.id, id),
    })

    if (!order) {
      return c.json(createErrorResponse('Order not found.'), 404)
    }

    return c.json(createSuccessResponse(mapOrder(order)))
  })
}
