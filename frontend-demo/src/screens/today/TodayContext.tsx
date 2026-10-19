/**
 * 首页「今日」的共享状态：今天接住的事、倒出来 / 今天接住的 两个抽屉、纸条飞行、首页角色的状态。
 *
 * 抽屉和纸条要盖住底栏，所以画在 App 根部（TodayOverlays），首页本身（TodayScreen）只读写这里的状态。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { streamBrainDump } from "../../api";
import { useGuide } from "../../guide/Guide";
import { measureTarget, type Rect } from "../../guide/targets";
import type { PetMood } from "../../pets/rig/types";
import { useTodos } from "../todos/TodosContext";
import { planReminder } from "../todos/todoLogic";
import {
  kindFromServer, loadTodayCaught, writeCache,
  type CaughtItem,
} from "./caught";

export type Flight = { id: number; text: string; from: Rect; delay: number };

type TodayApi = {
  petName: string;
  items: CaughtItem[];
  loaded: boolean;
  refresh: () => void;
  /** 每接住一件 +1：数字跳一下、星星亮一下。 */
  catchTick: number;

  dumpOpen: boolean;
  openDump: (seed?: string) => void;
  closeDump: () => void;
  draft: string;
  setDraft: (text: string) => void;
  /** 倒出来：纸条飞进星星，后端边分类边回来，数字一件件跳。 */
  submitDump: () => Promise<void>;
  dumping: boolean;

  caughtOpen: boolean;
  openCaught: () => void;
  closeCaught: () => void;
  remind: (item: CaughtItem) => Promise<void>;

  flights: Flight[];
  landed: (id: number) => void;

  /** 首页角色 */
  petMood: PetMood;
  petLevel: number;
  pokeKey: number;
  poke: () => void;
  typingPulse: () => void;
  bubble: { text: string; key: number } | null;
  say: (text: string, ms?: number) => void;
};

const TodayCtx = createContext<TodayApi | null>(null);

export function useToday(): TodayApi {
  const ctx = useContext(TodayCtx);
  if (!ctx) throw new Error("useToday 需要在 TodayProvider 里使用");
  return ctx;
}

