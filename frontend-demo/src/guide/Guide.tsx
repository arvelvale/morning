/**
 * 新手引导：在真实界面上遮罩挖洞，只亮一个元素，旁边由米露说一句话。
 *
 * - 没有独立的教程页，也没有「下一步」按钮：每一步都要用户真的做一次对应操作
 *  （戳它 / 倒出来 / 点开数字 / 设提醒 / 去信箱 / 摸信封），界面把这个动作 emit 过来才往下走；
 * - 点暗处不推进，米露会提醒「先试试亮着的地方」；右上角随时能跳过；
 * - 片场不放进第一次引导：第一天用不到它，等收到第一封剧场邀请时再说。
 *
 * 用法：GuideProvider 包住整个 App（遮罩画在最上层）；要高亮的元素用 targets.ts 的 useTarget 登记；
 * 用户做了动作就 useGuide().emit(key)。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Pointer } from "lucide-react-native";

import { CatHead } from "../components/CatHead";
import { useReducedMotion, useTheme } from "../design-system";
import type { PetLook } from "../pets/rig/types";
import { measureTarget, setOverlayOrigin, type Rect, type TargetId } from "./targets";

export type GuideKey = "pokeCat" | "caught" | "caughtOpen" | "remind" | "tab:mailbox" | "envelope";

/** 界面当前的几个事实，决定这一步亮哪儿、说什么、要不要跳过。 */
export type GuideFacts = { dumpOpen: boolean; count: number; hasTodo: boolean };

type Step = {
  key: GuideKey;
  title: string;
  target: (f: GuideFacts) => TargetId;
  place: "above" | "below";
  say: (f: GuideFacts, pet: string) => string;
  act: (f: GuideFacts, pet: string) => string;
  /** 角色本身：洞收窄到身体，圆一点。 */
  shape?: "pet";
  skip?: (f: GuideFacts) => boolean;
  /** 做完以后停多久再亮下一步（让用户看清刚才发生了什么）。 */
  after: number;
};

export const GUIDE_STEPS: Step[] = [
  {
    key: "pokeCat", title: "戳戳它", target: () => "hero-pet", place: "below", shape: "pet", after: 900,
    say: (_, pet) => `嗨，我是${pet}。先戳我一下？`, act: () => "轻点它",
  },
  {
    key: "caught", title: "一股脑倒出来", place: "above", after: 300,
    target: (f) => (f.dumpOpen ? "dump-sheet" : "composer"),
    say: (f) => (f.dumpOpen ? "随便说，不用整理。" : "心里乱糟糟的时候，都倒给我。"),
    act: (f, pet) => (f.dumpOpen ? `写几句，或点下面的句子，再点「倒给${pet}」` : "点这里"),
  },
  {
    key: "caughtOpen", title: "看它接住了什么", target: () => "count", place: "below", after: 650,
    say: (f) => `接住了 ${f.count} 件。看看我放哪儿了？`, act: () => "点开这个数字",
    skip: (f) => f.count === 0,
  },
  {
    key: "remind", title: "让它明早提醒你", target: () => "remind-first", place: "below", after: 1300,
    say: () => "这件事，明早 8 点我来叫你？", act: () => "点「明早提醒我」",
    skip: (f) => !f.hasTodo,
  },
  {
    key: "tab:mailbox", title: "今晚会有一封信", target: () => "tab-mailbox", place: "above", after: 800,
    say: () => "今晚，我会把今天写成一封信。", act: () => "去信箱看看",
  },
  {
    key: "envelope", title: "信放在这儿", target: () => "tonight-letter", place: "below", after: 1200,
    say: () => "信会放在这儿。到点再拆哦。", act: () => "摸一下信封",
  },
];

const DONE_KEY = "morning.guide.v2.done";

export async function guideSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DONE_KEY)) === "1";
  } catch {
    return true; // 读不到就别打扰
  }
}

async function markSeen() {
  try {
    await AsyncStorage.setItem(DONE_KEY, "1");
  } catch {
    /* ignore */
  }
}

type GuideApi = {
  active: boolean;
  /** 当前这一步要的动作；没在引导时为 null。 */
  stepKey: GuideKey | null;
  start: () => void;
  stop: (skipped?: boolean) => void;
  emit: (key: GuideKey) => void;
  /** 动画进行中（纸条在飞）：遮罩淡出但仍拦住点击。 */
  hold: (on: boolean) => void;
  setFacts: (patch: Partial<GuideFacts>) => void;
  /** 引导时角色看向被高亮的地方。 */
  lookFor: (pet: "hero-pet" | "mail-pet") => PetLook;
};

