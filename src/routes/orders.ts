import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { eq } from 'drizzle-orm'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { orders } from '../../drizzle/schema'

type OrderRow = typeof orders.$inferSelect

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
    user_id: z.number().int().openapi({
      example: 101,
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