/** 把一段话拆成几张纸条，只用于飞行动画；真正的分类以后端为准。 */
function pieces(text: string): string[] {
  return text
    .split(/[，,。.!！?？;；、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((s) => (s.length > 12 ? `${s.slice(0, 11)}…` : s));
}

export function TodayProvider({ children, enabled, petName, onToast, celebrate }: {
  children: React.ReactNode;
  /** 已登录且不是预览模式时才拉数据。 */
  enabled: boolean;
  petName: string;
  onToast: (msg: string) => void;
  /** 外部的临时状态（例如刚演完一幕回来）。 */
  celebrate?: boolean;
}) {
  const guide = useGuide();
  const todosApi = useTodos();
  const [items, setItems] = useState<CaughtItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [catchTick, setCatchTick] = useState(0);
  const [dumpOpen, setDumpOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [dumping, setDumping] = useState(false);
  const [caughtOpen, setCaughtOpen] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [happy, setHappy] = useState(false);
  const [petLevel, setPetLevel] = useState(0);
  const [pokeKey, setPokeKey] = useState(0);
  const [bubble, setBubble] = useState<{ text: string; key: number } | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const later = (name: string, ms: number, fn: () => void) => {
    clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(fn, ms);
  };
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const refresh = useCallback(() => {
    if (!enabled) return;
    loadTodayCaught()
      .then((list) => { setItems(list); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [enabled]);
  useEffect(() => { refresh(); }, [refresh]);

  // 引导需要知道的几个事实
  // 引导的「设提醒」一步只在有一件还能提醒的待办时出现（时间已过的设不了）
  const hasTodo = items.some((x) => x.kind === "todo" && !x.done && planReminder(x.dueAt) !== null);
  useEffect(() => {
    guide.setFacts({ dumpOpen, count: items.length, hasTodo });
  }, [guide, dumpOpen, items.length, hasTodo]);

  const say = useCallback((text: string, ms = 1800) => {
    setBubble({ text, key: Date.now() });
    later("bubble", ms, () => setBubble(null));
  }, []);

  const poke = useCallback(() => setPokeKey((k) => k + 1), []);

  const typingPulse = useCallback(() => {
    // 每敲一个字，耳朵抖一下
    setPetLevel(0.9);
    later("level", 150, () => setPetLevel(0));
  }, []);

  const openDump = useCallback((seed?: string) => {
    if (seed) setDraft((d) => (d.trim() ? `${d.trim()}，${seed}` : seed));
    setCaughtOpen(false);
    setDumpOpen(true);
  }, []);
  const closeDump = useCallback(() => setDumpOpen(false), []);
  const openCaught = useCallback(() => {
    if (itemsRef.current.length === 0) {
      say("还没有呢，倒点什么给我？");
      poke();
      return;
    }
    setDumpOpen(false);
    setCaughtOpen(true);
    guide.emit("caughtOpen");
  }, [guide, poke, say]);
  const closeCaught = useCallback(() => setCaughtOpen(false), []);

  const landed = useCallback((id: number) => {
    setFlights((fs) => fs.filter((f) => f.id !== id));
    poke();
  }, [poke]);

  const submitDump = useCallback(async () => {
    const text = draft.trim();
    if (!text || dumping) return;
    const from = (await measureTarget("dump-input")) ?? { x: 40, y: 400, w: 200, h: 40 };
    const base = Date.now();
    setFlights(pieces(text).map((p, i) => ({
      id: base + i,
      text: p,
      from: { x: from.x + 16 + (i % 2) * 36, y: from.y + 12 + i * 12, w: 0, h: 0 },
      delay: 320 + i * 240,
    })));
    setDumpOpen(false);
    setDumping(true);
    guide.hold(true);
    let got = 0;
    let ok = false;
    try {
      await streamBrainDump(text, (e) => {
        if (e.event !== "item.classified") return;
        const kind = kindFromServer(String(e.data?.kind ?? ""));
        if (!kind) return;
        got += 1;
        const item: CaughtItem = {
          id: Number(e.data.memory_id),
          kind,
          text: String(e.data.surface_text || e.data.content || "").trim(),
          dueAt: null, // 流式回执里没带时间，倾倒结束后会整体刷新一遍（见下方 refresh）
          createdAt: new Date().toISOString(),
        };
        setItems((list) => {
          const next = [...list.filter((x) => x.id !== item.id), item];
          void writeCache(next);
          return next;
        });
        setCatchTick((t) => t + 1);
        setPokeKey((k) => k + 1);
      });
      ok = true;
      // 具体时间（「10点15开会」）后端存进 due_date，回执里没有，倾倒完拉一次才拿得到
      refresh();
      void todosApi.refresh();
      setDraft("");
      say(got ? `接住了 ${got} 件` : "原话我先替你收着了", 2200);
      setHappy(true);
      later("happy", 2400, () => setHappy(false));
    } catch (err: any) {
      setDraft(text);
      onToast(err?.message || "刚才没接住，再说一次？");
      say("刚才没接住，再说一次？", 2400);
    } finally {
      setDumping(false);
      // 等最后一张纸条落下再让引导往下走
      later("guide", 700, () => {
        guide.hold(false);
        if (ok) guide.emit("caught");
      });
    }
  }, [draft, dumping, guide, onToast, say, refresh, todosApi]);

  /**
   * 给这件待办设提醒：提醒时间由 planReminder 按事情时间算（提前 15 分钟 / 当天早 8 点 / 明早 8 点），
   * 只存本机、排本地通知，不改后端的 due_date。
   */
  const remind = useCallback(async (item: CaughtItem) => {
    if (todosApi.reminders[String(item.id)]) return;
    guide.emit("remind");
    await todosApi.remind({ id: item.id, text: item.text, dueAt: item.dueAt });
    if (guide.active) later("closeCaught", 900, () => setCaughtOpen(false));
  }, [guide, todosApi]);

  const petMood: PetMood = happy || celebrate ? "happy" : dumping ? "thinking" : dumpOpen ? "listening" : "idle";

  const api = useMemo<TodayApi>(() => ({
    petName, items, loaded, refresh, catchTick,
    dumpOpen, openDump, closeDump, draft, setDraft, submitDump, dumping,
    caughtOpen, openCaught, closeCaught, remind,
    flights, landed,
    petMood, petLevel, pokeKey, poke, typingPulse, bubble, say,
  }), [petName, items, loaded, refresh, catchTick, dumpOpen, openDump, closeDump, draft, submitDump, dumping,
    caughtOpen, openCaught, closeCaught, remind, flights, landed, petMood, petLevel, pokeKey, poke, typingPulse, bubble, say]);

  return <TodayCtx.Provider value={api}>{children}</TodayCtx.Provider>;
}
