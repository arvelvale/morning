/**
 * 首页「今日」：第一眼就是「今天接住了 N 件事」。
 *
 * 自上而下：问候 → 米露的夜空主卡（计数 + 四类拆分 + 抱着星星的米露）→ 接下来（明早的提醒、今晚的信）
 * → 唯一的主操作「一股脑倒出来」。猫不是插图：倒出来的话飞进它抱着的星星，星星随接住的数量变亮，
 * 打字时它竖耳朵，引导时它看向被高亮的地方。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { Bell, ChevronRight, Mail, Mic, MoonStar, Phone, Plus, Square, Sun } from "lucide-react-native";

import { getCompanionHome, listLetters } from "../../api";
import { HomePetArtwork } from "../../components/HomePetArtwork";
import { IconButton, useReducedMotion, useResponsive, useTheme } from "../../design-system";
import { useGuide } from "../../guide/Guide";
import { useTarget } from "../../guide/targets";
import { useVoiceInput } from "../../useVoiceInput";
import { ambientCalendar } from "../../utils/lunar";
import { isTomorrow, KIND_LABEL, KIND_ORDER, parseServerTime, startOfToday, type CaughtKind } from "./caught";
import { useToday } from "./TodayContext";

/** 晚间来信的送达时间（后端 main.py 的定时任务：东八区 21:30）。 */
const LETTER_TIME = "21:30";

/** 角色立绘的边长（HomePetArtwork 外框 = size × 1.55）。 */
const PET_SIZE = 156;
const PET_BOX = PET_SIZE * 1.55;
/** 米露抱着的星星在立绘外框里的相对位置（按 pet-rig 的取景框换算）。 */
export const STAR_AT = { x: 0.474, y: 0.683 };

/** 主卡上的几颗星（位置是卡片宽高的百分比）。 */
const SKY_DOTS: [number, number, number][] = [
  [9, 8, 1.6], [36, 92, 1.1], [41, 10, 1.3], [57, 34, 1], [72, 14, 1.5], [88, 40, 1], [52, 62, 1.2], [8, 94, 1],
];

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export function kindColors(theme: ReturnType<typeof useTheme>, kind: CaughtKind) {
  const c = theme.colors;
  return {
    todo: { fg: c.todo, bg: c.todoSoft },
    idea: { fg: c.idea, bg: c.ideaSoft },
    mood: { fg: c.mood, bg: c.moodSoft },
    frag: { fg: c.frag, bg: c.fragSoft },
  }[kind];
}

type TodayScreenProps = {
  night: boolean;
  onNightToggle: () => void;
  onVoiceCall: () => void;
  onModeSheet: () => void;
  onOpenMailbox: () => void;
  petEmoji: string;
  petPresetId: string | null;
};

