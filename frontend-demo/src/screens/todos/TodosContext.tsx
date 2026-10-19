/**
 * 待办的共享状态：全部待办、本机提醒、「不用」名单。
 * 今日页（横幅 / 接下来 / 今天接住的）和「待办」Tab 读写的是同一份，提醒状态不会两边不一致。
 *
 * 提醒只存本机（见 reminderStore.ts），不会 PATCH 后端的 due_date。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import { deleteTodo, listTodos, updateTodo } from "../../api";
import { cancelTodoReminder, ensureNotificationPermission, scheduleTodoReminder } from "../../notifications";
import { loadDismissed, loadReminders, saveDismissed, saveReminders } from "./reminderStore";
import {
  clock, dueInfo, planReminder, toTodo,
  type ReminderMap, type TodoItem,
} from "./todoLogic";

type TodosApi = {
  todos: TodoItem[];
  loaded: boolean;
  refresh: () => Promise<void>;
  reminders: ReminderMap;
  dismissed: ReadonlySet<number>;
  /** 按默认规则给这条待办设提醒；成功返回 true（失败 / 无权限时已 toast）。 */
  remind: (todo: Pick<TodoItem, "id" | "text" | "dueAt">) => Promise<boolean>;
  unremind: (id: number) => Promise<void>;
  /** 今日页横幅点「不用」：记到本机，不再问这一条。 */
  dismissPrompt: (id: number) => void;
  setDone: (todo: TodoItem, done: boolean) => Promise<void>;
  remove: (todo: TodoItem) => Promise<void>;
};

const Ctx = createContext<TodosApi | null>(null);

export function useTodos(): TodosApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTodos 需要在 TodosProvider 里使用");
  return ctx;
}

export function TodosProvider({ children, enabled, petName, onToast }: {
  children: React.ReactNode;
  /** 已登录且不是预览模式时才拉数据。 */
  enabled: boolean;
  petName: string;
  onToast: (msg: string) => void;
}) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reminders, setReminders] = useState<ReminderMap>({});
  const [dismissedList, setDismissedList] = useState<number[]>([]);
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;
  const dismissedRef = useRef(dismissedList);
  dismissedRef.current = dismissedList;

  // 本机记录启动时读一次；读完之前不显示横幅（见 ready），免得「已设提醒」的先闪出一句问话
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([loadReminders(), loadDismissed()]).then(([r, d]) => {
      if (!alive) return;
      setReminders(r);
      setDismissedList(d);
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  const commitReminders = useCallback((next: ReminderMap) => {
    remindersRef.current = next;
    setReminders(next);
    void saveReminders(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const list = await listTodos("");
      const mapped = (Array.isArray(list) ? list : []).map(toTodo).filter((x): x is TodoItem => !!x);
      setTodos(mapped);
      // 清掉已不存在 / 已完成的待办的提醒记录，顺手取消对应的本地通知
      const alive = new Set(mapped.filter((x) => !x.done).map((x) => String(x.id)));
      const stale = Object.keys(remindersRef.current).filter((k) => !alive.has(k));
      if (stale.length) {
        const next = { ...remindersRef.current };
        for (const k of stale) {
          void cancelTodoReminder(next[k].notifId);
          delete next[k];
        }
        commitReminders(next);
      }
    } catch {
      /* 网络抖动：保持当前列表 */
    } finally {
      setLoaded(true);
    }
  }, [enabled, commitReminders]);
  useEffect(() => { void refresh(); }, [refresh]);

  const remind = useCallback(async (todo: Pick<TodoItem, "id" | "text" | "dueAt">) => {
    const now = new Date();
    // 设计值：有时刻提前 15 分钟 / 只有日期当天 8 点 / 没时间明早 8 点 → planReminder
    const at = planReminder(todo.dueAt, now);
    if (!at) {
      onToast("这件事的时间已经过了");
      return false;
    }
    if (!(await ensureNotificationPermission())) {
      onToast("通知没打开，到系统设置里允许一下，我才能叫你");
      return false;
    }
    const info = dueInfo(todo.dueAt);
    const notifId = await scheduleTodoReminder(petName, todo.text, at, info.kind === "time" ? clock(info.at) : undefined);
    if (Platform.OS !== "web" && !notifId) {
      onToast("提醒没设上，待会儿再试试");
      return false;
    }
    commitReminders({ ...remindersRef.current, [String(todo.id)]: { at: at.toISOString(), notifId } });
    return true;
  }, [petName, onToast, commitReminders]);

  const unremind = useCallback(async (id: number) => {
    const cur = remindersRef.current[String(id)];
    if (!cur) return;
    const next = { ...remindersRef.current };
    delete next[String(id)];
    commitReminders(next);
    await cancelTodoReminder(cur.notifId);
  }, [commitReminders]);

  const dismissPrompt = useCallback((id: number) => {
    const next = [...dismissedRef.current.filter((x) => x !== id), id];
    dismissedRef.current = next;
    setDismissedList(next);
    void saveDismissed(next);
  }, []);

  /** PATCH 之后后端换了新 id：把提醒记录和「不用」名单跟着搬到新 id 上。 */
  const migrateId = useCallback((from: number, to: number) => {
    if (from === to) return;
    const cur = remindersRef.current[String(from)];
    if (cur) {
      const next = { ...remindersRef.current };
      delete next[String(from)];
      next[String(to)] = cur;
      commitReminders(next);
    }
    if (dismissedRef.current.includes(from)) {
      const next = [...dismissedRef.current.filter((x) => x !== from), to];
      dismissedRef.current = next;
      setDismissedList(next);
      void saveDismissed(next);
    }
  }, [commitReminders]);

  const setDone = useCallback(async (todo: TodoItem, done: boolean) => {
    setTodos((list) => list.map((x) => (x.id === todo.id ? { ...x, done } : x)));
    if (done) void unremind(todo.id);
    try {
      const updated = await updateTodo(todo.id, { status: done ? "done" : "pending" });
      const newId = Number(updated?.id);
      if (Number.isFinite(newId) && newId !== todo.id) {
        migrateId(todo.id, newId);
        setTodos((list) => list.map((x) => (x.id === todo.id ? { ...x, id: newId } : x)));
      }
    } catch (err: any) {
      setTodos((list) => list.map((x) => (x.id === todo.id ? { ...x, done: todo.done } : x)));
      onToast(err?.message || "没改成，待会儿再试试");
    }
  }, [migrateId, onToast, unremind]);

  const remove = useCallback(async (todo: TodoItem) => {
    setTodos((list) => list.filter((x) => x.id !== todo.id));
    void unremind(todo.id);
    try {
      await deleteTodo(todo.id);
    } catch (err: any) {
      setTodos((list) => (list.some((x) => x.id === todo.id) ? list : [...list, todo]));
      onToast(err?.message || "没删掉，待会儿再试试");
    }
  }, [onToast, unremind]);

  const dismissed = useMemo(() => new Set(dismissedList), [dismissedList]);
  const api = useMemo<TodosApi>(() => ({
    todos: ready ? todos : [], loaded: loaded && ready, refresh, reminders, dismissed,
    remind, unremind, dismissPrompt, setDone, remove,
  }), [todos, ready, loaded, refresh, reminders, dismissed, remind, unremind, dismissPrompt, setDone, remove]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
