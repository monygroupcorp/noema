/** A minimal JSON-Schema node — enough to describe the request/response bodies. */
export interface JsonSchema {
  type?: string
  format?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: readonly string[]
  additionalProperties?: boolean | JsonSchema
  nullable?: boolean
  example?: unknown
}

/** One query-string parameter on a `RouteSpec`. */
export interface QueryParamSpec {
  name: string
  description: string
  schema: JsonSchema
  /** Defaults to false — most query params are optional filters. */
  required?: boolean
}

/** One HTTP operation on the `/v1` surface. */
export interface RouteSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** The path, RELATIVE to the `/v1` mount (e.g. `/runs`, `/runs/:id`). */
  path: string
  summary: string
  /** Whether a resolved caller identity (a credential) is required. */
  auth: boolean
  /** Query-string parameters this operation accepts, in addition to any path params. */
  query?: QueryParamSpec[]
  /** The request-body schema, when the operation takes one. */
  request?: JsonSchema
  /** The success-response schema. */
  response?: JsonSchema
}

/** One request-error the surface can return (mirrors `errors.ts`). */
export interface ErrorCodeSpec {
  code: string
  httpStatus: number
  retryable?: boolean
}

/** The declarative `/v1` contract: routes + the request-error taxonomy. */
export interface ApiContract {
  version: 'v1'
  routes: RouteSpec[]
  errorCodes: ErrorCodeSpec[]
}
