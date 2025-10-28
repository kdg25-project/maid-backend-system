import { Hono } from 'hono'
import { registerDocsRoutes } from './docs/routes'
import { registerHealthRoutes } from './routes/health'
import { registerMaidRoutes } from './routes/maids'
import type { AppEnv } from './types/bindings'

const app = new Hono<AppEnv>()

registerHealthRoutes(app)
registerMaidRoutes(app)
registerDocsRoutes(app)

export default app
