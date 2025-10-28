import { z } from './zod'

export const successResponseSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .object({
      success: z.literal(true),
      message: z.string(),
      data: schema,
    })
    .openapi({
      description: 'Successful API response wrapper.',
    })

export const errorResponseSchema = z
  .object({
    success: z.literal(false),
    message: z.string(),
    details: z.unknown().optional(),
  })
  .openapi({
    description: 'Error response payload.',
  })