const NOOP_API: GuideApi = {
  active: false, stepKey: null,
  start() {}, stop() {}, emit() {}, hold() {}, setFacts() {}, lookFor: () => null,
};
const GuideCtx = createContext<GuideApi>(NOOP_API);
export const useGuide = () => useContext(GuideCtx);

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function GuideProvider({ children, petName, onFinish }: {
  children: React.ReactNode;
  petName: string;
  /** 走完全程（不含跳过）时回调，例如弹一句收尾。 */
  onFinish?: () => void;
}) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [waiting, setWaiting] = useState(false); // 做完一步、停顿中
  const [holding, setHolding] = useState(false);
  const [facts, setFactsState] = useState<GuideFacts>({ dumpOpen: false, count: 0, hasTodo: false });
  const [look, setLook] = useState<{ pet: "hero-pet" | "mail-pet"; value: PetLook } | null>(null);
  const factsRef = useRef(facts);
  factsRef.current = facts;
  const busy = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  /** 从 i 开始找第一个不该跳过的步骤；走完返回 -1。 */
  const nextIndex = (i: number) => {
    for (let k = i; k < GUIDE_STEPS.length; k++) {
      if (!GUIDE_STEPS[k].skip?.(factsRef.current)) return k;
    }
    return -1;
  };

  const stop = useCallback((skipped = false) => {
    clearTimers();
    busy.current = false;
    setActive(false);
    setWaiting(false);
    setHolding(false);
    setLook(null);
    void markSeen();
    if (!skipped) onFinish?.();
  }, [onFinish]);

  const start = useCallback(() => {
    clearTimers();
    busy.current = false;
    setIndex(0);
    setWaiting(false);
    setHolding(false);
    setActive(true);
  }, []);

  const emit = useCallback((key: GuideKey) => {
    if (!active || busy.current) return;
    const step = GUIDE_STEPS[index];
    if (!step || step.key !== key) return;
    busy.current = true;
    setWaiting(true);
    setHolding(false);
    timers.current.push(setTimeout(() => {
      const next = nextIndex(index + 1);
      busy.current = false;
      if (next < 0) { stop(false); return; }
      setIndex(next);
      setWaiting(false);
    }, step.after));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index, stop]);

  const api = useMemo<GuideApi>(() => ({
    active,
    stepKey: active ? GUIDE_STEPS[index]?.key ?? null : null,
    start,
    stop,
    emit,
    hold: (on) => { if (active) setHolding(on); },
    setFacts: (patch) => setFactsState((f) => {
      const next = { ...f, ...patch };
      return next.dumpOpen === f.dumpOpen && next.count === f.count && next.hasTodo === f.hasTodo ? f : next;
    }),
    lookFor: (pet) => (look && look.pet === pet ? look.value : null),
  }), [active, index, start, stop, emit, look]);

  useEffect(() => () => clearTimers(), []);

  return (
    <GuideCtx.Provider value={api}>
      {children}
      <GuideOverlay
        active={active}
        facts={facts}
        holding={holding}
        index={index}
        onLook={setLook}
        onSkip={() => stop(true)}
        petName={petName}
        waiting={waiting}
      />
    </GuideCtx.Provider>
  );
}

/* ───────────────────────────── 遮罩层 ───────────────────────────── */

