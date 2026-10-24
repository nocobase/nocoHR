// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  layoutFlowDiagram,
  partitionFlowDiagramReturns,
} from '../../client/components/flow-layout';
import {
  lifecycleDiagramGraph,
  lifecycleConfigurationSelection,
  lifecycleNodeConfigurationSelections,
} from '../../client/components/lifecycle-diagram-model';
import {
  presentationDescription as description,
  presentationHistory as history,
} from '../helpers/process-presentation';

describe('fixed template process presentation', () => {
  it.each(['RIGHT', 'DOWN'] as const)(
    'lays out actual ELK nodes and routes in %s, including return and self edges',
    async (direction) => {
      const graph = lifecycleDiagramGraph(description, {
        history,
        currentState: 'review',
        availableTransitions: ['approve'],
      });
      const result = await layoutFlowDiagram(graph, direction);
      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(4);
      for (const node of result.nodes) {
        expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
        expect(node.width).toBeGreaterThan(0);
      }
      for (const edge of result.edges)
        expect(edge.points.length).toBeGreaterThanOrEqual(2);
      expect(result.width).toBeGreaterThan(0);
      expect(graph.nodes.find((n) => n.id === 'review')).toMatchObject({
        highlighted: true,
        visited: true,
      });
      expect(graph.nodes.find((n) => n.id === 'approved')).toMatchObject({
        highlighted: false,
        visited: false,
      });
      expect(
        graph.edges.find((e) => e.id === '["return","review","draft"]')
          ?.visited,
      ).toBe(true);
      expect(
        graph.edges.find((e) => e.id === '["approve","review","approved"]'),
      ).toMatchObject({ visited: false, highlighted: true });
    },
  );
  it('keeps the declared path separate from actual history and preserves return explanations', () => {
    const graph = lifecycleDiagramGraph(description);
    expect(graph.edges.every((e) => !e.visited)).toBe(true);
    const routes = partitionFlowDiagramReturns(graph);
    expect(routes.edges).toHaveLength(2);
    expect(routes.extraEdges.map((e) => JSON.parse(e.id)[0])).toEqual([
      'return',
      'reviewAgain',
    ]);
  });
  it('handles an empty graph without fabricated nodes', async () => {
    const layout = await layoutFlowDiagram({ nodes: [], edges: [] });
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });
  it.each([
    {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'Duplicate' },
      ],
      edges: [],
    },
    { nodes: [{ id: 'a', label: 'A', width: 0 }], edges: [] },
    { nodes: [{ id: 'a', label: 'A', height: NaN }], edges: [] },
    {
      nodes: [{ id: 'a', label: 'A' }],
      edges: [{ id: 'bad', source: 'a', target: 'missing' }],
    },
    {
      nodes: [{ id: 'a', label: 'A' }],
      edges: [
        { id: 'dup', source: 'a', target: 'a' },
        { id: 'dup', source: 'a', target: 'a' },
      ],
    },
  ])(
    'rejects malformed layout inputs before ELK execution %#',
    async (graph) => {
      await expect(layoutFlowDiagram(graph)).rejects.toThrow();
    },
  );
  it('selects only declared, authorized parameter fields without executing or saving', () => {
    const canConfigure = (_group: unknown, field: string) => field === 'days';
    const selection = lifecycleConfigurationSelection(
      description,
      { kind: 'transition', name: 'approve' },
      canConfigure,
    );
    expect(selection?.groups[0].fields).toHaveProperty('days');
    expect(selection?.groups[0].fields).not.toHaveProperty('privateRule');
    expect(
      lifecycleConfigurationSelection(
        description,
        { kind: 'transition', name: 'approve' },
        () => false,
      ),
    ).toBeUndefined();
    expect(
      lifecycleConfigurationSelection(
        description,
        { kind: 'state', name: 'missing' },
        () => true,
      ),
    ).toBeUndefined();
    expect(
      lifecycleNodeConfigurationSelections(description, 'review', canConfigure),
    ).toHaveLength(1);
  });
});
