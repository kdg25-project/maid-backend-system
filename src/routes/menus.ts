import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { eq, gt } from 'drizzle-orm'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { menus } from '../../drizzle/schema'
import { buildR2PublicUrl, deleteR2Object } from '../libs/storage'

type Bindings = AppEnv['Bindings']
type MenuRow = typeof menus.$inferSelect

const menuSchema = z
  .object({
    id: z.number().int().openapi({
      example: 1,
      description: 'Menu identifier.',
    }),
    name: z.string().openapi({
      example: 'Omurice',
      description: 'Menu item name.',
    }),
    stock: z.number().int().openapi({
      example: 10,
      description: 'Remaining stock value.',
    }),
    image_url: z
      .string()
      .url()
      .nullable()
      .openapi({
        example: 'https://example.com/menus/1.jpg',
        description: 'Public URL for the menu image if available.',
        nullable: true,
      }),
    created_at: z
      .string()
      .openapi({
        example: '2025-01-15T12:30:00.000Z',
        description: 'Creation timestamp in ISO 8601 format.',
      }),
    updated_at: z
      .string()
      .openapi({
        example: '2025-01-16T18:45:00.000Z',
        description: 'Last update timestamp in ISO 8601 format.',
      }),
  })
  .openapi({
    description: 'Menu resource representation.',
  })

const menuListResponseSchema = successResponseSchema(
  z
    .object({
      menus: z.array(menuSchema),
    })
    .openapi({
      description: 'Collection of menu resources.',
    }),
)

const menuResponseSchema = successResponseSchema(menuSchema)

const mapMenu = (env: Bindings, menu: MenuRow) => ({
  id: menu.id,
  name: menu.name,
  stock: menu.stock,
  image_url: menu.imageUrl ? buildR2PublicUrl(env, menu.imageUrl) : null,
  created_at: menu.createdAt,
  updated_at: menu.updatedAt,
})

const listMenusRouteDocs = describeRoute({
  tags: ['Menus'],
  summary: 'List menus',
  description: 'Retrieve all menu items. Optionally filter by stock availability.',
  parameters: [
    {
      in: 'query',
      name: 'available_only',
      required: false,
      description: 'When true, only menus with stock greater than zero are returned.',
      schema: {
        type: 'boolean',
      },
    },
  ],
  responses: {
    200: {
      description: 'Menus retrieved successfully.',
      content: {
        'application/json': {
          schema: resolver(menuListResponseSchema),
        },
      },
    },
  },
})

const getMenuRouteDocs = describeRoute({
  tags: ['Menus'],
  summary: 'Fetch menu by id',
  description: 'Retrieve a single menu item by identifier.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Menu identifier.',
      schema: {
        type: 'integer',
        minimum: 1,
      },
    },
  ],
  responses: {
    200: {
      description: 'Menu found.',
      content: {
        'application/json': {
          schema: resolver(menuResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid menu identifier.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    404: {
      description: 'Menu not found.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const deleteMenuRouteDocs = describeRoute({
  tags: ['Menus'],
  summary: 'Delete a menu',
  description: 'Remove an existing menu item and associated image asset.',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Menu identifier.',
      schema: {
        type: 'integer',
        minimum: 1,
      },
    },
  ],
  responses: {
    200: {
      description: 'Menu deleted successfully.',
      content: {
        'application/json': {
          schema: resolver(menuResponseSchema),
        },
      },
    },
    400: {
      description: 'Invalid menu identifier.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    404: {
      description: 'Menu not found.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

export const registerMenuRoutes = (app: Hono<AppEnv>) => {
  app.get('/api/menus', listMenusRouteDocs, async (c) => {
    const availableOnlyRaw = c.req.query('available_only')
    const availableOnly =
      typeof availableOnlyRaw === 'string' &&
      ['true', '1'].includes(availableOnlyRaw.toLowerCase())

    const db = getDb(c.env)

    const menuList = await db.query.menus.findMany({
      where: availableOnly
        ? (fields, { gt: greaterThan }) => greaterThan(fields.stock, 0)
        : undefined,
      orderBy: (fields, { asc }) => asc(fields.id),
    })

    return c.json(
      createSuccessResponse({
        menus: menuList.map((item) => mapMenu(c.env, item)),
      }),
    )
  })

  app.get('/api/menus/:id', getMenuRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid menu id.'), 400)
    }

    const id = Number.parseInt(idParam, 10)
    const db = getDb(c.env)
    const menu = await db.query.menus.findFirst({
      where: (fields, { eq: equals }) => equals(fields.id, id),
    })

    if (!menu) {
      return c.json(createErrorResponse('Menu not found.'), 404)
    }

    return c.json(createSuccessResponse(mapMenu(c.env, menu)))
  })

  app.delete('/api/menus/:id', deleteMenuRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid menu id.'), 400)
    }

    const id = Number.parseInt(idParam, 10)
    const db = getDb(c.env)

    const existing = await db.query.menus.findFirst({
      where: (fields, { eq: equals }) => equals(fields.id, id),
    })

    if (!existing) {
      return c.json(createErrorResponse('Menu not found.'), 404)
    }

    await db.delete(menus).where(eq(menus.id, id))
    await deleteR2Object(c.env, existing.imageUrl)

    return c.json(
      createSuccessResponse(mapMenu(c.env, existing), 'Menu deleted successfully.'),
    )
  })
}
