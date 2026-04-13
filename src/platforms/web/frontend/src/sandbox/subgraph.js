/**
 * subgraph.js — serialize a canvas2 selection into the shape
 * consumed by SpellsModal / the /api/v1/spells create endpoint.
 *
 * Reads directly from the CanvasEngine's live Maps — canvas2 does not sync
 * to the legacy state.js activeToolWindows, so this is the source of truth.
 *
 * Node handling:
 *   - tool       → emitted as a step using its existing parameterMappings.
 *   - expression → emitted as a step with toolIdentifier 'expression'.
 *                  The backend ExpressionAdapter is a real registered tool
 *                  (src/core/tools/definitions/expressionTool.js); the
 *                  expression text is stored as a static mapping.
 *   - primitive  → emitted as a step with toolIdentifier 'primitive'. The
 *                  backend PrimitiveAdapter is an identity-function tool
 *                  (src/core/tools/definitions/primitiveTool.js) — it takes
 *                  a `value` input and emits it unchanged. This preserves
 *                  the primitive as a first-class node in the saved graph
 *                  (canvas reload, multi-target reuse, post-mint editing)
 *                  with zero runtime cost and no semantic trickery.
 *   - other      → ignored (upload, collection, etc. are not spell-able).
 *
 * Connections where both endpoints are emitted steps are translated into
 * nodeOutput parameterMappings on the target, matching how
 * ParameterResolver.resolveMappings looks them up at execute time.
 */

// Must match src/core/tools/definitions/expressionTool.js.
const EXPRESSION_TOOL_ID = 'expression';
const EXPRESSION_OUTPUT_KEY = 'result';

// Must match src/core/tools/definitions/primitiveTool.js.
const PRIMITIVE_TOOL_ID = 'primitive';
const PRIMITIVE_OUTPUT_KEY = 'value';

/**
 * Read a primitive window's current value. Empty string / null / undefined
 * means "user hasn't filled this in" and it should become an exposable input.
 */
function readPrimitiveValue(win) {
    if (!win || win.type !== 'primitive') return undefined;
    if (win.value === undefined || win.value === null) return undefined;
    if (typeof win.value === 'string' && win.value.trim() === '') return undefined;
    return win.value;
}

/**
 * Build a serialized step for a tool window.
 */
function buildToolNode(win) {
    return {
        id: win.id,
        kind: 'tool',
        toolId: win.tool.toolId,
        displayName: win.tool.displayName,
        workspaceX: win.x,
        workspaceY: win.y,
        output: win.output || null,
        parameterMappings: { ...(win.parameterMappings || {}) },
        inputSchema: win.tool?.inputSchema || win.tool?.metadata?.inputSchema || {},
    };
}

/**
 * Build a serialized step for an expression window. Maps to the backend
 * 'expression' tool; the expression text is stored as a static parameter.
 */
function buildExpressionNode(win) {
    return {
        id: win.id,
        kind: 'expression',
        toolId: EXPRESSION_TOOL_ID,
        displayName: 'Expression',
        workspaceX: win.x,
        workspaceY: win.y,
        output: win.output || null,
        parameterMappings: {
            ...(win.parameterMappings || {}),
            expression: { type: 'static', value: win.expression || '' },
        },
        // Both `expression` and `input` are surfaced in the Expose Inputs
        // list. Users rarely want to expose the expression text itself, but
        // we keep it visible so they can curate if they want.
        inputSchema: {
            expression: {
                name: 'Expression',
                type: 'string',
                required: true,
                description: 'The expression to evaluate. `input` is the primary variable.',
            },
            input: {
                name: 'Input',
                type: 'string',
                required: false,
                description: 'Primary input value, available as "input" in the expression.',
            },
        },
    };
}

/**
 * Build a serialized step for a primitive window. Maps to the backend
 * 'primitive' tool, an identity-function step that passes its `value`
 * input through unchanged. Empty primitives get no static mapping and
 * are picked up by auto-expose in step 4 of serializeSubgraph.
 */
function buildPrimitiveNode(win) {
    const value = readPrimitiveValue(win);
    const label = win.outputType === 'text' ? 'Text'
        : win.outputType === 'number' ? 'Number'
        : (win.outputType || 'Primitive');
    const node = {
        id: win.id,
        kind: 'primitive',
        primitiveOutputType: win.outputType || 'text',
        toolId: PRIMITIVE_TOOL_ID,
        displayName: label,
        workspaceX: win.x,
        workspaceY: win.y,
        output: win.output || null,
        parameterMappings: {},
        inputSchema: {
            value: {
                name: 'Value',
                type: win.outputType === 'number' ? 'number' : 'string',
                required: value === undefined,
                description: `Value for this ${label.toLowerCase()} node.`,
            },
        },
    };
    if (value !== undefined) {
        node.parameterMappings.value = { type: 'static', value };
    }
    return node;
}

/**
 * Serialize a subset of the canvas into a spell subgraph.
 *
 * @param {import('./canvas2/CanvasEngine.js').CanvasEngine} engine
 * @param {Set<string>} selectedNodeIds
 * @returns {{
 *   nodes: Array<{
 *     id: string,
 *     kind: 'tool' | 'expression' | 'primitive',
 *     toolId: string,
 *     displayName: string,
 *     workspaceX: number,
 *     workspaceY: number,
 *     output: any,
 *     parameterMappings: Record<string, { type: 'static' | 'nodeOutput', [k: string]: any }>,
 *     inputSchema: Record<string, any>,
 *     primitiveOutputType?: string,
 *   }>,
 *   connections: Array<{ fromWindowId: string, fromOutput: string, toWindowId: string, toInput: string, type?: string }>,
 *   autoExposed: Array<{ nodeId: string, paramKey: string }>,
 * }}
 */
