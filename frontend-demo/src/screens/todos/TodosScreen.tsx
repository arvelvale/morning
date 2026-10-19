/**
 * 「待办」Tab：两栏，顶部分段切换。
 * - 待办：要做的事，按 今天 / 之后 / 没定时间 / 已完成 分组，可设提醒、勾选完成；
 * - 随手记：灵感 / 情绪 / 记下的瞬间（原来在信箱的「思绪」里）。
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Card, PageContainer, PageHeader, useTheme } from "../../design-system";
import { NotesPanel } from "./NotesPanel";
import { TodoList } from "./TodoList";

const TABS = ["待办", "随手记"] as const;

export function TodosScreen({ onToast, initialTab = 0 }: { onToast?: (msg: string) => void; initialTab?: 0 | 1 }) {
  const theme = useTheme();
  const [tab, setTab] = useState<number>(initialTab);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
      <PageContainer maxWidth={760}>
        <PageHeader
          eyebrow="要做的事"
          title="待办"
          description="事情替你记着，到点我来叫你。"
        />
        {/* 分段切换：浅底胶囊，选中的一段浮起 */}
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: "row", alignSelf: "flex-start", padding: 3, marginBottom: theme.spacing[4],
            borderRadius: 999, backgroundColor: theme.colors.backgroundSubtle,
          }}
        >
          {TABS.map((label, i) => {
            const on = tab === i;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                key={label}
                onPress={() => setTab(i)}
                style={{
                  minWidth: 84, minHeight: 34, paddingHorizontal: theme.spacing[4], borderRadius: 999,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: on ? theme.colors.surface : "transparent",
                  ...(on ? theme.shadows.soft : {}),
                }}
              >
                <Text style={[theme.typography.textStyles.label, {
                  color: on ? theme.colors.textPrimary : theme.colors.textMuted, fontWeight: on ? "600" : "400",
                }]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Card style={{ width: "100%", minWidth: 0 }}>
          {tab === 0 ? <TodoList /> : <NotesPanel onToast={onToast} />}
        </Card>
      </PageContainer>
    </ScrollView>
  );
}
