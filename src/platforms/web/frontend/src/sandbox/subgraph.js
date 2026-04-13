/**
 * subgraph.js — serialize a canvas2 selection into the shape
 * consumed by SpellsModal / the /api/v1/spells create endpoint.
 *
 * Reads directly from the CanvasEngine's live Maps — canvas2 does not sync
 * to the legacy state.js activeToolWindows, so this is the source of truth.
 *
 * Node handling:
 *   - tool       → emitted as a step using its existing parameterMappings
 *   - expression → emitted as a step with toolIdentifier 'expression'
 *                  (the backend ExpressionAdapter is already registered as
 *                  a tool; see src/core/tools/definitions/expressionTool.js).
 *                  The expression string is stored as a static mapping.
 *   - primitive  → NOT emitted as a step (backend has no primitive-step
 *                  concept). A filled primitive's value is baked into
 *                  downstream steps as a static parameterMapping. An empty
 *                  primitive is dropped but its target param is tagged as
 *                  an autoExpose candidate so the mint modal pre-checks it.
 *   - other      → ignored (upload, collection, etc. are not spell-able).
 *
 * Connections where both endpoints are emitted steps are translated into
 * nodeOutput parameterMappings on the target, matching how
 * ParameterResolver.resolveMappings looks them up at execute time.
 */

// Must match the backend expressionTool.toolId.
const EXPRESSION_TOOL_ID = 'expression';
// Matches the outputSchema key in src/core/tools/definitions/expressionTool.js.
const EXPRESSION_DEFAULT_OUTPUT_KEY = 'result';

/**
 * Extract the inputSchema for a window, falling back through the known
 * shapes used in canvas2 for tools and expressions.
 */
function getInputSchemaFor(win) {
    if (!win) return {};
    if (win.type === 'tool') {
        return win.tool?.inputSchema || win.tool?.metadata?.inputSchema || {};
    }
    if (win.type === 'expression') {
        // Mirrors src/core/tools/definitions/expressionTool.js inputSchema.
        return {
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
        };
    }
    return {};
}

/**
 * Read a primitive window's current value. Empty string / null / undefined
 * means "user hasn't filled this in" and it should become an exposable input.
 */
function readPrimitiveValue(win) {
    if (!win || win.type !== 'primitive') return undefined;
    // Text primitives store their typed string in `value`.
    // Number/other primitives likewise put the raw value in `value`.
    if (win.value === undefined || win.value === null) return undefined;
    if (typeof win.value === 'string' && win.value.trim() === '') return undefined;
    return win.value;
}

/**
 * Serialize a subset of the canvas into a spell subgraph.
 *
 * @param {import('./canvas2/CanvasEngine.js').CanvasEngine} engine
 * @param {Set<string>} selectedNodeIds
 * @returns {{
 *   nodes: Array<{
 *     id: string,
 *     type: 'tool' | 'expression',
 *     toolId: string,
 *     displayName: string,
 *     workspaceX: number,
 *     workspaceY: number,
 *     output: any,
 *     parameterMappings: Record<string, { type: 'static' | 'nodeOutput', [k: string]: any }>,
 *     inputSchema: Record<string, any>,
 *   }>,
 *   connections: Array<{ fromWindowId: string, fromOutput: string, toWindowId: string, toInput: string, type?: string }>,
 *   autoExposed: Array<{ nodeId: string, paramKey: string }>,
 * }}
 */
