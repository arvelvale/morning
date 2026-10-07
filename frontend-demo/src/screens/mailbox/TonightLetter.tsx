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
    <View style={{ marginTop: 64, marginBottom: 8 }}>
      <View collapsable={false} pointerEvents="none" ref={petRef}
        style={{ position: "absolute", right: -6, top: -104, width: 124, height: 124, zIndex: 2 }}>
        <HomePetArtwork
          fallbackEmoji={petEmoji}
          halo={false}
          look={guide.lookFor("mail-pet")}
          mood={poke && guide.active === false && arrived ? "happy" : "thinking"}
          pokeKey={poke}
          presetId={petPresetId}
          size={80}
        />
      </View>
      {line ? (
        <View pointerEvents="none" style={{
          position: "absolute", left: 4, top: -48, zIndex: 3, paddingHorizontal: 12, paddingVertical: 6,
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
            height: 176, borderRadius: 24, overflow: "hidden", backgroundColor: theme.colors.envelope,
            transform: [{ scale: pressed ? 0.98 : 1 }], ...theme.shadows.soft,
          })}
        >
          <Svg height="62%" preserveAspectRatio="none" style={{ position: "absolute", left: 0, top: 0 }} viewBox="0 0 100 62" width="100%">
            <Path d="M0 0H100L50 62Z" fill={theme.colors.envelopeFlap} />
          </Svg>
          <View style={{
            position: "absolute", left: "50%", top: "62%", width: 46, height: 46, marginLeft: -23, marginTop: -23, borderRadius: 23,
            backgroundColor: theme.colors.todo, alignItems: "center", justifyContent: "center",
          }}>
            <Star color={theme.colors.star} fill={theme.colors.star} size={21} />
          </View>
          <View style={{ position: "absolute", left: 18, right: 18, bottom: 14, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <Text style={[theme.typography.textStyles.sectionTitle, { color: theme.colors.textPrimary }]}>
              {arrived ? "今天的信到了" : late ? `${petName}还在写` : `今晚 ${LETTER_TIME} 送达`}
            </Text>
            <Text numberOfLines={1} style={[theme.typography.textStyles.label, { color: theme.colors.textMuted, fontWeight: "400", flexShrink: 1 }]}>
              {arrived ? "拆开看看" : `${petName}在攒今天的事`}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}