export function TodayScreen({
  night,
  onNightToggle,
  onVoiceCall,
  onModeSheet,
  onOpenMailbox,
  petEmoji,
  petPresetId,
}: TodayScreenProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { isCompact } = useResponsive();
  const today = useToday();
  const guide = useGuide();
  const { items, catchTick, petName } = today;
  const [letterToday, setLetterToday] = useState(false);

  const heroPetRef = useTarget("hero-pet");
  const starRef = useTarget("hero-star");
  const countRef = useTarget("count");
  const composerRef = useTarget("composer");

  const cal = useMemo(() => ambientCalendar(), []);
  const now = new Date();
  const meta = `${now.getMonth() + 1}月${now.getDate()}日 · 周${"日一二三四五六"[now.getDay()]} · ${cal.term}`;

  // 首次进来：后端有主动邀请时，让米露说出来
  useEffect(() => {
    getCompanionHome()
      .then((home) => {
        const text = home?.invitation?.text;
        if (text && !guide.active) setTimeout(() => today.say(text, 4200), 900);
      })
      .catch(() => {});
    listLetters("?limit=5")
      .then((list) => {
        const since = startOfToday().getTime();
        setLetterToday(Array.isArray(list) && list.some((l: any) => (parseServerTime(l.created_at)?.getTime() ?? 0) >= since && l.type !== "scene_invite"));
      })
      .catch(() => {});
    today.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每接住一件：数字跳一下，星星亮一下
  const bump = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!catchTick || reduced) return;
    bump.setValue(0);
    Animated.sequence([
      Animated.timing(bump, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(bump, { toValue: 0, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
  }, [catchTick, reduced, bump]);

  const counts = useMemo(() => {
    const c: Record<CaughtKind, number> = { todo: 0, idea: 0, mood: 0, frag: 0 };
    items.forEach((x) => { c[x.kind] += 1; });
    return c;
  }, [items]);
  const n = items.length;
  const glow = n ? Math.min(1, 0.32 + n * 0.12) : 0.14;

  const voice = useVoiceInput((text) => today.openDump(text));

  const reminder = items.find((x) => x.kind === "todo" && isTomorrow(x.remindAt)) ?? items.find((x) => x.kind === "todo");
  const letterLate = now.getHours() * 60 + now.getMinutes() >= 21 * 60 + 30;

  const onPetPress = () => {
    today.poke();
    if (guide.stepKey === "pokeCat") {
      today.say("嘿，你好呀！", 1600);
      guide.emit("pokeCat");
      return;
    }
    const lines = ["在呢～", "嘿嘿，痒", "今天也辛苦啦", "想说什么都行", "星星抱好了"];
    today.say(lines[Math.floor(Math.random() * lines.length)], 1600);
  };

  const heroHeight = isCompact ? 286 : 300;

  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      scrollEnabled={!guide.active}
      showsVerticalScrollIndicator={false}
    >
      <View style={{
        flex: 1, width: "100%", maxWidth: 560, alignSelf: "center",
        paddingHorizontal: isCompact ? 18 : 24, paddingTop: isCompact ? 8 : 28, paddingBottom: isCompact ? 96 : 32,
      }}>
        {/* 问候 */}
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", minHeight: 58 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted }]}>{meta}</Text>
            <Text accessibilityRole="header" style={[theme.typography.textStyles.pageTitle, { color: theme.colors.textPrimary, fontSize: 27, lineHeight: 34 }]}>
              {greeting(now)}
            </Text>
          </View>
          <View style={{ flexDirection: "row" }}>
            <IconButton accessibilityLabel={`和${petName}语音聊聊`} icon={<Phone color={theme.colors.textSecondary} size={20} />} onPress={onVoiceCall} />
            <IconButton
              accessibilityLabel={night ? "切换到日间模式" : "切换到夜间模式"}
              icon={night ? <Sun color={theme.colors.textSecondary} size={20} /> : <MoonStar color={theme.colors.textSecondary} size={20} />}
              onPress={onNightToggle}
            />
          </View>
        </View>

        {/* 米露的夜空 */}
        <View style={{
          marginTop: 8, height: heroHeight, borderRadius: 30, overflow: "hidden",
          shadowColor: theme.colors.skyDeep, shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.35, shadowRadius: 24, elevation: 6,
        }}>
          <LinearGradient
            colors={[theme.colors.sky, theme.colors.skyDeep]}
            end={{ x: 0.7, y: 1 }}
            start={{ x: 0.1, y: 0 }}
            style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
          />
          <Svg height="100%" style={{ position: "absolute" }} width="100%">
            <Defs>
              <RadialGradient cx="88%" cy="105%" id="skyglow" r="70%">
                <Stop offset="0" stopColor={theme.colors.skyGlow} stopOpacity={0.55} />
                <Stop offset="1" stopColor={theme.colors.skyGlow} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx="88%" cy="105%" fill="url(#skyglow)" r="80%" />
          </Svg>
          {SKY_DOTS.map(([x, y, r], i) => (
            <View key={i} pointerEvents="none" style={{
              position: "absolute", left: `${x}%`, top: `${y}%`, width: r * 2, height: r * 2, borderRadius: r,
              backgroundColor: "#FFF6DD", opacity: 0.75,
            }} />
          ))}

          {/* 计数：全页最大的字 */}
          <Pressable
            accessibilityHint="看看每件事被放到了哪儿"
            accessibilityLabel={n ? `今天接住了 ${n} 件事` : "今天还没接住什么"}
            accessibilityRole="button"
            collapsable={false}
            onPress={today.openCaught}
            ref={countRef}
            style={({ pressed }) => ({
              position: "absolute", left: 14, top: 12, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 18,
              backgroundColor: pressed ? "rgba(255,255,255,0.08)" : "transparent", zIndex: 3,
            })}
          >
            <Text style={[theme.typography.textStyles.caption, { color: "rgba(255,255,255,0.68)" }]}>今天接住了</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <Animated.Text style={{
                fontFamily: theme.typography.fontFamilies.hand,
                fontSize: 72, lineHeight: 82, color: theme.colors.star,
                textShadowColor: "rgba(255,212,103,0.45)", textShadowRadius: 18, textShadowOffset: { width: 0, height: 0 },
                transform: [
                  { scale: bump.interpolate({ inputRange: [0, 1], outputRange: [1, 1.26] }) },
                  { translateY: bump.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
                ],
              }}>
                {n}
              </Animated.Text>
              <Text style={{ fontFamily: theme.typography.fontFamilies.hand, fontSize: 20, color: "#FFFFFF" }}>件事</Text>
            </View>
          </Pressable>

          {/* 四类拆开 */}
          <View pointerEvents="none" style={{ position: "absolute", left: 22, top: 140, gap: 6, maxWidth: "46%", zIndex: 3 }}>
            {n === 0 ? (
              <Text style={[theme.typography.textStyles.caption, { color: "rgba(255,255,255,0.62)" }]}>
                {"还没有。\n倒点什么给我？"}
              </Text>
            ) : KIND_ORDER.filter((k) => counts[k]).map((k) => (
              <View key={k} style={{
                flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
                paddingLeft: 8, paddingRight: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)",
              }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: kindColors(theme, k).fg }} />
                <Text style={[theme.typography.textStyles.caption, { color: "rgba(255,255,255,0.88)" }]}>
                  {KIND_LABEL[k]} <Text style={{ fontWeight: "600" }}>{counts[k]}</Text>
                </Text>
              </View>
            ))}
          </View>

          {/* 米露 + 它抱着的星星 */}
          <Pressable
            accessibilityHint="戳戳它"
            accessibilityLabel={petName}
            accessibilityRole="button"
            collapsable={false}
            onPress={onPetPress}
            ref={heroPetRef}
            style={{ position: "absolute", right: -22, bottom: -18, width: PET_BOX, height: PET_BOX, zIndex: 2 }}
          >
            <HomePetArtwork
              fallbackEmoji={petEmoji}
              glow
              halo={false}
              level={today.petLevel}
              look={guide.lookFor("hero-pet")}
              mood={today.petMood}
              pokeKey={today.pokeKey}
              presetId={petPresetId}
              size={PET_SIZE}
            />
            <View
              collapsable={false}
              pointerEvents="none"
              ref={starRef}
              style={{ position: "absolute", left: PET_BOX * STAR_AT.x - 2, top: PET_BOX * STAR_AT.y - 2, width: 4, height: 4 }}
            />
            <StarGlow catchTick={catchTick} level={glow} />
          </Pressable>

          {today.bubble ? (
            <View pointerEvents="none" style={{
              position: "absolute", right: 16, top: 14, zIndex: 4, maxWidth: "58%",
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, borderBottomRightRadius: 4,
              backgroundColor: "#FFFFFF",
            }}>
              <Text key={today.bubble.key} style={[theme.typography.textStyles.petVoice, { fontSize: 15, lineHeight: 21, color: "#211D32" }]}>
                {today.bubble.text}
              </Text>
            </View>
          ) : null}
        </View>

        {/* 接下来 */}
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 18, marginBottom: 8, paddingHorizontal: 2 }}>
          <Text style={[theme.typography.textStyles.sectionTitle, { color: theme.colors.textPrimary }]}>接下来</Text>
          <Text style={[theme.typography.textStyles.label, { color: theme.colors.textMuted, fontWeight: "400" }]}>它替你记着</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <NextCard
            body={reminder ? reminder.text : "要做的事，会在这里提醒你"}
            empty={!reminder}
            icon={<Bell color={reminder ? theme.colors.todo : theme.colors.textMuted} size={14} />}
            onPress={reminder ? today.openCaught : () => today.openDump()}
            tint={theme.colors.todo}
            when={reminder ? (isTomorrow(reminder.remindAt) ? "明早 8:00" : "明天 · 还记着") : "明早"}
          />
          <NextCard
            body={letterToday ? "去信箱拆开看看" : n ? `${petName}的信，写进今天的 ${n} 件事` : `${petName}会给你写一封信`}
            icon={<Mail color={theme.colors.mood} size={14} />}
            onPress={onOpenMailbox}
            soft={theme.colors.moodSoft}
            tint={theme.colors.mood}
            when={letterToday ? "今天的信到了" : letterLate ? `${petName}还在写` : `今晚 ${LETTER_TIME}`}
          />
        </View>

        {/* 唯一的主操作 */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: "auto", paddingTop: 18 }}>
          <View
            collapsable={false}
            ref={composerRef}
            style={{
              flex: 1, height: 58, borderRadius: 29, flexDirection: "row", alignItems: "center",
              paddingRight: 7,
              backgroundColor: theme.colors.surface,
              borderWidth: 1.5, borderColor: theme.colors.border,
            }}
          >
            <Pressable
              accessibilityLabel="一股脑倒出来"
              accessibilityRole="button"
              onPress={() => today.openDump()}
              style={({ pressed }) => ({ flex: 1, alignSelf: "stretch", justifyContent: "center", paddingLeft: 20, paddingRight: 10, opacity: pressed ? 0.7 : 1 })}
            >
              <Text numberOfLines={1} style={[theme.typography.textStyles.body, { fontSize: 15.5, color: theme.colors.placeholder }]}>
                {today.dumping ? `${petName}在理一理…` : "一股脑倒出来…"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={voice.isRecording ? "停止录音" : "说给它听"}
              accessibilityRole="button"
              disabled={voice.transcribing || guide.active}
              hitSlop={6}
              onPress={voice.isRecording ? voice.stop : voice.start}
              style={({ pressed }) => ({
                width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
                backgroundColor: theme.colors.accent, opacity: pressed ? 0.85 : 1,
              })}
            >
              {voice.transcribing ? (
                <ActivityIndicator color={theme.colors.textOnAccent} size="small" />
              ) : voice.isRecording ? (
                <Square color={theme.colors.textOnAccent} fill={theme.colors.textOnAccent} size={14} />
              ) : (
                <Mic color={theme.colors.textOnAccent} size={19} />
              )}
            </Pressable>
          </View>
          <Pressable
            accessibilityLabel="更多聊法"
            accessibilityRole="button"
            disabled={guide.active}
            onPress={onModeSheet}
            style={({ pressed }) => ({
              width: 50, height: 50, borderRadius: 18, alignItems: "center", justifyContent: "center",
              backgroundColor: theme.colors.accentSurface, transform: [{ scale: pressed ? 0.95 : 1 }],
            })}
          >
            <Plus color={theme.colors.accent} size={22} />
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function NextCard({ when, body, icon, tint, soft, empty, onPress }: {
  when: string; body: string; icon: React.ReactNode; tint: string; soft?: string; empty?: boolean; onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1, minHeight: 94, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12, gap: 3,
        backgroundColor: empty ? "transparent" : soft ?? theme.colors.surface,
        borderWidth: empty ? 1.5 : 0, borderStyle: empty ? "dashed" : "solid", borderColor: theme.colors.border,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...(empty ? {} : theme.shadows.soft),
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {icon}
        <Text style={[theme.typography.textStyles.label, { color: empty ? theme.colors.textMuted : tint, fontWeight: "600" }]}>{when}</Text>
        <View style={{ flex: 1 }} />
        {!empty ? <ChevronRight color={theme.colors.textMuted} size={14} /> : null}
      </View>
      <Text numberOfLines={2} style={[theme.typography.textStyles.body, { fontSize: 14, lineHeight: 20, color: empty ? theme.colors.textMuted : theme.colors.textPrimary }]}>
        {body}
      </Text>
    </Pressable>
  );
}

/** 星光：亮度随今天接住的数量走，每接住一件闪一下。 */
function StarGlow({ level, catchTick }: { level: number; catchTick: number }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!catchTick || reduced) return;
    pulse.setValue(1);
    Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [catchTick, reduced, pulse]);
  const size = 128;
  return (
    <Animated.View pointerEvents="none" style={{
      position: "absolute", left: PET_BOX * STAR_AT.x - size / 2, top: PET_BOX * STAR_AT.y - size / 2, width: size, height: size,
      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [level, 1] }),
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
    }}>
      <Svg height={size} width={size}>
        <Defs>
          <RadialGradient cx="50%" cy="50%" id="starglow" r="50%">
            <Stop offset="0" stopColor="#FFDC82" stopOpacity={0.5} />
            <Stop offset="0.55" stopColor="#FFBE5A" stopOpacity={0.16} />
            <Stop offset="1" stopColor="#FFBE5A" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} fill="url(#starglow)" r={size / 2} />
      </Svg>
    </Animated.View>
  );
}

