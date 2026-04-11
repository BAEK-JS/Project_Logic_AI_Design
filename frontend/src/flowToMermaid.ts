import type { Node, Edge } from '@xyflow/react';

export function nodesToMermaid(nodes: Node[], edges: Edge[]): string {
  const lines = ['flowchart TD'];

  for (const node of nodes) {
    const label = String(node.data?.label ?? node.id);
    lines.push(`  ${node.id}["${label.replace(/"/g, "'")}"]`);
  }

  for (const edge of edges) {
    const lbl = typeof edge.label === 'string' ? edge.label.trim() : '';
    if (lbl) {
      lines.push(`  ${edge.source} -->|${lbl}| ${edge.target}`);
    } else {
      lines.push(`  ${edge.source} --> ${edge.target}`);
    }
  }

  return lines.join('\n');
}
