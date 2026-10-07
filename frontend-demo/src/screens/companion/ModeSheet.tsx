/**
 * 模式选择：底部/侧栏浮层，选择「自由聊聊 / 一股脑倒 / 放不下的事 / 回看片段」。
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { BookOpen, ChevronRight, Clapperboard, Cloud, Mountain, Waves } from "lucide-react-native";

import { ListItem, ResponsiveOverlay, useTheme } from "../../design-system";

type ModeSheetProps = {
  onChat: (mode: string) => void;
  onClose: () => void;
  /** 翻往日对话（原首页「往日」入口）。 */
  onJournal?: () => void;
  onSleepDump: () => void;
  visible: boolean;
};

const modes = [
  {
    description: "随便聊点什么，没有主题",
    icon: Cloud,
    label: "自由聊聊",
    mode: "free_chat",
  },
  {
    description: "把今天的念头一次全说出来",
    icon: Waves,
    label: "一股脑倒出来",
    mode: "_dump",
  },
  {
    description: "有什么在心里反复出现",
    icon: Mountain,
    label: "说件放不下的事",
    mode: "hard_thing",
  },
  {
    description: "回到某段记忆里看看",
    icon: Clapperboard,
    label: "回看一个片段",
    mode: "review_fragment",
  },
  {
    description: "以前聊过的，都在这儿",
    icon: BookOpen,
    label: "翻翻往日",
    mode: "_journal",
  },
];

/** 陪伴模式选择浮层。 */
export function ModeSheet({
  onChat,
  onClose,
  onJournal,
  onSleepDump,
  visible,
}: ModeSheetProps) {
  const theme = useTheme();

  return (
    <ResponsiveOverlay onClose={onClose} title="想怎么聊？" visible={visible}>
      <ScrollView
        contentContainerStyle={{
          gap: theme.spacing[1],
          padding: theme.spacing[4],
        }}
      >
        {modes.filter((mode) => mode.mode !== "_journal" || onJournal).map((mode) => {
          const ModeIcon = mode.icon;
          return (
            <ListItem
              description={mode.description}
              key={mode.mode}
              leading={
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: theme.radii.control,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.colors.accentSoft,
                  }}
                >
                  <ModeIcon color={theme.colors.accent} size={20} />
                </View>
              }
              onPress={() =>
                mode.mode === "_dump" ? onSleepDump() : mode.mode === "_journal" ? onJournal?.() : onChat(mode.mode)
              }
              title={mode.label}
              trailing={
                <ChevronRight color={theme.colors.textMuted} size={18} />
              }
            />
          );
        })}
      </ScrollView>
    </ResponsiveOverlay>
  );
}