function roundRectPath({ x, y, w, h }: Rect, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + rr} ${y}H${x + w - rr}A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}V${y + h - rr}`
    + `A${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}H${x + rr}A${rr} ${rr} 0 0 1 ${x} ${y + h - rr}`
    + `V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}Z`;
}

/** 每个目标的洞形：圆角与留白。 */
function holeFor(id: TargetId, r: Rect, shape?: "pet"): Rect & { radius: number } {
  if (shape === "pet") {
    // 角色画布四周有留白，收窄到身体
    const w = r.w * 0.66, h = r.h * 0.78;
    return { x: r.x + (r.w - w) / 2, y: r.y + r.h * 0.12, w, h, radius: w / 2.4 };
  }
  const pad = id === "dump-sheet" ? 0 : 6;
  const radius = ({ composer: 30, count: 20, "dump-sheet": 28, "tab-mailbox": 18, "tonight-letter": 26, "remind-first": 20 } as Record<string, number>)[id] ?? 18;
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2, radius: radius + pad };
}

function GuideOverlay({ active, facts, holding, index, onLook, onSkip, petName, waiting }: {
  active: boolean;
  facts: GuideFacts;
  holding: boolean;
  index: number;
  onLook: (v: { pet: "hero-pet" | "mail-pet"; value: PetLook } | null) => void;
  onSkip: () => void;
  petName: string;
  waiting: boolean;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const rootRef = useRef<View>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hole, setHole] = useState<Rect & { radius: number }>({ ...ZERO, radius: 0 });
  const [tip, setTip] = useState({ w: 260, h: 90 });
  const [nudge, setNudge] = useState(false);
  const shown = useRef(new Animated.Value(0)).current;
  const tipIn = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const goal = useRef<(Rect & { radius: number }) | null>(null);
  const cur = useRef<(Rect & { radius: number }) | null>(null);
  const raf = useRef<number | null>(null);

  const step = GUIDE_STEPS[index];
  const targetId = step?.target(facts);

  // 遮罩整体淡入淡出
  useEffect(() => {
    Animated.timing(shown, {
      toValue: active && !holding ? 1 : 0,
      duration: reduced ? 0 : 280,
      useNativeDriver: true,
    }).start();
  }, [active, holding, reduced, shown]);

  // 每一步的提示框弹入
  useEffect(() => {
    if (!active || waiting) {
      tipIn.setValue(0);
      return;
    }
    tipIn.setValue(0);
    Animated.spring(tipIn, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
  }, [active, waiting, index, targetId, tipIn]);

  // 高亮圈的呼吸
  useEffect(() => {
    if (!active || reduced) return;
    const loop = Animated.loop(Animated.timing(pulse, {
      toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [active, reduced, pulse]);

  // 洞的位置：持续测量目标（抽屉滑动、切页时目标在动），再平滑地追过去
  useEffect(() => {
    if (!active || !targetId) return;
    let alive = true;
    const tick = async () => {
      const r = await measureTarget(targetId);
      if (!alive || !r) return;
      goal.current = holeFor(targetId, r, step.shape);
      if (!cur.current) {
        // 第一次：从整屏收拢到目标
        cur.current = { x: 0, y: 0, w: size.w || r.w, h: size.h || r.h, radius: 36 };
      }
      kick();
      // 角色看向高亮处
      const petId = targetId === "tonight-letter" ? "mail-pet" : "hero-pet";
      if (targetId === "hero-pet") onLook({ pet: "hero-pet", value: [0, 0.15] });
      else {
        const p = await measureTarget(petId);
        if (alive && p) {
          const dx = (r.x + r.w / 2) - (p.x + p.w / 2);
          const dy = (r.y + r.h / 2) - (p.y + p.h * 0.35);
          onLook({ pet: petId, value: [clamp(dx / 150, -1, 1), clamp(dy / 220, -0.6, 1)] });
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 160);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, targetId, size.w, size.h]);

  useEffect(() => {
    if (!active) { cur.current = null; goal.current = null; onLook(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const kick = () => {
    if (raf.current != null) return;
    let last = Date.now();
    const frame = () => {
      const g = goal.current, c = cur.current;
      if (!g || !c) { raf.current = null; return; }
      const now = Date.now(), dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = reduced ? 1 : 1 - Math.exp(-dt * 12);
      let moving = false;
      (["x", "y", "w", "h", "radius"] as const).forEach((key) => {
        const d = g[key] - c[key];
        if (Math.abs(d) > 0.4) moving = true;
        c[key] = Math.abs(d) > 0.4 ? c[key] + d * k : g[key];
      });
      setHole({ ...c });
      raf.current = moving ? requestAnimationFrame(frame) : null;
    };
    raf.current = requestAnimationFrame(frame);
  };
  useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);

  const onRoot = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  const doNudge = () => {
    if (!active || holding || waiting) return;
    setNudge(true);
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.5, duration: 80, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setNudge(false), 1500);
  };

  if (!active || !step) {
    return <View pointerEvents="none" ref={(v) => { rootRef.current = v; setOverlayOrigin(v); }} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} onLayout={onRoot} />;
  }

  const W = size.w, H = size.h;
  const h = hole;
  // 提示框方位：按这一步定的方向放，放不下就翻到另一侧
  let place = step.place;
  let top = place === "below" ? h.y + h.h + 14 : h.y - tip.h - 14;
  if (place === "below" && top + tip.h > H - 10) { place = "above"; top = h.y - tip.h - 14; }
  if (place === "above" && top < 56) { place = "below"; top = h.y + h.h + 14; }
  const tipW = Math.min(290, W - 24);
  const cx = h.x + h.w / 2;
  const left = clamp(cx - tipW / 2, 12, Math.max(12, W - tipW - 12));
  const arrowX = clamp(cx - left, 24, tipW - 24);
  const dim = theme.colors.overlay;
  const blocking = holding || waiting;

  return (
    <View
      onLayout={onRoot}
      pointerEvents="box-none"
      ref={(v) => { rootRef.current = v; setOverlayOrigin(v); }}
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 100, elevation: 100 }}
    >
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: W, height: H, opacity: shown }}>
        {W > 0 ? (
          <Svg width={W} height={H}>
            <Path d={`M0 0H${W}V${H}H0Z ${roundRectPath(h, h.radius)}`} fill={dim} fillRule="evenodd" />
          </Svg>
        ) : null}
      </Animated.View>

      {/* 拦截：洞外的点击不推进，只提醒；动画进行中整屏拦住 */}
      {blocking ? (
        <View style={{ position: "absolute", left: 0, top: 0, width: W, height: H }} />
      ) : (
        <>
          <Pressable accessible={false} onPress={doNudge} style={{ position: "absolute", left: 0, top: 0, width: W, height: Math.max(0, h.y) }} />
          <Pressable accessible={false} onPress={doNudge} style={{ position: "absolute", left: 0, top: h.y + h.h, width: W, height: Math.max(0, H - h.y - h.h) }} />
          <Pressable accessible={false} onPress={doNudge} style={{ position: "absolute", left: 0, top: h.y, width: Math.max(0, h.x), height: h.h }} />
          <Pressable accessible={false} onPress={doNudge} style={{ position: "absolute", left: h.x + h.w, top: h.y, width: Math.max(0, W - h.x - h.w), height: h.h }} />
        </>
      )}

      {/* 高亮圈 */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute", left: h.x, top: h.y, width: h.w, height: h.h, borderRadius: h.radius,
          borderWidth: 2, borderColor: theme.colors.star,
          opacity: Animated.multiply(shown, waiting ? 0 : 1),
        }}
      >
        <Animated.View
          style={{
            position: "absolute", left: -2, top: -2, right: -2, bottom: -2, borderRadius: h.radius + 2,
            borderWidth: 2, borderColor: theme.colors.star,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }],
          }}
        />
      </Animated.View>

      {/* 米露说的话 */}
      <Animated.View
        accessibilityLiveRegion="polite"
        onLayout={(e) => setTip({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{
          position: "absolute", left, top, width: tipW,
          opacity: Animated.multiply(Animated.multiply(shown, tipIn), waiting ? 0 : 1),
          transform: [
            { translateY: tipIn.interpolate({ inputRange: [0, 1], outputRange: [place === "below" ? -6 : 6, 0] }) },
            { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) },
          ],
        }}
      >
        <View style={{
          flexDirection: "row", gap: 10, padding: 12, paddingRight: 14, borderRadius: 20,
          backgroundColor: "#FFFFFF",
          shadowColor: "#000000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.3, shadowRadius: 24, elevation: 12,
        }}>
          <CatHead size={36} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[theme.typography.textStyles.petVoice, { color: "#211D32" }]}>
              {nudge ? "先试试亮着的地方～" : step.say(facts, petName)}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, paddingRight: 44 }}>
              <Pointer color="#7563DE" size={14} />
              <Text style={[theme.typography.textStyles.caption, { color: "#6E6880", flexShrink: 1 }]}>{step.act(facts, petName)}</Text>
            </View>
          </View>
          <View style={{ position: "absolute", right: 12, bottom: 12, flexDirection: "row", gap: 4 }}>
            {GUIDE_STEPS.map((s, k) => (
              <View key={s.key} style={{
                width: k === index ? 12 : 5, height: 5, borderRadius: 3,
                backgroundColor: k === index ? "#211D32" : k < index ? "#B9AEE8" : "#E3DCEC",
              }} />
            ))}
          </View>
        </View>
        <View style={{
          position: "absolute", left: arrowX - 7, width: 14, height: 14, borderRadius: 3, backgroundColor: "#FFFFFF",
          transform: [{ rotate: "45deg" }],
          ...(place === "below" ? { top: -6 } : { bottom: -6 }),
        }} />
      </Animated.View>

      <Animated.View style={{ position: "absolute", right: 16, top: 12, opacity: shown }}>
        <Pressable
          accessibilityLabel="跳过引导"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onSkip}
          style={({ pressed }) => ({
            paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
            backgroundColor: pressed ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.16)",
          })}
        >
          <Text style={[theme.typography.textStyles.caption, { color: "#FFFFFF" }]}>跳过引导</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
