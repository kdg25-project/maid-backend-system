import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../drizzle/schema'
import type { CloudflareBindings } from '../types/bindings'

export const getDb = (env: CloudflareBindings) =>
  drizzle(env.vantan_cafe_database as D1Database, { schema })

type D1Database = Parameters<typeof drizzle>[0]
