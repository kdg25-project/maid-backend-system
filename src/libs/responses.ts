export interface ApiResponse<T> {
  success: true
  message: string
  data: T
}

export interface ApiErrorResponse {
  success: false
  message: string
  details?: unknown
}

export const createSuccessResponse = <T>(
  data: T,
  message = 'OK',
): ApiResponse<T> => ({
  success: true,
  message,
  data,
})

export const createErrorResponse = (
  message: string,
  details?: unknown,
): ApiErrorResponse => ({
  success: false,
  message,
  details,
})
