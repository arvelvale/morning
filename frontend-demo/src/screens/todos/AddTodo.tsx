import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View, useWindowDimensions } from "react-native";
import { Button, ResponsiveOverlay, TextField, useTheme } from "../../design-system";
import { useTodos } from "./TodosContext";
import { todoPayload } from "./createTodo";
import { planReminder, remindWhen } from "./todoLogic";

function beijingDate(offset: number) {
  return new Date(Date.now() + 8 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
}

/** 手机底部抽屉、桌面居中表单；入口卸载时清空草稿，失败则留在表单中重试。 */
export function AddTodo({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const todos = useTodos();
  const { height } = useWindowDimensions();
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [remind, setRemind] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const draft = { text, date, time, remind };
  let reminderCopy = "";
  try {
    const payload = todoPayload({ ...draft, text: text || "待办" });
    const at = planReminder(payload.due_date);
    reminderCopy = at ? `${remindWhen(at)} 叫你` : "默认提醒时间已过，先记下，之后可在列表里设置提醒";
  } catch { reminderCopy = "填好日期和时间后，我会告诉你什么时候提醒"; }

  const close = () => { if (!submitting.current) onClose(); };
  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await todos.create(draft);
      onClose();
    } catch (err: any) {
      setError(err?.message || "没记下来，检查网络后再试试");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return (
    <ResponsiveOverlay visible title="添加待办" onClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: height * 0.66 }} contentContainerStyle={{ padding: theme.spacing[5], paddingBottom: theme.spacing[8], gap: theme.spacing[4] }}>
          <TextField label="要做什么" accessibilityLabel="待办内容" placeholder="比如：打印申请表" value={text} onChangeText={setText} maxLength={500} editable={!saving} returnKeyType="next" />
          <TextField label="日期（可不填）" accessibilityLabel="待办日期" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} maxLength={10} editable={!saving} autoCapitalize="none" />
          <View style={{ flexDirection: "row", gap: theme.spacing[2] }}>
            {[{ title: "今天", date: beijingDate(0) }, { title: "明天", date: beijingDate(1) }, { title: "先不定", date: "" }].map((choice) => (
              <Button key={choice.title} size="compact" variant="secondary" disabled={saving} onPress={() => { setDate(choice.date); if (!choice.date) setTime(""); }}>{choice.title}</Button>
            ))}
          </View>
          <TextField label="事情时间（可不填）" accessibilityLabel="待办时间" placeholder="HH:mm，例如 09:30" value={time} onChangeText={setTime} maxLength={5} editable={!saving} autoCapitalize="none" />
          <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted }]}>日期和时间按北京时间记录。没定时间也可以先记下。</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
            <Pressable disabled={saving} onPress={() => setRemind(!remind)} style={{ flex: 1 }}>
              <Text style={[theme.typography.textStyles.bodyStrong, { color: theme.colors.textPrimary }]}>提醒我</Text>
              <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textSecondary, marginTop: theme.spacing[1] }]}>{remind ? reminderCopy : "先替你记着，不设置定时提醒"}</Text>
            </Pressable>
            <Switch
              accessibilityLabel="添加后提醒我" value={remind} onValueChange={setRemind} disabled={saving}
              thumbColor={theme.colors.surface}
              {...(Platform.OS === "web" ? { activeThumbColor: theme.colors.surface } : {})}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
            />
          </View>
          <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted }]}>有具体时刻时提前 15 分钟，不足 15 分钟则到点；只有日期当天早上 8 点，没定时间明早 8 点。{Platform.OS === "web" ? "浏览器仅预览，系统通知需在手机上设置。" : "需要允许系统通知。"}</Text>
          {error ? <Text accessibilityRole="alert" style={[theme.typography.textStyles.body, { color: theme.colors.error }]}>{error}</Text> : null}
          <Button fullWidth loading={saving} disabled={!text.trim()} onPress={() => void submit()}>{remind ? "记下并提醒我" : "先记下来"}</Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </ResponsiveOverlay>
  );
}
