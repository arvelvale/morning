/**
 * 「今晚的信」：今天的晚间来信还没到时，信箱顶上放一封封好的信封，米露在旁边攒今天的事。
 * 摸一下信封它会晃一晃；信到了就变成「拆开看看」。新手引导的最后一步亮的就是它。
 */
import React, { useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Star } from "lucide-react-native";

import { HomePetArtwork } from "../../components/HomePetArtwork";
import { useReducedMotion, useTheme } from "../../design-system";
import { useGuide } from "../../guide/Guide";
import { useTarget } from "../../guide/targets";

/** 晚间来信的送达时间（后端定时任务：东八区 21:30）。 */
const LETTER_TIME = "21:30";

export function TonightLetter({ arrived, onOpen, petName, petPresetId, petEmoji }: {
  /** 今天的信已经到了 */
  arrived: boolean;
  onOpen: () => void;
  petName: string;
  petPresetId: string | null;
  petEmoji: string;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const guide = useGuide();
  const cardRef = useTarget("tonight-letter");
  const petRef = useTarget("mail-pet");
  const wiggle = useRef(new Animated.Value(0)).current;
  const [poke, setPoke] = useState(0);
  const [line, setLine] = useState<string | null>(null);
  const lineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (text: string) => {
    setLine(text);
    if (lineTimer.current) clearTimeout(lineTimer.current);
    lineTimer.current = setTimeout(() => setLine(null), 2200);
  };

  const press = () => {
    setPoke((k) => k + 1);
    if (!reduced) {
      wiggle.setValue(0);
      Animated.timing(wiggle, { toValue: 1, duration: 600, easing: Easing.linear, useNativeDriver: true }).start();
    }
    guide.emit("envelope");
    if (arrived && !guide.active) onOpen();
    else say(arrived ? "信到啦，拆开看看？" : `还没到点哦，${LETTER_TIME} 见`);
  };

  const now = new Date();
  const late = now.getHours() * 60 + now.getMinutes() >= 21 * 60 + 30;

  return (
    // 2026-10 收紧：上下留白原来是 40/20，米露要探出横幅 26px 才不压字。
    // 现在米露改成大半坐在横幅里（只探出 ~12px），上面一行（今天 N 封 / 整理 / 搜索）与横幅之间 14，横幅与下一段 6。
    <View style={{ marginTop: 14, marginBottom: 6 }}>
      <View collapsable={false} pointerEvents="none" ref={petRef}
        style={{ position: "absolute", right: -2, top: -12, width: 76, height: 76, zIndex: 2 }}>
        <HomePetArtwork
          fallbackEmoji={petEmoji}
          halo={false}
          look={guide.lookFor("mail-pet")}
          mood={poke && guide.active === false && arrived ? "happy" : "thinking"}
          pokeKey={poke}
          presetId={petPresetId}
          size={56}
        />
      </View>
      {line ? (
        <View pointerEvents="none" style={{
          position: "absolute", left: 4, top: -38, zIndex: 3, paddingHorizontal: 12, paddingVertical: 6,
          borderRadius: 15, borderBottomLeftRadius: 4, backgroundColor: theme.colors.surfaceElevated, ...theme.shadows.soft,
        }}>
          <Text style={[theme.typography.textStyles.petVoice, { fontSize: 15, lineHeight: 21, color: theme.colors.textPrimary }]}>{line}</Text>
        </View>
      ) : null}
      <Animated.View style={{
        transform: [{ rotate: wiggle.interpolate({ inputRange: [0, 0.2, 0.45, 0.7, 1], outputRange: ["0deg", "-2.4deg", "2deg", "-1deg", "0deg"] }) }],
      }}>
        <Pressable
          accessibilityHint={arrived ? "拆开今天的信" : `今晚 ${LETTER_TIME} 送达`}
          accessibilityLabel="今晚的信"
          accessibilityRole="button"
          collapsable={false}
          onPress={press}
          ref={cardRef}
          style={({ pressed }) => ({
            minHeight: 68, borderRadius: 18, overflow: "hidden", backgroundColor: theme.colors.envelope,
            flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, paddingRight: 84, paddingVertical: 12,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          {/* 改版（2026-10-14）：原来占半屏的大信封缩成一条，信的内容在下面的列表里 */}
          <View style={{ width: 44, height: 32, borderRadius: 6, overflow: "hidden", backgroundColor: theme.colors.surface }}>
            <Svg height="70%" preserveAspectRatio="none" style={{ position: "absolute", left: 0, top: 0 }} viewBox="0 0 100 62" width="100%">
              <Path d="M0 0H100L50 62Z" fill={theme.colors.envelopeFlap} />
            </Svg>
            <View style={{
              position: "absolute", left: "50%", top: "62%", width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: 8,
              backgroundColor: theme.colors.todo, alignItems: "center", justifyContent: "center",
            }}>
              <Star color={theme.colors.star} fill={theme.colors.star} size={8} />
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[theme.typography.textStyles.emotionalTitle, { fontSize: 17, lineHeight: 24, color: theme.colors.textPrimary }]}>
              {arrived ? "今天的信到了" : `今晚 ${LETTER_TIME} 的信`}
            </Text>
            <Text numberOfLines={1} style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted }]}>
              {arrived ? "点一下拆开" : late ? `${petName}还在写…` : `${petName}在攒今天的事…`}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}
