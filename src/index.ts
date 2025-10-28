import { Hono } from 'hono'
import { registerDocsRoutes } from './docs/routes'
import { registerHealthRoutes } from './routes/health'

const app = new Hono()

registerHealthRoutes(app)
registerDocsRoutes(app)

export default app
