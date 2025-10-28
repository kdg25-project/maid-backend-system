import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { gt } from 'drizzle-orm'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createSuccessResponse } from '../libs/responses'
import { successResponseSchema } from '../libs/openapi'
import { menus } from '../../drizzle/schema'
import { buildR2PublicUrl } from '../libs/storage'

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
}
