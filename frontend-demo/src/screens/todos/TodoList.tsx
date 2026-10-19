/**
 * 「待办」栏：按 今天 / 之后 / 没定时间 / 已完成 分组。
 * 每行：完成勾选、事情、事情时间、提醒开关（规则同今日页：提前 15 分钟 / 当天 8 点 / 明早 8 点），已完成的可删除。
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Bell, Check, ListTodo, Trash2 } from "lucide-react-native";

import { EmptyState, useTheme } from "../../design-system";
import { useTodos } from "./TodosContext";
import {
  dueLabel, groupTodos, planReminder, remindButtonText, remindOnText, type TodoItem,
} from "./todoLogic";

const SECTIONS = [
  { key: "today", title: "今天" },
  { key: "later", title: "之后" },
  { key: "undated", title: "没定时间" },
  { key: "done", title: "已完成" },
] as const;

export function TodoList() {
  const theme = useTheme();
  const api = useTodos();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    void api.refresh();
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => groupTodos(api.todos, now), [api.todos, now]);

  if (api.loaded && api.todos.length === 0) {
    return (
      <EmptyState
        icon={<ListTodo color={theme.colors.textMuted} size={24} />}
        title="还没有待办"
        description="在今日页倒一倒，要做的事会自己排到这里。"
      />
    );
  }

  return (
    <View style={{ gap: theme.spacing[5] }}>
      {SECTIONS.filter((s) => groups[s.key].length > 0).map((s) => (
        <View key={s.key}>
          <Text style={[theme.typography.textStyles.label, { color: theme.colors.textMuted, marginBottom: theme.spacing[1] }]}>
            {s.title} · {groups[s.key].length}
          </Text>
          {groups[s.key].map((todo) => <TodoRow key={todo.id} now={now} todo={todo} />)}
        </View>
      ))}
    </View>
  );
}

function TodoRow({ todo, now }: { todo: TodoItem; now: Date }) {
  const theme = useTheme();
  const api = useTodos();
  const set = api.reminders[String(todo.id)];
  const plan = !todo.done && !set ? planReminder(todo.dueAt, now) : null;
  const showRemind = !todo.done && (!!set || plan !== null);
  const muted = theme.colors.textMuted;

  return (
    <View style={{
      flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3],
      paddingVertical: theme.spacing[3], borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
    }}>
      <Pressable
        accessibilityLabel={todo.done ? "标为没做完" : "标为做完了"}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: todo.done }}
        hitSlop={8}
        onPress={() => void api.setDone(todo, !todo.done)}
        style={({ pressed }) => ({
          width: 24, height: 24, borderRadius: 12, marginTop: 1,
          alignItems: "center", justifyContent: "center",
          backgroundColor: todo.done ? theme.colors.accent : "transparent",
          borderWidth: 2, borderColor: todo.done ? theme.colors.accent : theme.colors.border,
          transform: [{ scale: pressed ? 0.9 : 1 }],
        })}
      >
        {todo.done ? <Check color={theme.colors.textOnAccent} size={13} /> : null}
      </Pressable>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[
          theme.typography.textStyles.body,
          { color: todo.done ? muted : theme.colors.textPrimary, textDecorationLine: todo.done ? "line-through" : "none" },
        ]}>
          {todo.text}
        </Text>
        <Text style={[theme.typography.textStyles.caption, { color: muted }]}>{dueLabel(todo.dueAt, now)}</Text>
        {showRemind ? (
          <Pressable
            accessibilityHint={set ? "再点一下取消提醒" : undefined}
            accessibilityRole="switch"
            accessibilityState={{ checked: !!set }}
            onPress={() => void (set ? api.unremind(todo.id) : api.remind(todo))}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: theme.spacing[1],
              paddingLeft: 8, paddingRight: 11, paddingVertical: 4, borderRadius: 999,
              borderWidth: set ? 0 : 1.5, borderColor: theme.colors.todo,
              backgroundColor: set ? theme.colors.todo : "transparent",
              transform: [{ scale: pressed ? 0.95 : 1 }],
            })}
          >
            {set ? <Check color={theme.colors.surface} size={13} /> : <Bell color={theme.colors.todo} size={13} />}
            <Text style={[theme.typography.textStyles.label, { color: set ? theme.colors.surface : theme.colors.todo, fontWeight: "600" }]}>
              {set ? remindOnText(new Date(set.at), now) : remindButtonText(plan!, now)}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {todo.done ? (
        <Pressable
          accessibilityLabel="删除这条已完成的待办"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => void api.remove(todo)}
          style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
        >
          <Trash2 color={muted} size={17} />
        </Pressable>
      ) : null}
    </View>
  );
}
