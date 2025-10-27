import { Hono } from 'hono'
import { drizzle } from "drizzle-orm/d1";

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
