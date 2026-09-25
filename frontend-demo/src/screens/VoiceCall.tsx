/**
 * 实时语音通话页（桌宠文字或语音回复）· 字幕通话版。
 *
 * 视觉方案：拆掉「上半光圈舞台 + 下半对话卡」的双主角结构，转写与回复以
 * 字幕形态直接落在页面底色上——最新一句最大最清晰，历史句逐级淡去；
 * 麦克风音量律动收成底部一条细波纹，不再用大圆圈占屏。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PhoneOff, Volume2, VolumeX } from "lucide-react-native";

import {
  Button,
  PageContainer,
  useReducedMotion,
  useResponsive,
  useTheme,
} from "../design-system";
import { createScene } from "../api";
import { HomePetArtwork } from "../components/HomePetArtwork";
import { useRealtimeCall, type CallStatus } from "../useRealtimeCall";

/** 字幕流里的一行：role 决定说话人标签，draft 表示还没定稿。 */
type SubtitleLine = {
  key: string;
  role: "user" | "pet";
  text: string;
  draft: boolean;
};

/** 波纹条数：奇数条让中间最高，视觉上有中心。 */
const WAVE_BAR_COUNT = 15;
/** 每条的基准高度比例（0~1），静默时统一压到最低。 */
const WAVE_SHAPE = [
  0.3, 0.52, 0.74, 0.44, 0.66, 1, 0.58, 0.36, 0.62, 0.82, 0.48, 0.7, 0.4, 0.56,
  0.32,
];

function statusLabel(status: CallStatus, error: string | null): string {
  if (error) return error;
  switch (status) {
    case "connecting":
      return "正在接通…";
    case "listening":
      return "在听你说";
    case "thinking":
      return "在想怎么回你…";
    case "speaking":
      return "正在回应你…";
    case "ended":
      return "通话结束";
    case "error":
      return "出了点问题";
    default:
      return "准备中…";
  }
}

/** 通话计时：只在接通后走，挂断即停。 */
function useCallDuration(active: boolean): string {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** 音量波纹：一条细横线，说话时按 level 起伏，静默时几乎是条直线。 */
function VoiceWave({ level, muted }: { level: number; muted: boolean }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const amplitude = muted ? 0 : Math.min(Math.max(level, 0), 1);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        height: 20,
      }}
    >
      {WAVE_SHAPE.slice(0, WAVE_BAR_COUNT).map((shape, index) => {
        // 静默基线 3px；有声时按 shape × level 张开，最高 18px。
        const height = reducedMotion
          ? 3 + shape * amplitude * 8
          : 3 + shape * amplitude * 15;
        return (
          <View
            key={index}
            style={{
              width: 2.5,
              height,
              borderRadius: 2,
              backgroundColor:
                amplitude > 0.04
                  ? theme.colors.accentSurface
                  : theme.colors.border,
            }}
          />
        );
      })}
    </View>
  );
}

type VoiceCallProps = {
  onEnd: () => void;
  onEnterScene: (sceneId: number, theaterId?: string) => void;
  onToast?: (message: string) => void;
  petEmoji: string;
  petName: string;
  petPresetId: string | null;
};

