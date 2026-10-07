/**
 * 界面元素登记处：引导要高亮的元素、纸条要飞去的星星，都在这里按 id 登记，
 * 需要时量出它们在屏幕上的位置。
 *
 * 位置统一换算成「相对覆盖层根节点」的坐标：安卓上 measureInWindow 是否包含状态栏
 * 因机型而异，覆盖层自己也量一次再相减，两边的偏差就抵消了。
 */
import { useCallback, useEffect, useRef } from "react";
import type { View } from "react-native";

export type Rect = { x: number; y: number; w: number; h: number };

export type TargetId =
  | "hero-pet"
  | "hero-star"
  | "count"
  | "composer"
  | "dump-sheet"
  | "dump-input"
  | "remind-first"
  | "tab-mailbox"
  | "tonight-letter"
  | "mail-pet";

const nodes = new Map<TargetId, View>();
let origin: View | null = null;

/** 覆盖层根节点登记自己，作为坐标原点。 */
export function setOverlayOrigin(view: View | null) {
  origin = view;
}

function measureWin(view: View): Promise<Rect | null> {
  return new Promise((resolve) => {
    try {
      view.measureInWindow((x, y, w, h) => {
        resolve(Number.isFinite(x) && w > 0 && h > 0 ? { x, y, w, h } : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** 量一个已登记元素；不存在、没布局完或不可见时返回 null。 */
export async function measureTarget(id: TargetId): Promise<Rect | null> {
  const node = nodes.get(id);
  if (!node) return null;
  const [r, o] = await Promise.all([measureWin(node), origin ? measureWin(origin) : Promise.resolve(null)]);
  if (!r) return null;
  return o ? { x: r.x - o.x, y: r.y - o.y, w: r.w, h: r.h } : r;
}

/**
 * 把一个 View 登记为目标：`<View ref={useTarget("count")} collapsable={false}>`。
 * 安卓会把纯布局 View 优化掉导致量不到，所以目标 View 要带 collapsable={false}。
 */
export function useTarget(id: TargetId) {
  const current = useRef<View | null>(null);
  useEffect(() => () => {
    if (current.current && nodes.get(id) === current.current) nodes.delete(id);
  }, [id]);
  return useCallback((view: View | null) => {
    if (view) nodes.set(id, view);
    else if (current.current && nodes.get(id) === current.current) nodes.delete(id);
    current.current = view;
  }, [id]);
}
