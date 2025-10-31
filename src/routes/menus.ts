import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { eq, gt } from 'drizzle-orm'
import type { OpenAPIV3 } from 'openapi-types'
import { z } from '../libs/zod'
import type { AppEnv } from '../types/bindings'
import { getDb } from '../libs/db'
import { createErrorResponse, createSuccessResponse } from '../libs/responses'
import { errorResponseSchema, successResponseSchema } from '../libs/openapi'
import { menus } from '../../drizzle/schema'
import { buildR2PublicUrl, deleteR2Object, uploadR2Object } from '../libs/storage'
import { adminApiAuthMiddleware } from '../middlewares/adminApiAuth'

type Bindings = AppEnv['Bindings']
type MenuRow = typeof menus.$inferSelect

const menuApiSecurityRequirement: OpenAPIV3.SecurityRequirementObject = {
  AdminApiKey: [],
}

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

const updateMenuJsonBodySchema = z
  .object({
    name: z
      .string()
      .min(1, { message: 'Name must not be empty.' })
      .optional()
      .openapi({
        example: 'Updated Omurice',
        description: 'Updated menu name.',
      }),
    stock: z
      .number()
      .int({ message: 'Stock must be an integer.' })
      .min(0, { message: 'Stock must be zero or greater.' })
      .optional()
      .openapi({
        example: 5,
        description: 'Updated stock quantity.',
      }),
  })
  .refine((payload) => payload.name !== undefined || payload.stock !== undefined, {
    message: 'At least one field must be provided.',
  })
  .openapi({
    description: 'JSON payload for updating a menu item (without image).',
  })

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
  security: [menuApiSecurityRequirement],
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
    401: {
      description: 'Unauthorized.',
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

const createMenuRouteDocs = describeRoute({
  tags: ['Menus'],
  summary: 'Create a menu',
  description: 'Register a new menu item including its opening stock and image asset.',
  security: [menuApiSecurityRequirement],
  requestBody: {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['name', 'stock', 'image'],
          properties: {
            name: {
              type: 'string',
              description: 'Menu display name.',
              example: 'Chocolate Parfait',
            },
            stock: {
              type: 'integer',
              minimum: 0,
              description: 'Initial stock quantity.',
              example: 20,
            },
            image: {
              type: 'string',
              format: 'binary',
              description: 'Menu image file to upload.',
              example: 'parfait.jpg',
            },
          },
        },
        encoding: {
          image: {
            contentType: 'image/*',
          },
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Menu created successfully.',
      content: {
        'application/json': {
          schema: resolver(menuResponseSchema),
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
      description: 'Unauthorized.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
    500: {
      description: 'Failed to create menu.',
      content: {
        'application/json': {
          schema: resolver(errorResponseSchema),
        },
      },
    },
  },
})

const updateMenuRouteDocs = describeRoute({
  tags: ['Menus'],
  summary: 'Update a menu',
  description:
    'Update an existing menu item. Supports JSON for text fields and multipart form-data when including an image.',
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
  security: [menuApiSecurityRequirement],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: resolver(updateMenuJsonBodySchema) as unknown as Record<string, unknown>,
      },
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Updated menu name.',
              example: 'Seasonal Omurice',
            },
            stock: {
              type: 'integer',
              minimum: 0,
              description: 'Updated stock quantity.',
              example: 12,
            },
            image: {
              type: 'string',
              format: 'binary',
              description: 'Menu image file.',
              example: 'menu-seasonal.jpg',
            },
          },
        },
        examples: {
          default: {
            summary: 'Update menu with new image',
            value: {
              name: 'Seasonal Omurice',
              stock: 12,
              image: 'menu-seasonal.jpg',
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
  responses: {
    200: {
      description: 'Menu updated successfully.',
      content: {
        'application/json': {
          schema: resolver(menuResponseSchema),
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
      description: 'Unauthorized.',
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
  app.post('/api/menus', adminApiAuthMiddleware, createMenuRouteDocs, async (c) => {
    const contentType = c.req.header('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('multipart/form-data')) {
      return c.json(createErrorResponse('Content-Type must be multipart/form-data.'), 400)
    }

    const formData = await c.req.parseBody()
    const rawName = formData['name']
    if (typeof rawName !== 'string' || rawName.trim().length === 0) {
      return c.json(createErrorResponse('Name is required.'), 400)
    }
    const name = rawName.trim()

    const rawStock = formData['stock']
    if (typeof rawStock !== 'string' || rawStock.trim().length === 0) {
      return c.json(createErrorResponse('Stock is required.'), 400)
    }

    const parsedStock = Number.parseInt(rawStock, 10)
    if (!Number.isInteger(parsedStock) || parsedStock < 0) {
      return c.json(createErrorResponse('Stock must be a non-negative integer.'), 400)
    }

    const image = formData['image']
    if (!(image instanceof File) || image.size === 0) {
      return c.json(createErrorResponse('Image file is required.'), 400)
    }

    const db = getDb(c.env)
    let insertedMenu: MenuRow | undefined
    try {
      const [inserted] = await db
        .insert(menus)
        .values({
          name,
          stock: parsedStock,
        })
        .returning()

      insertedMenu = inserted
    } catch (err) {
      console.error('POST /api/menus insert error:', err)
      return c.json(createErrorResponse('Failed to create menu.'), 500)
    }

    if (!insertedMenu) {
      return c.json(createErrorResponse('Failed to create menu.'), 500)
    }

    const menuId = insertedMenu.id
    let uploadedKey: string | undefined
    try {
      const uploadResult = await uploadR2Object(c.env, `menus/${menuId}`, image)
      uploadedKey = uploadResult.key
      const now = new Date().toISOString()
      const [updated] = await db
        .update(menus)
        .set({
          imageUrl: uploadResult.key,
          updatedAt: now,
        })
        .where(eq(menus.id, menuId))
        .returning()

      const result = updated ?? { ...insertedMenu, imageUrl: uploadResult.key, updatedAt: now }

      return c.json(
        createSuccessResponse(mapMenu(c.env, result), 'Menu created successfully.'),
        201,
      )
    } catch (err) {
      console.error('POST /api/menus upload error:', err)
      await db.delete(menus).where(eq(menus.id, menuId))
      if (uploadedKey) {
        await deleteR2Object(c.env, uploadedKey)
      }
      return c.json(createErrorResponse('Failed to create menu.'), 500)
    }
  })

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

  app.delete('/api/menus/:id', adminApiAuthMiddleware, deleteMenuRouteDocs, async (c) => {
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

  app.patch('/api/menus/:id', adminApiAuthMiddleware, updateMenuRouteDocs, async (c) => {
    const idParam = c.req.param('id')

    if (!/^[1-9]\d*$/.test(idParam)) {
      return c.json(createErrorResponse('Invalid menu id.'), 400)
    }

    const id = Number.parseInt(idParam, 10)
    const contentType = c.req.header('content-type') ?? ''
    let name: string | undefined
    let stock: number | undefined
    let imageFile: File | undefined

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.parseBody()

      const maybeName = formData['name']
      if (typeof maybeName === 'string' && maybeName.trim().length > 0) {
        name = maybeName.trim()
      }

      const maybeStock = formData['stock']
      if (typeof maybeStock === 'string' && maybeStock.trim().length > 0) {
        const parsedStock = Number.parseInt(maybeStock, 10)
        if (!Number.isInteger(parsedStock) || parsedStock < 0) {
          return c.json(
            createErrorResponse('Stock must be a non-negative integer.'),
            400,
          )
        }
        stock = parsedStock
      }

      const maybeImage = formData['image']
      if (maybeImage instanceof File && maybeImage.size > 0) {
        imageFile = maybeImage
      }

      if (!name && stock === undefined && !imageFile) {
        return c.json(createErrorResponse('No updatable fields provided.'), 400)
      }
    } else {
      const body = await c.req
        .json()
        .catch(() => null)
      const parsed = updateMenuJsonBodySchema.safeParse(body)

      if (!parsed.success) {
        return c.json(
          createErrorResponse('Invalid request body.', parsed.error.flatten()),
          400,
        )
      }

      name = parsed.data.name?.trim()
      stock = parsed.data.stock
    }

    const db = getDb(c.env)
    const existing = await db.query.menus.findFirst({
      where: (fields, { eq: equals }) => equals(fields.id, id),
    })

    if (!existing) {
      return c.json(createErrorResponse('Menu not found.'), 404)
    }

    const updateValues: Partial<typeof menus.$inferInsert> = {}

    if (name) {
      updateValues.name = name
      existing.name = name
    }

    if (typeof stock === 'number') {
      updateValues.stock = stock
      existing.stock = stock
    }

    if (imageFile) {
      const { key } = await uploadR2Object(c.env, `menus/${id}`, imageFile)
      await deleteR2Object(c.env, existing.imageUrl)
      updateValues.imageUrl = key
      existing.imageUrl = key
    }

    if (Object.keys(updateValues).length === 0) {
      return c.json(
        createSuccessResponse(mapMenu(c.env, existing), 'No changes applied.'),
      )
    }

    const now = new Date().toISOString()
    updateValues.updatedAt = now
    existing.updatedAt = now

    const [updated] = await db
      .update(menus)
      .set(updateValues)
      .where(eq(menus.id, id))
      .returning()

    const result = updated ?? { ...existing, ...updateValues }

    return c.json(
      createSuccessResponse(mapMenu(c.env, result), 'Menu updated successfully.'),
    )
  })
}
