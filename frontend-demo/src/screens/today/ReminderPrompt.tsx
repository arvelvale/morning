/**
 * 今日页顶部的一句轻问：「米露发现你 10:15 有一件事，要提醒你吗？」
 * 只在有具体时刻、还没过、还没设提醒、没点过「不用」的待办上出现，多条只问最近的一条（判定见 todoLogic.pickPrompt）。
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { Bell } from "lucide-react-native";

import { useReducedMotion, useTheme } from "../../design-system";
import { dueSpoken, type TodoItem } from "../todos/todoLogic";

export function ReminderPrompt({ todo, petName, onRemind, onDismiss }: {
  todo: TodoItem;
  petName: string;
  onRemind: () => Promise<unknown> | void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  // 出现时淡入并轻轻落下 6px；减弱动态时直接出现
  const appear = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { appear.setValue(1); return; }
    Animated.timing(appear, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [appear, reduced, todo.id]);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try { await onRemind(); } finally { setBusy(false); }
  };

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        marginTop: 8, flexDirection: "row", alignItems: "center", gap: 10,
        paddingLeft: 12, paddingRight: 8, paddingVertical: 10, borderRadius: 20,
        backgroundColor: theme.colors.todoSoft,
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
      }}
    >
      <View style={{
        width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center",
        backgroundColor: theme.colors.surface,
      }}>
        <Bell color={theme.colors.todo} size={15} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[theme.typography.textStyles.body, { fontSize: 14, lineHeight: 20, color: theme.colors.textPrimary }]}>
          {`${petName}发现你 ${dueSpoken(todo.dueAt)} 有一件事，要提醒你吗？`}
        </Text>
        <Text numberOfLines={1} style={[theme.typography.textStyles.caption, { color: theme.colors.textSecondary }]}>
          {todo.text}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
        <Pressable
          accessibilityLabel="不用提醒"
          accessibilityRole="button"
          hitSlop={6}
          onPress={onDismiss}
          style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 7, opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={[theme.typography.textStyles.label, { color: theme.colors.textMuted, fontWeight: "400" }]}>不用</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="提醒我"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void accept()}
          style={({ pressed }) => ({
            paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
            backgroundColor: theme.colors.todo, opacity: busy ? 0.6 : 1, transform: [{ scale: pressed ? 0.95 : 1 }],
          })}
        >
          <Text style={[theme.typography.textStyles.label, { color: theme.colors.surface, fontWeight: "600" }]}>提醒我</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