export function serializeSubgraph(engine, selectedNodeIds) {
    // 1. Collect every window in the selection that becomes a spell step.
    //    Tools, expressions, AND primitives all become steps — each uses
    //    its own dedicated backend tool (tool/expression/primitive).
    const stepWindows = [];
    for (const id of selectedNodeIds) {
        const win = engine.windows.get(id);
        if (!win) continue;
        if (win.type === 'tool' && win.tool) stepWindows.push(win);
        else if (win.type === 'expression') stepWindows.push(win);
        else if (win.type === 'primitive') stepWindows.push(win);
        // Other types (upload, collection, collectionTest, spell) are ignored.
    }
    const stepIdSet = new Set(stepWindows.map(w => w.id));

    // 2. Build a serialized node for each step window.
    const nodesById = new Map();
    for (const win of stepWindows) {
        let node;
        if (win.type === 'tool') node = buildToolNode(win);
        else if (win.type === 'expression') node = buildExpressionNode(win);
        else if (win.type === 'primitive') node = buildPrimitiveNode(win);
        if (node) nodesById.set(win.id, node);
    }

    // 3. Walk connections once. Any connection where both endpoints are
    //    step nodes becomes a nodeOutput mapping on the target.
    const autoExposed = [];
    const connections = [];
    for (const conn of engine.connections.values()) {
        const fromId = conn.from ?? conn.fromWindowId;
        const toId = conn.to ?? conn.toWindowId;
        if (!selectedNodeIds.has(fromId) || !selectedNodeIds.has(toId)) continue;
        if (!stepIdSet.has(fromId) || !stepIdSet.has(toId)) continue;
        if (!conn.toInput) continue;

        const toNode = nodesById.get(toId);
        const fromNode = nodesById.get(fromId);
        if (!toNode || !fromNode) continue;

        // Each step kind emits a fixed canonical output key defined by its
        // backend tool. For tool steps we honor whatever the canvas
        // connection stored, falling back to 'output'.
        let outputKey;
        if (fromNode.kind === 'primitive') outputKey = PRIMITIVE_OUTPUT_KEY;
        else if (fromNode.kind === 'expression') outputKey = EXPRESSION_OUTPUT_KEY;
        else outputKey = conn.fromOutput || 'output';

        toNode.parameterMappings[conn.toInput] = {
            type: 'nodeOutput',
            nodeId: fromId,
            outputKey,
        };
        connections.push({
            fromWindowId: fromId,
            fromOutput: outputKey,
            toWindowId: toId,
            toInput: conn.toInput,
            type: conn.dataType ?? conn.type,
        });
    }

    // 4. Auto-expose any required input that has neither a static value nor
    //    an incoming wire — otherwise the spell would fail at run time the
    //    moment a caster tries to execute it. This uniformly catches:
    //      - empty primitives with no downstream static (primitive.value unmapped)
    //      - required tool inputs the user never filled and never wired
    for (const [nodeId, node] of nodesById) {
        const schema = node.inputSchema || {};
        for (const [paramKey, paramDef] of Object.entries(schema)) {
            if (!paramDef?.required) continue;
            const mapping = (node.parameterMappings || {})[paramKey];
            if (mapping) continue; // already has a static or nodeOutput
            autoExposed.push({ nodeId, paramKey });
        }
    }

    // 5. Order nodes roughly left-to-right by canvas x-coordinate so the
    //    step list in the modal matches visual flow. Proper topological
    //    sort is a follow-up when the spell edit view lands.
    const nodes = stepWindows
        .map(w => nodesById.get(w.id))
        .filter(Boolean)
        .sort((a, b) => (a.workspaceX - b.workspaceX) || (a.workspaceY - b.workspaceY));

    return { nodes, connections, autoExposed };
}

/**
 * Does this selection produce a composable spell? Requires at least one
 * "real action" window (tool or expression) in the selection — a selection
 * of only primitives wouldn't form a useful spell — AND at least one
 * internal connection that touches a step node.
 */
export function selectionHasInternalConnection(engine, selectedNodeIds) {
    if (!selectedNodeIds || selectedNodeIds.size < 2) return false;
    const actionIds = new Set();   // tools + expressions
    const allStepIds = new Set();  // tools + expressions + primitives
    for (const id of selectedNodeIds) {
        const win = engine.windows.get(id);
        if (!win) continue;
        if (win.type === 'tool' && win.tool) {
            actionIds.add(id);
            allStepIds.add(id);
        } else if (win.type === 'expression') {
            actionIds.add(id);
            allStepIds.add(id);
        } else if (win.type === 'primitive') {
            allStepIds.add(id);
        }
    }
    if (actionIds.size === 0) return false;
    for (const conn of engine.connections.values()) {
        const from = conn.fromWindowId ?? conn.from;
        const to = conn.toWindowId ?? conn.to;
        if (!selectedNodeIds.has(from) || !selectedNodeIds.has(to)) continue;
        if (allStepIds.has(from) && allStepIds.has(to)) return true;
    }
    return false;
}