export function serializeSubgraph(engine, selectedNodeIds) {
    // 1. Partition selected windows by type.
    const stepWindows = [];   // tools + expressions that become steps
    const primitives = [];    // filled-or-empty primitives, folded into downstream
    for (const id of selectedNodeIds) {
        const win = engine.windows.get(id);
        if (!win) continue;
        if (win.type === 'tool' && win.tool) {
            stepWindows.push(win);
        } else if (win.type === 'expression') {
            stepWindows.push(win);
        } else if (win.type === 'primitive') {
            primitives.push(win);
        }
        // Other types (upload, collection, collectionTest, spell) are ignored.
    }

    const stepIdSet = new Set(stepWindows.map(w => w.id));
    const primitiveIdSet = new Set(primitives.map(w => w.id));

    // 2. Build an initial node object for each step with a mutable mapping clone.
    const nodesById = new Map();
    for (const win of stepWindows) {
        const isExpr = win.type === 'expression';
        const base = {
            id: win.id,
            type: isExpr ? 'expression' : 'tool',
            toolId: isExpr ? EXPRESSION_TOOL_ID : win.tool.toolId,
            displayName: isExpr ? 'Expression' : win.tool.displayName,
            workspaceX: win.x,
            workspaceY: win.y,
            output: win.output || null,
            parameterMappings: { ...(win.parameterMappings || {}) },
            inputSchema: getInputSchemaFor(win),
        };
        if (isExpr) {
            // The expression string itself is the `expression` param.
            base.parameterMappings.expression = {
                type: 'static',
                value: win.expression || '',
            };
        }
        nodesById.set(win.id, base);
    }

    // 3. Walk all connections once. Classify by (from, to) membership.
    //    - step → step  : emit nodeOutput mapping on target
    //    - primitive → step : bake primitive value as static OR mark auto-expose
    //    - step/primitive → primitive : ignore (primitives are not steps)
    //    - anything else : ignore
    const autoExposed = [];
    const connections = [];
    for (const conn of engine.connections.values()) {
        const fromId = conn.from ?? conn.fromWindowId;
        const toId = conn.to ?? conn.toWindowId;
        if (!selectedNodeIds.has(fromId) || !selectedNodeIds.has(toId)) continue;

        const toNode = nodesById.get(toId);

        // Case A: primitive → step
        if (primitiveIdSet.has(fromId) && stepIdSet.has(toId) && toNode && conn.toInput) {
            const primWin = engine.windows.get(fromId);
            const primValue = readPrimitiveValue(primWin);
            if (primValue !== undefined) {
                // Bake the filled primitive as a static default on the target.
                toNode.parameterMappings[conn.toInput] = {
                    type: 'static',
                    value: primValue,
                };
            } else {
                // Empty primitive → the target param becomes an exposable
                // spell input. We do NOT insert a mapping (so cast-time
                // parameterOverrides flow through pipelineContext).
                // Clear any pre-existing mapping so nothing shadows the override.
                delete toNode.parameterMappings[conn.toInput];
                autoExposed.push({
                    nodeId: toId,
                    paramKey: conn.toInput,
                });
            }
            continue; // primitive connections are not emitted in the connections list
        }

        // Case B: step → step
        if (stepIdSet.has(fromId) && stepIdSet.has(toId) && toNode && conn.toInput) {
            const fromNode = nodesById.get(fromId);
            // Expression tool outputs live under the key 'result' by default.
            const defaultOutputKey = fromNode?.type === 'expression'
                ? EXPRESSION_DEFAULT_OUTPUT_KEY
                : (conn.fromOutput || 'output');
            const outputKey = conn.fromOutput || defaultOutputKey;

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
            continue;
        }
        // All other cases: ignore.
    }

    // 4. Order nodes by their original selection insertion order, so canvas
    //    layout (left-to-right) roughly becomes step order. This is a
    //    heuristic; the proper spell edit view (follow-up PR) will allow
    //    explicit reordering.
    const nodes = stepWindows
        .map(w => nodesById.get(w.id))
        .filter(Boolean)
        .sort((a, b) => (a.workspaceX - b.workspaceX) || (a.workspaceY - b.workspaceY));

    return { nodes, connections, autoExposed };
}

/**
 * Does this selection produce a composable spell? Requires at least one
 * tool/expression window AND at least one connection whose endpoint lands
 * on that step-producing window. Used to decide whether Compose Spell is a
 * valid action for the current selection.
 */
export function selectionHasInternalConnection(engine, selectedNodeIds) {
    if (!selectedNodeIds || selectedNodeIds.size < 2) return false;
    // Need at least one tool or expression window in the selection, because
    // the backend can only execute those as steps.
    const stepIds = new Set();
    for (const id of selectedNodeIds) {
        const win = engine.windows.get(id);
        if (!win) continue;
        if (win.type === 'tool' && win.tool) stepIds.add(id);
        else if (win.type === 'expression') stepIds.add(id);
    }
    if (stepIds.size === 0) return false;
    // And at least one connection internal to the selection that feeds or
    // chains a step node — otherwise the subgraph has nothing to serialize
    // as real spell wiring.
    for (const conn of engine.connections.values()) {
        const from = conn.fromWindowId ?? conn.from;
        const to = conn.toWindowId ?? conn.to;
        if (!selectedNodeIds.has(from) || !selectedNodeIds.has(to)) continue;
        if (stepIds.has(to) || stepIds.has(from)) return true;
    }
    return false;
}
