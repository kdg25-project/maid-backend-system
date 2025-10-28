import type { CloudflareBindings } from '../types/bindings'

const sanitizeBaseUrl = (value: string) => value.replace(/\/+$/, '')

export const buildR2PublicUrl = (
  env: CloudflareBindings,
  key: string,
): string => {
  if (!env.R2_PUBLIC_BASE_URL) {
    return key
  }

  return `${sanitizeBaseUrl(env.R2_PUBLIC_BASE_URL)}/${key}`
}

export const uploadR2Object = async (
  env: CloudflareBindings,
  keyPrefix: string,
  file: File,
) => {
  const bucket = env['vantan-cafe-bucket']
  if (!bucket) {
    throw new Error('R2 bucket binding is not configured.')
  }

  const objectKey = `${keyPrefix}/${crypto.randomUUID()}-${file.name}`
  const arrayBuffer = await file.arrayBuffer()

  await bucket.put(objectKey, arrayBuffer, {
    httpMetadata: {
      contentType: file.type || 'application/octet-stream',
    },
  })

  return {
    key: objectKey,
    url: buildR2PublicUrl(env, objectKey),
  }
}

export const deleteR2Object = async (
  env: CloudflareBindings,
  key: string | null | undefined,
) => {
  if (!key) {
    return
  }

  const bucket = env['vantan-cafe-bucket']
  if (!bucket) {
    throw new Error('R2 bucket binding is not configured.')
  }

  await bucket.delete(key)
}
