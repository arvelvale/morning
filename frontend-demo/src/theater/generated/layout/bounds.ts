import type { LayoutNode } from './types';

/** World-space AABB; use independent axes, rotated local center and vertical range. */
export function worldBounds(n: LayoutNode) {
  const c = Math.cos(n.rotY), s = Math.sin(n.rotY);
  const hw = n.box?.hw ?? .34 * n.scale, hd = n.box?.hd ?? .34 * n.scale;
  const cx = n.box?.cx ?? 0, cz = n.box?.cz ?? 0;
  const x = n.x + cx * c + cz * s, z = n.z - cx * s + cz * c;
  const rx = Math.abs(c) * hw + Math.abs(s) * hd;
  const rz = Math.abs(s) * hw + Math.abs(c) * hd;
  const minY = n.y + (n.box?.minY ?? 0);
  return { minX: x - rx, maxX: x + rx, minZ: z - rz, maxZ: z + rz,
    minY, maxY: minY + (n.box?.h ?? (n.pose === 'sitting' ? 1.3 : 1.7) * n.scale) };
}

export function boundsOverlap(a: LayoutNode, b: LayoutNode): { axis: 'x' | 'z'; depth: number } | null {
  if (a.backdrop || b.backdrop) return null;
  const x = worldBounds(a), y = worldBounds(b);
  const dy = Math.min(x.maxY, y.maxY) - Math.max(x.minY, y.minY);
  if (dy <= .02) return null;
  // Exit translation, including the case where one box fully contains the other.
  const dx = Math.min(x.maxX - y.minX, y.maxX - x.minX);
  const dz = Math.min(x.maxZ - y.minZ, y.maxZ - x.minZ);
  if (dx <= .02 || dz <= .02) return null;
  return dx < dz ? { axis: 'x', depth: dx } : { axis: 'z', depth: dz };
}
