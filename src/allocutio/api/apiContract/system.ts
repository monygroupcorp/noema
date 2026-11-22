import type { RouteSpec } from './types'

export const systemRoutes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/openapi.json',
      summary: 'The live OpenAPI 3.1 description of this surface (self-describing).',
      auth: false,
    },
    {
      method: 'POST',
      path: '/mcp',
      summary:
        'MCP (Model Context Protocol) JSON-RPC endpoint — agent tool-use over the same facade. ' +
        'Tools: run_flow / get_run / list_flows / describe_flow / collect / get_collection. Resources: crystal://flows and ' +
        'crystal://flows/{id}. Stateless streamable-HTTP transport; not a typed REST op. The transport ' +
        'itself accepts unauthenticated requests (a client must be able to connect and enumerate tools ' +
        'before it has a credential); identity is enforced per-tool — tools that touch owner-scoped data ' +
        'reject without a credential inside their handler.',
      auth: false,
    },
]
