import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import { Clapperboard, Mail, Star, UserRound } from "lucide-react-native";

import { useTarget } from "../../guide/targets";
import { useReducedMotion } from "../accessibility";
import { useTheme } from "../theme";
import { iconSizes, spacing, touchTarget, zIndices } from "../tokens";

export type AppTab = "companion" | "mailbox" | "scene" | "profile";

type NavigationProps = {
  active: AppTab;
  onChange: (tab: AppTab) => void;
};

const items = [
  { id: "companion", label: "今日", icon: Star },
  { id: "mailbox", label: "信箱", icon: Mail },
  { id: "scene", label: "片场", icon: Clapperboard },
  { id: "profile", label: "我的", icon: UserRound },
] as const;

/** 选中态：深靛实心胶囊垫在图标下，切换时弹性滑过去（改版第二稿）。 */
const PILL_W = 54;
const PILL_H = 30;

function NavigationItem({
  active,
  compact,
  icon: Icon,
  id,
  label,
  onLayout,
  onPress,
}: {
  active: boolean;
  compact: boolean;
  icon: typeof Star;
  id: AppTab;
  label: string;
  onLayout?: (e: LayoutChangeEvent) => void;
  onPress: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  // 引导第五步要亮「信箱」
  const mailboxRef = useTarget("tab-mailbox");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      collapsable={false}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onLayout={onLayout}
      onPress={onPress}
      ref={id === "mailbox" ? mailboxRef : undefined}
      style={({ pressed }) => ({
        minWidth: touchTarget.minimum,
        minHeight: compact ? 54 : 64,
        flex: compact ? 1 : undefined,
        width: compact ? undefined : 72,
        paddingVertical: spacing[1],
        borderRadius: theme.radii.control,
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        backgroundColor: !compact && hovered && !active ? theme.colors.surfaceHover : "transparent",
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <View style={{ width: PILL_W, height: PILL_H, alignItems: "center", justifyContent: "center",
        borderRadius: PILL_H / 2, backgroundColor: !compact && active ? theme.colors.accent : "transparent" }}>
        <Icon
          size={iconSizes.default}
          color={active ? theme.colors.textOnAccent : theme.colors.textMuted}
          strokeWidth={active ? 2.2 : 1.8}
        />
      </View>
      <Text
        style={[
          theme.typography.textStyles.label,
          {
            color: active ? theme.colors.textPrimary : theme.colors.textMuted,
            fontWeight: active ? "600" : "400",
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function BottomNavigation({ active, onChange }: NavigationProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  // 每个格子的中心 x，用来把胶囊滑到选中项下面
  const [centers, setCenters] = useState<Partial<Record<AppTab, number>>>({});
  const pillX = useRef(new Animated.Value(-999)).current;
  const placed = useRef(false);

  useEffect(() => {
    const cx = centers[active];
    if (cx == null) return;
    const to = cx - PILL_W / 2;
    if (!placed.current || reduced) {
      pillX.setValue(to);
      placed.current = true;
      return;
    }
    Animated.spring(pillX, { toValue: to, friction: 7, tension: 120, useNativeDriver: true }).start();
  }, [active, centers, pillX, reduced]);

  // 实心底栏：全宽贴底、完全不透明的 surface 面 + 顶部发丝线 + 上抛柔影。
  // 不用半透明 GlassSurface：Android 无 backdrop-blur，列表文字会直接穿透底栏。
  const liftShadow: ViewStyle = Platform.select({
    web: {
      boxShadow: theme.isNight
        ? "0 -8px 24px rgba(0,0,0,0.32)"
        : "0 -8px 24px rgba(33,29,50,0.07)",
    },
    default: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: theme.isNight ? 0.3 : 0.06,
      shadowRadius: 12,
      elevation: 10,
    },
  }) as ViewStyle;

  return (
    <View
      accessibilityRole="tablist"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: zIndices.navigation,
        flexDirection: "row",
        alignItems: "center",
        paddingTop: spacing[2],
        paddingHorizontal: spacing[2],
        paddingBottom: spacing[3],
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        ...liftShadow,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: spacing[2] + spacing[1],
          width: PILL_W,
          height: PILL_H,
          borderRadius: PILL_H / 2,
          backgroundColor: theme.colors.accent,
          transform: [{ translateX: pillX }],
        }}
      />
      {items.map(({ id, icon, label }) => (
        <NavigationItem
          key={id}
          active={active === id}
          compact
          icon={icon}
          id={id}
          label={label}
          onLayout={(e) => {
            const { x, width } = e.nativeEvent.layout;
            setCenters((c) => (c[id] === x + width / 2 ? c : { ...c, [id]: x + width / 2 }));
          }}
          onPress={() => onChange(id)}
        />
      ))}
    </View>
  );
}

export function SideNavigation({ active, onChange }: NavigationProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={{
        width: 96,
        flexShrink: 0,
        paddingHorizontal: spacing[3],
        paddingTop: spacing[6],
        paddingBottom: spacing[4],
        alignItems: "center",
        borderRightWidth: 1,
        borderRightColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View
        accessibilityLabel="喵灵"
        style={{
          width: 44,
          height: 44,
          marginBottom: spacing[8],
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 14,
          backgroundColor: theme.colors.sky,
        }}
      >
        <Star size={20} color={theme.colors.star} fill={theme.colors.star} strokeWidth={1.8} />
      </View>

      <View style={{ gap: spacing[2] }}>
        {items.map(({ id, icon, label }) => (
          <NavigationItem
            key={id}
            active={active === id}
            compact={false}
            icon={icon}
            id={id}
            label={label}
            onPress={() => onChange(id)}
          />
        ))}
      </View>

      <View style={{ flex: 1 }} />
      <Text
        style={[
          theme.typography.textStyles.label,
          { color: theme.colors.textMuted, textAlign: "center" },
        ]}
      >
        喵灵
      </Text>
    </View>
  );
}
