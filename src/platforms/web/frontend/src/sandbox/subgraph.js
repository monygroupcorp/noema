/**
 * Serialize a subset of canvas2 windows and their internal connections
 * into the shape consumed by SpellsModal / the spells API.
 *
 * Reads directly from the CanvasEngine's live Maps — canvas2 does not sync
 * to the legacy state.js activeToolWindows, so this is the source of truth.
 *
 * @param {import('./canvas2/CanvasEngine.js').CanvasEngine} engine
 * @param {Set<string>} selectedNodeIds
 * @returns {{ nodes: Array, connections: Array }}
 */
export function serializeSubgraph(engine, selectedNodeIds) {
    const nodes = [];
    for (const id of selectedNodeIds) {
        const win = engine.windows.get(id);
        if (!win || win.type !== 'tool' || !win.tool) continue;
        nodes.push({
            id: win.id,
            displayName: win.tool.displayName,
            toolId: win.tool.toolId,
            workspaceX: win.x,
            workspaceY: win.y,
            output: win.output,
            parameterMappings: win.parameterMappings || {},
        });
    }

    const connections = [];
    for (const conn of engine.connections.values()) {
        const from = conn.fromWindowId ?? conn.from;
        const to = conn.toWindowId ?? conn.to;
        if (!selectedNodeIds.has(from) || !selectedNodeIds.has(to)) continue;
        connections.push({
            fromWindowId: from,
            fromOutput: conn.fromOutput,
            toWindowId: to,
            toInput: conn.toInput,
            type: conn.dataType ?? conn.type,
        });
    }

    return { nodes, connections };
}

/**
 * Does this selection have at least one internal connection between selected nodes?
 * Used to decide whether Compose Spell is a valid action for the current selection.
 */
export function selectionHasInternalConnection(engine, selectedNodeIds) {
    if (!selectedNodeIds || selectedNodeIds.size < 2) return false;
    for (const conn of engine.connections.values()) {
        const from = conn.fromWindowId ?? conn.from;
        const to = conn.toWindowId ?? conn.to;
        if (selectedNodeIds.has(from) && selectedNodeIds.has(to)) return true;
    }
    return false;
}
