import type { LayoutNode } from './types';

export function supportAncestor(a: LayoutNode, b: LayoutNode, byId: Map<string, LayoutNode>): boolean {
  const seen = new Set<string>();
  let n: LayoutNode | undefined = a;
  while (n?.carrier && !seen.has(n.id)) {
    seen.add(n.id);
    if (n.carrier.hostId === b.id) return true;
    n = byId.get(n.carrier.hostId);
  }
  return false;
}

/** Child footprint corners in the host's local horizontal axes (scaled metres). */
export function footprintInHost(child: LayoutNode, host: LayoutNode) {
  if (!child.box) return [];
  const box = child.box;
  const result: [number, number][] = [];
  for (const x of [-box.hw, box.hw]) for (const z of [-box.hd, box.hd]) {
    const lx = x + (box.cx ?? 0), lz = z + (box.cz ?? 0);
    const wx = child.x + lx * Math.cos(child.rotY) + lz * Math.sin(child.rotY) - host.x;
    const wz = child.z - lx * Math.sin(child.rotY) + lz * Math.cos(child.rotY) - host.z;
    result.push([wx * Math.cos(host.rotY) - wz * Math.sin(host.rotY), wx * Math.sin(host.rotY) + wz * Math.cos(host.rotY)]);
  }
  return result;
}

export function relationRadius(n: LayoutNode) {
  return n.kind === 'char' ? .34 * Math.max(.6, n.scale) : Math.max(n.box?.hw ?? .5, n.box?.hd ?? .5);
}
