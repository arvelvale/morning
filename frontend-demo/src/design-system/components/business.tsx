import React from "react";
import {
  Image,
  type ImageSourcePropType,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";

import { useTheme } from "../theme";

type CompanionAvatarProps = {
  emoji?: string;
  size?: number;
  /** 优先展示真实形象图；无图时回退 emoji。 */
  source?: ImageSourcePropType;
  style?: StyleProp<ViewStyle>;
};

export function CompanionAvatar({
  emoji = "🌙",
  size = 40,
  source,
  style,
}: CompanionAvatarProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.accentSoft,
          borderColor: theme.colors.border,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {source ? (
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={source}
          style={{ width: size * 0.9, height: size * 0.9 }}
        />
      ) : (
        <Text style={{ fontSize: Math.round(size * 0.48) }}>{emoji}</Text>
      )}
    </View>
  );
}

type StatusDotProps = {
  color?: string;
  label?: string;
};

export function StatusDot({ color, label }: StatusDotProps) {
  const theme = useTheme();

  return (
    <View style={styles.statusRow}>
      <View
        accessibilityLabel={label}
        style={[
          styles.statusDot,
          { backgroundColor: color ?? theme.colors.success },
        ]}
      />
      {label ? (
        <Text style={[styles.statusLabel, { color: theme.colors.textMuted }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

type MessageBubbleProps = {
  variant: "agent" | "user";
  text: string;
  emoji?: string;
  pending?: boolean;
};

export function MessageBubble({
  variant,
  text,
  emoji,
  pending = false,
}: MessageBubbleProps) {
  const theme = useTheme();
  const isUser = variant === "user";

  return (
    <View
      style={[
        styles.messageRow,
        isUser ? styles.messageRowUser : styles.messageRowAgent,
      ]}
    >
      {!isUser ? <CompanionAvatar emoji={emoji} size={34} /> : null}
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: isUser
              ? theme.colors.accentSoft
              : theme.colors.surface,
            borderColor: isUser
              ? theme.colors.accent
              : theme.colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.bubbleText,
            {
              color: pending
                ? theme.colors.textMuted
                : theme.colors.textPrimary,
            },
            // 双方聊天正文均为系统无衬线，衬线仅留给情绪性标题。
            isUser
              ? null
              : {
                  fontFamily: theme.typography.fontFamilies.sans,
                  fontSize: 16,
                  lineHeight: 28,
                },
          ]}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  statusDot: {
    borderRadius: 5,
    height: 8,
    width: 8,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  messageRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 9,
    marginBottom: 12,
    width: "100%",
  },
  messageRowAgent: {
    justifyContent: "flex-start",
  },
  messageRowUser: {
    justifyContent: "flex-end",
  },
  bubble: {
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: "78%",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 23,
  },
});
