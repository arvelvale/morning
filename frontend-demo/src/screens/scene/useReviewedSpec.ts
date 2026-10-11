/**
 * 校验回传环的 React 接入：生成式 3D 场景打开后，先在端上解算+校验；
 * 若有"改规格能解决"的问题，后台让导演（LLM）按问题清单改最多 2 轮，只采纳分数更低的稿，
 * 采纳后换上新场景并存回后端（下次直接打开改好的版本）。
 *
 * 观看不被它阻塞：始终先渲染原稿，改稿完成才替换；任何一步失败都静默保留原稿。
 * 判分/采纳/防护规则见 theater/generated/layout/review.ts（带单元测试）。
 */
import { useEffect, useRef, useState } from "react";
import { reviseSceneSpec, saveSceneSpec } from "../../api";
import { isSemanticSpec } from "../../theater/generated/layout/solve";
import { MAX_ROUNDS, reviewSpec } from "../../theater/generated/layout/review";
import type { SemanticSceneSpec } from "../../theater/generated/layout/types";
import type { SceneSpec } from "../../theater";

/** 等场景先画出来、手势和动画稳定后再开始解算改稿，避免和首屏抢主线程。 */
const START_DELAY_MS = 1200;

export function useReviewedSpec(
  sceneId: number | null | undefined,
  spec: SceneSpec | SemanticSceneSpec | null | undefined,
): SceneSpec | SemanticSceneSpec | null | undefined {
  const [revised, setRevised] = useState<{ id: number; spec: SemanticSceneSpec } | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;
  const done = useRef<Set<number>>(new Set());
  const hasSpec = !!spec;

  useEffect(() => {
    const first = specRef.current;
    if (!sceneId || !first || !isSemanticSpec(first) || done.current.has(sceneId)) return;
    if ((first.review?.rounds ?? 0) >= MAX_ROUNDS) return;   // 已经改满，不再烧模型
    done.current.add(sceneId);
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const out = await reviewSpec(first, {
          revise: async (current, items) => {
            const res = await reviseSceneSpec(sceneId, current, items);
            return (res?.spec as SemanticSceneSpec | null) ?? null;
          },
        });
        if (out.rounds === 0) return;
        if (out.log.length) console.log(`[scene-review #${sceneId}]`, out.before, "→", out.after, out.log.join("；"));
        // 即使一轮都没改进也存"改过几轮"的记录，下次打开不重复请求
        await saveSceneSpec(sceneId, out.spec).catch((e) => console.warn("[scene-review] 存回失败", e));
        if (alive && out.after < out.before) setRevised({ id: sceneId, spec: out.spec });
      } catch (e) {
        console.warn("[scene-review] 改稿流程失败，保留原稿", e);
      }
    }, START_DELAY_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [sceneId, hasSpec]);

  return revised && revised.id === sceneId ? revised.spec : spec;
}
