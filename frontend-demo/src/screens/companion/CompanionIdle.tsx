/**
 * 陪伴首页：主桌宠立绘 + 语音/文字入口 + 邀请气泡 + 往日入口。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, ActivityIndicator, Text, View } from "react-native";
import { BookOpen, ChevronRight, Mic, MoonStar, Plus, Square, Sun } from "lucide-react-native";

import {
  GlassSurface,
  IconButton,
  PageContainer,
  useReducedMotion,
  useResponsive,
  useTheme,
} from "../../design-system";
import { getCompanionHome, listConversations } from "../../api";
import { HomePetArtwork } from "../../components/HomePetArtwork";
import { useVoiceInput } from "../../useVoiceInput";
import { ambientCalendar } from "../../utils/lunar";
import { ConversationSummary, shortTitle } from "./shared";

type CompanionIdleProps = {
  night: boolean;
  onChat: () => void;
  onModeSheet: () => void;
  onNightToggle: () => void;
  onOpenJournal: () => void;
  onResumeChat: (conversationId: number) => void;
  onVoiceCall: () => void;
  onVoiceChat: (text: string) => void;
  petEmoji: string;
  petName: string;
  petPresetId: string | null;
};

/** 陪伴首页（桌宠主屏）。 */
export function CompanionIdle({
  night,
  onChat,
  onModeSheet,
  onNightToggle,
  onOpenJournal,
  onResumeChat,
  onVoiceCall,
  onVoiceChat,
  petEmoji,
  petName,
  petPresetId,
}: CompanionIdleProps) {
  const theme = useTheme();
  const { isCompact, isExpanded } = useResponsive();
  const reducedMotion = useReducedMotion();
  const [bubbleVisible, setBubbleVisible] = useState(true);
  const [statusText, setStatusText] = useState("在等你");
  const [bubbleText, setBubbleText] = useState("今天怎么样？");
  const [homePetName, setHomePetName] = useState<string | null>(null);
  const [recentConv, setRecentConv] = useState<ConversationSummary | null>(null);
  const [convCount, setConvCount] = useState(0);
  const fade = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  // 呼吸：4.6s 一周期，scale 1→1.015，与原型 breathe 关键帧一致。
  const breathe = useRef(new Animated.Value(0)).current;
  const voice = useVoiceInput(onVoiceChat);

  // 环境行：农历日期 · 节气 · 时段，像书页天头的页眉；后端的状态语接在后面。
  const cal = useMemo(() => ambientCalendar(), []);
  const ambientLine = `${cal.lunar} · ${cal.term} · ${cal.daypart}`;

  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: theme.motion.durations.ambient,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: theme.motion.durations.ambient,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, reducedMotion, theme.motion.durations.ambient]);

  useEffect(() => {
    getCompanionHome()
      .then((home) => {
        if (home?.status_text) setStatusText(home.status_text);
        if (home?.pet?.name) setHomePetName(home.pet.name);
        if (home?.invitation?.text) setBubbleText(home.invitation.text);
        else if (home?.behavior) {
          setBubbleText(`它正在${home.behavior}，去陪陪它？`);
        }
      })
      .catch(() => {});
    // 历史会话：决定「往日」胶囊与续聊气泡（列表按时间倒序，首条即最近一段）。
    listConversations()
      .then((list) => {
        if (!Array.isArray(list) || list.length === 0) return;
        setConvCount(list.length);
        setRecentConv(list[0]);
        // 若邀请气泡已自动收起，续聊气泡要重新亮出来（它是功能入口）。
        setBubbleVisible(true);
        fade.setValue(1);
      })
      .catch(() => {});
  }, [fade]);

  useEffect(() => {
    if (reducedMotion) {
      fade.setValue(1);
    } else {
      Animated.timing(fade, {
        duration: theme.motion.durations.enter,
        toValue: 1,
        useNativeDriver: Platform.OS !== "web",
      }).start();
    }

    // 有可续聊的会话时气泡常驻（承载「接着聊」入口）；否则保持几秒后自动收起的装饰行为。
    if (recentConv) return;
    const timer = setTimeout(() => {
      if (reducedMotion) {
        setBubbleVisible(false);
        return;
      }
      Animated.timing(fade, {
        duration: theme.motion.durations.exit,
        toValue: 0,
        useNativeDriver: Platform.OS !== "web",
      }).start(() => setBubbleVisible(false));
    }, 4200);

    return () => clearTimeout(timer);
  }, [fade, recentConv, reducedMotion, theme.motion.durations.enter, theme.motion.durations.exit]);

  const petSize = isCompact ? 198 : 224;
  return (
    <PageContainer
      maxWidth={1040}
      style={{
        flex: 1,
        paddingBottom: isExpanded ? theme.spacing[8] : 100,
        paddingTop: isCompact ? theme.spacing[4] : theme.spacing[8],
      }}
    >
      <View
        style={{
          alignItems: "flex-start",
          flexDirection: "column",
          justifyContent: "flex-start",
          gap: theme.spacing[2],
        }}
      >
        <View style={{ width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            {/* 环境行：页眉式小字（农历 · 节气 · 时段 · 它的状态） */}
            <Text
              style={[
                theme.typography.textStyles.ambient,
                { color: theme.colors.textMuted, marginBottom: theme.spacing[2] },
              ]}
            >
              {`${ambientLine} · ${statusText}`}
            </Text>
            <Text
              style={[
                theme.typography.textStyles.sectionTitle,
                { color: theme.colors.textPrimary },
              ]}
            >
              {homePetName ?? petName}
            </Text>
          </View>
          <IconButton
            accessibilityLabel={night ? "切换到日间模式" : "切换到夜间模式"}
            icon={
              night ? (
                <Sun size={20} color={theme.colors.textSecondary} />
              ) : (
                <MoonStar size={20} color={theme.colors.textSecondary} />
              )
            }
            onPress={onNightToggle}
          />
        </View>
        {/* 往日：书页式的竖线引导行（原型 ambient-storybook），替代胶囊 */}
        {convCount > 0 ? (
          <Pressable
            accessibilityLabel={`查看往日，共 ${convCount} 段聊天`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onOpenJournal}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing[2],
              borderLeftWidth: 2,
              borderLeftColor: theme.colors.accent,
              paddingLeft: theme.spacing[3],
              paddingVertical: theme.spacing[1],
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <BookOpen size={13} color={theme.colors.accent} />
            <Text
              style={[
                theme.typography.textStyles.body,
                { color: theme.colors.textPrimary, letterSpacing: 0.4 },
              ]}
            >
              往日{" "}
              <Text style={{ color: theme.colors.textMuted }}>· {convCount} 段对话</Text>
            </Text>
            <ChevronRight size={13} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <Pressable
        accessibilityHint="进入实时语音陪伴"
        accessibilityLabel={`和${homePetName ?? petName}说话`}
        accessibilityRole="button"
        onPress={onVoiceCall}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 320,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        })}
      >
        {bubbleVisible ? (
          <Animated.View
            style={{
              position: "absolute",
              top: isCompact ? "8%" : "12%",
              alignSelf: "flex-start",
              maxWidth: 340,
              marginLeft: isCompact ? theme.spacing[2] : theme.spacing[6],
              paddingHorizontal: theme.spacing[5],
              paddingVertical: theme.spacing[3],
              borderRadius: theme.radii.card,
              borderBottomLeftRadius: theme.radii.control / 2,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceElevated,
              zIndex: 3,
              elevation: 3,
              opacity: fade,
              transform: [
                {
                  translateY: fade.interpolate({
                    inputRange: [0, 1],
                    outputRange: [theme.motion.distances.standard, 0],
                  }),
                },
              ],
              ...theme.shadows.soft,
            }}
          >
            {recentConv ? (
              <Pressable
                accessibilityLabel={`接着上次的聊天：${shortTitle(recentConv)}`}
                accessibilityRole="button"
                onPress={() => onResumeChat(recentConv.id)}
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
              >
                <Text
                  style={[
                    theme.typography.textStyles.readingBody,
                    { color: theme.colors.textPrimary },
                  ]}
                >
                  {`上次你说「${shortTitle(recentConv)}」`}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 2,
                    marginTop: theme.spacing[1],
                  }}
                >
                  <Text
                    style={[
                      theme.typography.textStyles.caption,
                      { color: theme.colors.accent, fontWeight: "600" },
                    ]}
                  >
                    接着聊
                  </Text>
                  <ChevronRight size={12} color={theme.colors.accent} />
                </View>
              </Pressable>
            ) : (
              <Text
                style={[
                  theme.typography.textStyles.readingBody,
                  { color: theme.colors.textPrimary },
                ]}
              >
                {bubbleText}
              </Text>
            )}
          </Animated.View>
        ) : null}
        <Animated.View
          style={{
            zIndex: 1,
            marginTop: bubbleVisible ? (isCompact ? 92 : 78) : 0,
            alignItems: "center",
            transform: [
              {
                scale: breathe.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.015],
                }),
              },
            ],
          }}
        >
          <HomePetArtwork
            fallbackEmoji={petEmoji}
            presetId={petPresetId}
            size={petSize}
          />
          {/* 地面投影已并入骨骼动画（接触阴影 + 贴纸投影），这里不再单独画 */}
        </Animated.View>
        <Text
          style={[
            theme.typography.textStyles.ambient,
            { marginTop: theme.spacing[5], color: theme.colors.textMuted },
          ]}
        >
          轻触和它说话
        </Text>
      </Pressable>

      <View
        style={{
          width: "100%",
          maxWidth: 760,
          alignSelf: "center",
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[3],
        }}
      >
        <GlassSurface style={{ flex: 1, borderRadius: theme.radii.pill }}>
          <View
            style={{
              minHeight: 54,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: theme.spacing[5],
              paddingRight: theme.spacing[1],
              borderRadius: theme.radii.pill,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Pressable
              accessibilityLabel="打开文字聊天"
              accessibilityRole="button"
              onPress={onChat}
              style={{ flex: 1, justifyContent: "center", alignSelf: "stretch" }}
            >
              <Text
                style={[
                  theme.typography.textStyles.body,
                  { color: theme.colors.placeholder },
                ]}
              >
                {`和${homePetName ?? petName}说说…`}
              </Text>
            </Pressable>
            <IconButton
              accessibilityLabel={voice.isRecording ? "停止录音" : "语音输入"}
              disabled={voice.transcribing}
              selected={voice.isRecording}
              icon={
                voice.transcribing ? (
                  <ActivityIndicator color={theme.colors.accent} size="small" />
                ) : voice.isRecording ? (
                  <Square
                    color={theme.colors.accent}
                    fill={theme.colors.accent}
                    size={15}
                  />
                ) : (
                  <Mic color={theme.colors.accent} size={19} />
                )
              }
              onPress={voice.isRecording ? voice.stop : voice.start}
            />
          </View>
        </GlassSurface>
        <IconButton
          accessibilityLabel="选择陪伴模式"
          icon={<Plus color={theme.colors.accent} size={22} />}
          onPress={onModeSheet}
          selected
        />
      </View>
    </PageContainer>
  );
}
