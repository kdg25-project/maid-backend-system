export interface CloudflareBindings {
  vantan_cafe_database: unknown
  'vantan-cafe-bucket': {
    put(key: string, value: unknown, options?: Record<string, unknown>): Promise<unknown>
    get(key: string, options?: Record<string, unknown>): Promise<unknown>
    delete(key: string): Promise<void>
  }
  R2_PUBLIC_BASE_URL?: string
}

export type AppEnv = {
  Bindings: CloudflareBindings
}
