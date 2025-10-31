import { Hono } from 'hono'
import { registerDocsRoutes } from './docs/routes'
import { registerHealthRoutes } from './routes/health'
import { registerMaidRoutes } from './routes/maids'
import { registerMenuRoutes } from './routes/menus'
import { registerUserRoutes } from './routes/users'
import { registerOrderRoutes } from './routes/orders'
import { registerInstaxRoutes } from './routes/instax'
import type { AppEnv } from './types/bindings'
import { cors } from 'hono/cors'

const app = new Hono<AppEnv>()

app.use(cors({
    origin: "*"
}))

registerHealthRoutes(app)
registerMaidRoutes(app)
registerMenuRoutes(app)
registerUserRoutes(app)
registerOrderRoutes(app)
registerInstaxRoutes(app)
registerDocsRoutes(app)

export default app