export function VoiceCall({
  onEnd,
  onEnterScene,
  onToast,
  petEmoji,
  petName,
  petPresetId,
}: VoiceCallProps) {
  const theme = useTheme();
  const { isCompact, isExpanded } = useResponsive();
  const reducedMotion = useReducedMotion();
  const [voiceReply, setVoiceReply] = useState(false);
  const [building, setBuilding] = useState(false);
  const call = useRealtimeCall(voiceReply);
  const scrollRef = useRef<ScrollView>(null);
  const breathe = useRef(new Animated.Value(0)).current;

  const connecting = call.status === "connecting" || call.status === "idle";
  const duration = useCallDuration(
    call.status === "listening" || call.status === "thinking" || call.status === "speaking",
  );

  useEffect(() => {
    call.start();
    return () => call.stop();
    // 通话对象内部方法会随状态更新；这里只在进屏时接通一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 接通中的呼吸：只在未接通时跑，接通后停掉，避免整通话都有动画。
  useEffect(() => {
    if (!connecting || reducedMotion) {
      breathe.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: theme.motion.durations.ambient / 2,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: theme.motion.durations.ambient / 2,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, connecting, reducedMotion, theme.motion.durations.ambient]);

  useEffect(() => {
    AsyncStorage.getItem("morning.voiceReply").then((value) => {
      if (value === "1") setVoiceReply(true);
    });
  }, []);

  const toggleVoice = () => {
    setVoiceReply((previous) => {
      const next = !previous;
      AsyncStorage.setItem("morning.voiceReply", next ? "1" : "0").catch(
        () => {},
      );
      return next;
    });
  };

  const hangup = () => {
    call.stop();
    onEnd();
  };

  const enterScene = async () => {
    const suggestion = call.sceneSuggestion;
    if (!suggestion || building) return;

    setBuilding(true);
    try {
      const seed = suggestion.seed ?? {};
      const scene = await createScene({
        title: seed.title ?? undefined,
        people: seed.people ?? undefined,
        place: seed.place ?? undefined,
        plot: seed.plot ?? undefined,
        intent: seed.intent ?? undefined,
        theater_id: suggestion.theater_id,
      });
      call.dismissSuggestion();
      call.stop();
      onEnterScene(
        scene.id,
        scene.theater_id ?? suggestion.theater_id ?? undefined,
      );
    } catch {
      setBuilding(false);
      onToast?.("场景没搭起来，待会儿再试试");
    }
  };

  /**
   * 字幕流：已定稿轮次 + 正在说的草稿句拼成一条流。
   * 最后一条是「当前句」，字号最大；越往前越淡。
   */
  const lines = useMemo<SubtitleLine[]>(() => {
    const settled: SubtitleLine[] = call.turns
      .filter((turn) => turn.text || turn.role === "pet")
      .map((turn) => ({
        key: `turn-${turn.id}`,
        role: turn.role,
        text: turn.text,
        draft: turn.role === "pet" && !turn.text,
      }));
    if (call.liveUser) {
      settled.push({
        key: "live",
        role: "user",
        text: call.liveUser,
        draft: true,
      });
    }
    return settled;
  }, [call.liveUser, call.turns]);

  const header = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: theme.spacing[3],
        paddingBottom: theme.spacing[2],
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[2],
        }}
      >
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor:
              call.status === "error"
                ? theme.colors.error
                : call.status === "ended"
                  ? theme.colors.textMuted
                  : connecting
                    ? theme.colors.accent
                    : theme.colors.success,
          }}
        />
        <Text
          style={[
            theme.typography.textStyles.ambient,
            { color: theme.colors.textSecondary },
          ]}
        >
          {petName}
        </Text>
        {call.status === "listening" || call.status === "thinking" || call.status === "speaking" ? (
          <Text
            style={[
              theme.typography.textStyles.caption,
              { color: theme.colors.textMuted },
            ]}
          >
            · {duration}
          </Text>
        ) : null}
      </View>
      <Text
        style={[
          theme.typography.textStyles.caption,
          { color: theme.colors.textMuted, flexShrink: 1 },
        ]}
      >
        {statusLabel(call.status, call.error)}
      </Text>
    </View>
  );

  /** 未接通：整块只有一个呼吸的桌宠立绘 + 一句提示。 */
  const connectingStage = (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing[6],
      }}
    >
      <Animated.View
        style={{
          opacity: breathe.interpolate({
            inputRange: [0, 1],
            outputRange: [0.6, 1],
          }),
          transform: [
            {
              scale: breathe.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.06],
              }),
            },
          ],
        }}
      >
        <HomePetArtwork
          fallbackEmoji={petEmoji}
          presetId={petPresetId}
          size={72}
        />
      </Animated.View>
      <View style={{ alignItems: "center", gap: theme.spacing[2] }}>
        <Text
          style={[
            theme.typography.textStyles.body,
            { color: theme.colors.textSecondary },
          ]}
        >
          正在接通{petName}…
        </Text>
        <Text
          style={[
            theme.typography.textStyles.caption,
            { color: theme.colors.textMuted, textAlign: "center" },
          ]}
        >
          你可以自然地说，我会在停顿时回应
        </Text>
      </View>
    </View>
  );

  /** 字幕舞台：内容自下而上堆叠，最新一句贴近底部操作区。 */
  const subtitles = (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "flex-end",
        gap: theme.spacing[5],
        paddingVertical: theme.spacing[6],
      }}
      onContentSizeChange={() =>
        scrollRef.current?.scrollToEnd({ animated: !reducedMotion })
      }
      ref={scrollRef}
      style={{ flex: 1 }}
    >
      {lines.length ? (
        lines.map((line, index) => {
          const isCurrent = index === lines.length - 1;
          const isUser = line.role === "user";
          // 剧本格式：说话人标签是页眉小字；它的台词用衬线（像读出来的词），
          // 你的台词保持无衬线（像写下来的话）。历史句整体淡去。
          return (
            <View key={line.key} style={{ opacity: isCurrent ? 1 : 0.5 }}>
              <Text
                style={[
                  theme.typography.textStyles.ambient,
                  {
                    marginBottom: theme.spacing[2],
                    color: isUser ? theme.colors.textMuted : theme.colors.accent,
                  },
                ]}
              >
                {isUser ? "你" : petName}
              </Text>
              <Text
                style={{
                  fontSize: isUser
                    ? isCurrent
                      ? theme.typography.fontSizes.bodyLarge
                      : theme.typography.fontSizes.body
                    : isCurrent
                      ? 17
                      : theme.typography.fontSizes.body,
                  lineHeight: isCurrent
                    ? isUser
                      ? theme.typography.lineHeights.bodyLarge
                      : theme.typography.lineHeights.readingBody
                    : theme.typography.lineHeights.body,
                  fontWeight: isUser && isCurrent
                    ? theme.typography.fontWeights.medium
                    : theme.typography.fontWeights.regular,
                  fontFamily: theme.typography.fontFamilies.sans,
                  fontStyle: line.draft ? "italic" : "normal",
                  color: line.draft
                    ? theme.colors.textSecondary
                    : theme.colors.textPrimary,
                }}
              >
                {line.text || "…"}
              </Text>
            </View>
          );
        })
      ) : (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Text
            style={[
              theme.typography.textStyles.body,
              { color: theme.colors.textMuted, textAlign: "center" },
            ]}
          >
            说点什么吧，字幕会留在这里。
          </Text>
        </View>
      )}
    </ScrollView>
  );

  /** 场景建议：接在字幕流下方，不再挤进对话卡顶部。 */
  const sceneBanner = call.sceneSuggestion ? (
    <View
      style={{
        gap: theme.spacing[3],
        marginBottom: theme.spacing[4],
        padding: theme.spacing[4],
        borderRadius: theme.radii.card,
        backgroundColor: theme.colors.accentSoft,
      }}
    >
      <Text
        style={[
          theme.typography.textStyles.bodyStrong,
          { color: theme.colors.textPrimary },
        ]}
      >
        要现在就走进《{call.sceneSuggestion.seed?.title || "这一幕"}》吗？
      </Text>
      <View style={{ flexDirection: "row", gap: theme.spacing[3] }}>
        <View style={{ flex: 1 }}>
          <Button disabled={building} fullWidth onPress={enterScene}>
            {building ? "在搭场景…" : "进入"}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            disabled={building}
            fullWidth
            onPress={call.dismissSuggestion}
            variant="secondary"
          >
            以后再说
          </Button>
        </View>
      </View>
    </View>
  ) : null;

  /** 底部工具条：波纹 + 出声开关 + 挂断，三件事一行收口。 */
  const controls = (
    <View style={{ gap: theme.spacing[4] }}>
      <VoiceWave level={call.level} muted={connecting || call.status === "speaking" || !call.available} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing[3],
        }}
      >
        <Pressable
          accessibilityLabel={`桌宠语音回复${voiceReply ? "已开启" : "已关闭"}`}
          accessibilityRole="switch"
          accessibilityState={{ checked: voiceReply }}
          onPress={toggleVoice}
          style={({ pressed }) => ({
            minHeight: theme.spacing[10],
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing[2],
            paddingHorizontal: theme.spacing[3],
            borderRadius: theme.radii.pill,
            borderWidth: 1,
            borderColor: voiceReply
              ? theme.colors.accentHover
              : theme.colors.border,
            backgroundColor: voiceReply
              ? theme.colors.accentSoft
              : theme.colors.surface,
            opacity: pressed ? 0.8 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          {voiceReply ? (
            <Volume2 color={theme.colors.accent} size={16} />
          ) : (
            <VolumeX color={theme.colors.textMuted} size={16} />
          )}
          <Text
            style={[
              theme.typography.textStyles.caption,
              { color: theme.colors.textSecondary },
            ]}
          >
            {voiceReply ? "会出声" : "只看字幕"}
          </Text>
        </Pressable>

        <View style={{ alignItems: "center" }}>
          <Pressable
            accessibilityLabel="挂断通话"
            accessibilityRole="button"
            onPress={hangup}
            style={({ pressed }) => ({
              width: 54,
              height: 54,
              borderRadius: 27,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.error,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.94 : 1 }],
              ...theme.shadows.soft,
            })}
          >
            <PhoneOff color={theme.colors.textOnDanger} size={23} />
          </Pressable>
        </View>

        {/* 右侧留一块与左侧开关等宽的空白，让挂断视觉居中 */}
        <View style={{ width: 96 }} />
      </View>
      {/* 顶栏已经在播报同一条错误/状态，这里不再重复一遍 */}
    </View>
  );

  return (
    <PageContainer
      maxWidth={isExpanded ? 720 : 1040}
      style={{
        flex: 1,
        paddingBottom: isCompact ? theme.spacing[5] : theme.spacing[8],
        paddingTop: isCompact ? theme.spacing[3] : theme.spacing[6],
      }}
    >
      <View style={{ flex: 1, minHeight: 0 }}>
        {header}
        {connecting ? connectingStage : subtitles}
        {sceneBanner}
        {controls}
      </View>
    </PageContainer>
  );
}
