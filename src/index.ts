import { Hono } from 'hono'
import { registerDocsRoutes } from './docs/routes'
import { registerHealthRoutes } from './routes/health'
import { registerMaidRoutes } from './routes/maids'
import { registerMenuRoutes } from './routes/menus'
import { registerUserRoutes } from './routes/users'
import { registerOrderRoutes } from './routes/orders'
import type { AppEnv } from './types/bindings'

const app = new Hono<AppEnv>()

registerHealthRoutes(app)
registerMaidRoutes(app)
registerMenuRoutes(app)
registerUserRoutes(app)
registerOrderRoutes(app)
registerDocsRoutes(app)

export default app
