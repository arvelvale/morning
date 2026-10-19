/**
 * 信箱的确认弹窗：删信、清空前都要问一句。
 * 不用 Alert.alert（RN Web 上它什么也不弹），统一用设计系统的 Dialog；危险动作用 danger 按钮。
 */
import React from "react";
import { Text, View } from "react-native";

import { Button, Dialog, useTheme } from "../../design-system";

export function ConfirmDialog({ visible, title, body, confirmLabel, onConfirm, onCancel }: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  return (
    <Dialog visible={visible} onClose={onCancel}>
      <View style={{ padding: 22, gap: 8 }}>
        <Text style={[theme.typography.textStyles.emotionalTitle, { fontSize: 19, lineHeight: 28, color: theme.colors.textPrimary }]}>
          {title}
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 22, color: theme.colors.textSecondary }}>{body}</Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" fullWidth onPress={onCancel}>先留着</Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="danger" fullWidth onPress={onConfirm}>{confirmLabel}</Button>
          </View>
        </View>
      </View>
    </Dialog>
  );
}
