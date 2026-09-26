/**
 * 「走出片场」：镜头停住 → 退到观众席 → 对过去的自己说一句 → 带回今天 → 视角卡。
 * AI 只提供可否定的视角候选；只有用户明确选择「试一个小动作」才会创建待办。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "lucide-react-native";

import {
  Button,
  PageContainer,
  TextArea,
  paperColors,
  useReducedMotion,
  useResponsive,
  useTheme,
} from "../../design-system";
import { absUrl, getActivePet, getScene, getSceneSummary, settleScene } from "../../api";
import type { TheaterSceneId } from "../../theater";
import { Scene3D } from "../Scene3D";
import type { SceneDetail } from "./shared";
import { getLastSceneBeat, getLastUserExpression, isSceneEndDirectPreview } from "./sceneReview";
import {
  buildPerspectiveCard,
  buildSettlementPayload,
  getReviewFacts,
  normalizeReflections,
  type BringChoice,
  type PerspectiveCardData,
  type SceneReviewSummary,
} from "./sceneExit";

type ExitStep = 1 | 2 | 3 | 4 | 5;

const STAGE = {
  curtain: "#8C3A34",
  curtainFold: "#7A2F2A",
  ink: "#211713",
} as const;

const fill = { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 };

// 仅供仓库约定的 ?screen=scene-end 本地验收；真实导航始终传 sceneId 并读取接口数据。
const DIRECT_PREVIEW = isSceneEndDirectPreview(
  Platform.OS,
  typeof window !== "undefined" ? window.location?.search : undefined,
);
const PREVIEW_SCENE: SceneDetail = {
  id: -1,
  title: "老屋檐下的风",
  status: "active",
  setting: "傍晚的老屋院子",
  beats: [{ speaker: "旁白", text: "风停在屋檐下，这一幕安静下来。" }],
  choices: [],
  history: [
    { turn: 1, choice: "我先听你说", source: "choice" },
    { turn: 2, choice: "你先别走，我还有一句话想说。", source: "custom" },
  ],
  turn: 2,
  render_kind: "preset_3d",
  theater_id: "dining",
};
const PREVIEW_SUMMARY: SceneReviewSummary = {
  key_quote: "你先别走，我还有一句话想说。",
  reflection_options: [
    "我不是不在乎，只是当时不知道怎么表达",
    "其实我也希望有人能留下来",
    "那时的我，已经尽力了",
  ],
  companion_comment: "这一幕不需要马上得出答案，我陪你先把它放在这里。",
  action_hint: "下次可以先说清自己的感受",
  response_count: 2,
  custom_response_count: 1,
  setting_label: "傍晚的老屋院子",
};

function StepIndicator({ step, dark = false }: { step: ExitStep; dark?: boolean }) {
  const theme = useTheme();
  return (
    <View accessibilityLabel={`场景回看，第 ${step} 步，共 5 步`}
      style={{ flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: 14 }}>
      {[1, 2, 3, 4, 5].map((item) => (
        <View key={item} style={{
          width: 22,
          height: 3,
          borderRadius: 2,
          backgroundColor: item === step
            ? (dark ? "#D8A94E" : theme.colors.accent)
            : item < step
              ? (dark ? "rgba(216,169,78,0.58)" : theme.colors.accentHover)
              : (dark ? "rgba(238,227,206,0.28)" : theme.colors.border),
        }} />
      ))}
    </View>
  );
}

function StagePicture({ scene }: { scene: SceneDetail | null }) {
  const renderKind = scene?.render_kind;
  const background = absUrl(scene?.bg_image ?? null);
  const sprite = absUrl(scene?.characters?.[0]?.sprite_url ?? null);
  const theaterId = (scene?.theater_id as TheaterSceneId | undefined) ?? "dining";

  return (
    <View style={[fill, { pointerEvents: "none" }]}>
      {renderKind === "dynamic_image" && background ? (
        <Image source={{ uri: background }} resizeMode="cover" style={fill} />
      ) : renderKind === "generated_3d" && scene?.scene_spec ? (
        <Scene3D spec={scene.scene_spec} />
      ) : (
        <Scene3D sceneId={theaterId} />
      )}
      {renderKind === "dynamic_image" && sprite ? (
        <Image source={{ uri: sprite }} resizeMode="contain" style={{
          position: "absolute", width: "62%", height: "62%", left: "19%", bottom: "8%",
        }} />
      ) : null}
      <LinearGradient colors={["rgba(20,14,10,0.12)", "rgba(20,14,10,0.26)", "rgba(20,14,10,0.58)"]} style={fill} />
    </View>
  );
}

function OptionButton({ label, selected, marker, onPress }: {
  label: string;
  selected: boolean;
  marker: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 54,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: theme.radii.control,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accentSoft : theme.colors.surface,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.78 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <View style={{
        width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
        backgroundColor: selected ? theme.colors.accent : theme.colors.backgroundSubtle,
      }}>
        <Text style={{ fontSize: 12, color: selected ? theme.colors.textOnAccent : theme.colors.textSecondary }}>{marker}</Text>
      </View>
      <Text style={[theme.typography.textStyles.body, { flex: 1, color: theme.colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function BringCard({ title, description, selected, compact, onPress }: {
  title: string;
  description: string;
  selected: boolean;
  compact: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress}
      style={({ pressed }) => ({
        width: compact ? "48%" : "48.5%",
        minHeight: compact ? 126 : 112,
        padding: 15,
        borderRadius: theme.radii.card,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accentSoft : theme.colors.surface,
        opacity: pressed ? 0.78 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={[theme.typography.textStyles.bodyStrong, { flex: 1, color: theme.colors.textPrimary }]}>{title}</Text>
        <Text style={{ minWidth: 12, color: theme.colors.accent }}>{selected ? "✓" : ""}</Text>
      </View>
      <Text style={[theme.typography.textStyles.label, { marginTop: 7, color: theme.colors.textMuted }]}>{description}</Text>
    </Pressable>
  );
}

function ReviewHeader({ step, eyebrow, title, description }: {
  step: ExitStep;
  eyebrow: string;
  title: string;
  description: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "center", marginBottom: theme.spacing[5] }}>
      <StepIndicator step={step} />
      <Text style={[theme.typography.textStyles.label, { marginTop: 4, color: theme.colors.textMuted }]}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={{
        marginTop: 8, textAlign: "center", fontSize: 23, lineHeight: 31, fontWeight: "500",
        color: theme.colors.textPrimary,
      }}>{title}</Text>
      <Text style={[theme.typography.textStyles.body, {
        maxWidth: 560, marginTop: 6, textAlign: "center", color: theme.colors.textSecondary,
      }]}>{description}</Text>
    </View>
  );
}

function PerspectiveCard({ card, companionComment, petName }: {
  card: PerspectiveCardData;
  companionComment: string;
  petName: string;
}) {
  const theme = useTheme();
  const rows = [
    ["这一次，我对当时的自己说", card.said],
    ["退到画面之外，我看见", card.saw],
    ["回到今天，我愿意", card.will],
  ];
  return (
    <View style={[{
      width: "100%", maxWidth: 620, alignSelf: "center", padding: 22,
      borderRadius: theme.radii.dialog, backgroundColor: "#FFFCF6",
    }, theme.shadows.floating]}>
      {rows.map(([key, value], index) => (
        <View key={key} style={{
          paddingVertical: 11,
          borderBottomWidth: index < rows.length - 1 ? 1 : 0,
          borderBottomColor: "rgba(64,58,53,0.07)",
        }}>
          <Text style={{ fontSize: 11, letterSpacing: 0.5, color: paperColors.meta }}>{key}</Text>
          <Text style={{ marginTop: 5, fontSize: 16, lineHeight: 26, fontWeight: "500", color: paperColors.ink2 }}>
            “{value}”
          </Text>
        </View>
      ))}
      <View style={{
        marginTop: 16, padding: 13, borderRadius: theme.radii.control,
        backgroundColor: "#EFE7D5", flexDirection: "row", gap: 10,
      }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(184,134,11,0.14)" }}>
          <Feather size={16} color="#A97E22" strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, color: paperColors.meta }}>{petName}</Text>
          <Text style={{ marginTop: 3, fontSize: 14, lineHeight: 21, color: paperColors.body }}>{companionComment}</Text>
        </View>
      </View>
    </View>
  );
}

/** 场景结算屏。 */
export function SceneEnd({ sceneId, onBack, onReplay }: {
  sceneId?: number | null;
  /** kept：用户这次留下了结算卡（回到首页时米露会开心一下）。 */
  onBack: (kept?: boolean) => void;
  onReplay: () => void;
}) {
  const theme = useTheme();
  const { width, height, isCompact } = useResponsive();
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState<ExitStep>(1);
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [summary, setSummary] = useState<SceneReviewSummary | null>(null);
  const [petName, setPetName] = useState("米露");
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [selectedPerspective, setSelectedPerspective] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customPerspective, setCustomPerspective] = useState("");
  const [messageToPast, setMessageToPast] = useState("");
  const [bringChoice, setBringChoice] = useState<BringChoice | null>(null);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState("");

  const stageScale = useRef(new Animated.Value(1)).current;
  const stageOpacity = useRef(new Animated.Value(1)).current;
  const copyOpacity = useRef(new Animated.Value(1)).current;
  const curtainProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    if (!sceneId) {
      if (DIRECT_PREVIEW) {
        setScene(PREVIEW_SCENE);
        setSummary(PREVIEW_SUMMARY);
        setLoading(false);
        setSummaryLoading(false);
        setError("");
        return () => { alive = false; };
      }
      setLoading(false);
      setSummaryLoading(false);
      setError("没有找到这一幕，你可以返回片场重新进入。");
      return () => { alive = false; };
    }

    setLoading(true);
    setSummaryLoading(true);
    setError("");
    void getScene(sceneId)
      .then((value) => { if (alive) setScene(value as SceneDetail); })
      .catch((err) => { if (alive) setError((err as any)?.message ?? "加载这一幕失败"); })
      .finally(() => { if (alive) setLoading(false); });
    void getSceneSummary(sceneId)
      .then((value) => { if (alive) setSummary(value as SceneReviewSummary); })
      .catch(() => {
        if (alive) setSummary({
          companion_comment: "这一幕不需要马上得出答案，我们可以先把它放在这里。",
          action_hint: "下次可以先说清自己的感受",
        });
      })
      .finally(() => { if (alive) setSummaryLoading(false); });
    void getActivePet()
      .then((pet: any) => { if (alive && pet?.name) setPetName(String(pet.name)); })
      .catch(() => {});

    return () => { alive = false; };
  }, [sceneId]);

  const lastExpression = getLastUserExpression(scene)
    || getLastSceneBeat(scene)
    || String(summary?.key_quote ?? "").trim();
  const facts = useMemo(() => getReviewFacts(scene, summary), [scene, summary]);
  const reflectionOptions = useMemo(() => normalizeReflections(summary), [summary]);
  const confirmedPerspective = customMode ? customPerspective.trim() : selectedPerspective.trim();
  const actionHint = String(summary?.action_hint || "下次可以先说清自己的感受").trim();
  const companionComment = String(summary?.companion_comment
    || "这一幕不需要马上得出答案，我们可以先把它放在这里。").trim();
  const card = bringChoice && messageToPast.trim() && confirmedPerspective
    ? buildPerspectiveCard(messageToPast, confirmedPerspective, bringChoice, actionHint)
    : null;

  const resetStage = () => {
    stageScale.setValue(1);
    stageOpacity.setValue(1);
    copyOpacity.setValue(1);
    curtainProgress.setValue(0);
  };

  const restartReview = () => {
    resetStage();
    setStep(1);
    setSelectedPerspective("");
    setCustomMode(false);
    setCustomPerspective("");
    setMessageToPast("");
    setBringChoice(null);
    setError("");
  };

  const sitInAudience = () => {
    if (loading || exiting) return;
    setExiting(true);
    const duration = reducedMotion ? 220 : 1200;
    const useNativeDriver = Platform.OS !== "web";
    Animated.parallel([
      Animated.timing(copyOpacity, { toValue: 0, duration: Math.min(duration, 260), useNativeDriver }),
      Animated.timing(stageScale, {
        toValue: reducedMotion ? 1 : 0.42,
        duration,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        useNativeDriver,
      }),
      Animated.timing(stageOpacity, { toValue: 0, duration, delay: reducedMotion ? 0 : 180, useNativeDriver }),
      Animated.timing(curtainProgress, {
        toValue: 1,
        duration: reducedMotion ? 220 : 1000,
        delay: reducedMotion ? 0 : 100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver,
      }),
    ]).start(() => {
      setExiting(false);
      setStep(2);
    });
  };

  const finishWithCard = async () => {
    if (!card || !bringChoice || settling) return;
    if (!sceneId && DIRECT_PREVIEW) {
      onBack();
      return;
    }
    if (!sceneId) return;
    setSettling(true);
    setError("");
    try {
      await settleScene(sceneId, buildSettlementPayload(card, bringChoice, actionHint));
      onBack(true);
    } catch (err) {
      setError((err as any)?.message ?? "视角卡还没有留下，请再试一次");
      setSettling(false);
    }
  };

  const finishWithoutCard = async () => {
    if (settling) return;
    if (!sceneId && DIRECT_PREVIEW) {
      onBack();
      return;
    }
    if (!sceneId) return;
    setSettling(true);
    try {
      await settleScene(sceneId, { card_text: null, insight_text: null, action_text: null, keep: false });
    } catch {
      // 用户明确选择不留内容时，退出权优先；服务端失败只会保留未结算场景，不会制造数据。
    } finally {
      onBack();
    }
  };

  if (!sceneId && !DIRECT_PREVIEW) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <PageContainer maxWidth={680} style={{ flex: 1, justifyContent: "center", gap: theme.spacing[4] }}>
          <Text style={[theme.typography.textStyles.pageTitle, { textAlign: "center", color: theme.colors.textPrimary }]}>这一幕没有找到</Text>
          <Text style={[theme.typography.textStyles.body, { textAlign: "center", color: theme.colors.textSecondary }]}>{error}</Text>
          <Button fullWidth onPress={() => onBack()}>回到首页</Button>
        </PageContainer>
      </ScrollView>
    );
  }

  if (step === 1 || exiting) {
    const halfWidth = Math.max(width, 390) / 2 + 2;
    const leftCurtain = curtainProgress.interpolate({ inputRange: [0, 1], outputRange: [-halfWidth, 0] });
    const rightCurtain = curtainProgress.interpolate({ inputRange: [0, 1], outputRange: [halfWidth, 0] });
    return (
      <View style={{ flex: 1, minHeight: isCompact ? height : undefined, overflow: "hidden", backgroundColor: STAGE.ink }}>
        <Animated.View style={[fill, { opacity: stageOpacity, transform: [{ scale: stageScale }] }]}>
          <StagePicture scene={scene} />
        </Animated.View>
        <Animated.View style={[fill, {
          opacity: copyOpacity,
          paddingHorizontal: isCompact ? 20 : 40,
          pointerEvents: exiting ? "none" : "auto",
        }]}>
          <StepIndicator step={1} dark />
          <View style={{ alignItems: "center", paddingTop: isCompact ? 8 : 24 }}>
            <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>场景回看 · 第一幕</Text>
            <Text style={{ marginTop: 8, fontSize: 25, lineHeight: 33, fontWeight: "500", color: "#FFFDF8" }}>镜头停在这里</Text>
            <Text style={{ marginTop: 6, fontSize: 14, color: "rgba(255,255,255,0.72)" }}>先不分析，只还原你刚才经历的这一幕</Text>
          </View>
          {!!lastExpression && (
            <View style={{ alignSelf: "center", marginTop: isCompact ? 30 : 54, maxWidth: 520, padding: 14, borderRadius: 16, backgroundColor: "rgba(255,253,250,0.92)" }}>
              <Text style={{ textAlign: "center", fontSize: 15, lineHeight: 23, color: paperColors.ink2 }}>“{lastExpression}”</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <View style={[{
            width: "100%", maxWidth: 660, alignSelf: "center", marginBottom: isCompact ? 22 : 38,
            padding: 18, borderRadius: theme.radii.dialog, backgroundColor: "rgba(255,253,250,0.95)",
          }, theme.shadows.floating]}>
            <Text style={{ fontSize: 12, letterSpacing: 0.4, color: paperColors.meta }}>这一幕里，你最后说的是</Text>
            <Text style={{ marginTop: 8, fontSize: 17, lineHeight: 27, fontWeight: "500", color: paperColors.ink2 }}>
              {lastExpression ? `“${lastExpression}”` : loading ? "正在找回你刚才的回应…" : "这一幕先安静地停在这里。"}
            </Text>
            <View style={{ marginTop: 12, gap: 7 }}>
              <Text style={{ fontSize: 13, color: paperColors.sub }}>• 你回应过 · {facts.responseCount} 次</Text>
              {facts.customCount > 0 ? <Text style={{ fontSize: 13, color: paperColors.sub }}>• 你自己说出的原话 · {facts.customCount} 段</Text> : null}
              <Text numberOfLines={2} style={{ fontSize: 13, color: paperColors.sub }}>• 对话停下的画面 · {facts.setting}</Text>
            </View>
            {!!error && <Text style={{ marginTop: 10, fontSize: 12, color: theme.colors.error }}>{error}</Text>}
            <View style={{ marginTop: 16 }}>
              <Button fullWidth size="large" loading={loading} disabled={loading} onPress={sitInAudience}>坐到观众席看看</Button>
            </View>
          </View>
        </Animated.View>
        <Animated.View style={{
          position: "absolute", top: 0, bottom: 0, left: 0, width: halfWidth,
          backgroundColor: STAGE.curtain, transform: [{ translateX: leftCurtain }],
          borderRightWidth: 18, borderRightColor: STAGE.curtainFold,
          pointerEvents: "none",
        }} />
        <Animated.View style={{
          position: "absolute", top: 0, bottom: 0, right: 0, width: halfWidth,
          backgroundColor: STAGE.curtain, transform: [{ translateX: rightCurtain }],
          borderLeftWidth: 18, borderLeftColor: STAGE.curtainFold,
          pointerEvents: "none",
        }} />
      </View>
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ flexGrow: 1 }}>
      <PageContainer maxWidth={760} style={{ flexGrow: 1, minHeight: isCompact ? height : undefined }}>
        {step === 2 && (
          <>
            <ReviewHeader step={2} eyebrow="场景回看 · 第二幕" title="如果你坐在观众席"
              description="看着当时的自己，你觉得那个人最想让别人知道什么？" />
            <View accessibilityRole="radiogroup" style={{ flex: 1, justifyContent: "center", gap: 10 }}>
              {summaryLoading ? (
                <View style={{ alignItems: "center", gap: 10 }}>
                  <ActivityIndicator color={theme.colors.accent} />
                  <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted }]}>正在整理几个供你核对的视角…</Text>
                </View>
              ) : (
                <>
                  {reflectionOptions.map((option, index) => (
                    <OptionButton key={option} marker={String(index + 1)} label={option}
                      selected={!customMode && selectedPerspective === option}
                      onPress={() => { setCustomMode(false); setSelectedPerspective(option); }} />
                  ))}
                  <OptionButton marker="+" label="我看到的不是这些…（自己说）" selected={customMode}
                    onPress={() => { setCustomMode(true); setSelectedPerspective(""); }} />
                  {customMode && (
                    <TextArea value={customPerspective} maxLength={120} autoFocus
                      onChangeText={setCustomPerspective} placeholder="写下你从观众席看到的……" />
                  )}
                </>
              )}
            </View>
            <View style={{ marginTop: theme.spacing[5], gap: theme.spacing[2] }}>
              <Button fullWidth size="large" disabled={!confirmedPerspective} onPress={() => setStep(3)}>继续</Button>
              <Button fullWidth variant="ghost" onPress={restartReview}>回到刚才的画面</Button>
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <ReviewHeader step={3} eyebrow="场景回看 · 第三幕" title="如果现在的你，可以走进画面"
              description="你想对当时的自己说什么？" />
            <View style={{ flex: 1, justifyContent: "center", gap: 10 }}>
              <TextArea value={messageToPast} maxLength={240} autoFocus
                onChangeText={setMessageToPast} placeholder="写在这里……" />
              <Text style={[theme.typography.textStyles.label, { textAlign: "center", color: theme.colors.textMuted }]}>
                只有在最后确认留下视角卡后，这句话才会保存。
              </Text>
            </View>
            <View style={{ marginTop: theme.spacing[5], gap: theme.spacing[2] }}>
              <Button fullWidth size="large" disabled={!messageToPast.trim()} onPress={() => setStep(4)}>说完了</Button>
              <Button fullWidth variant="secondary" onPress={() => { setMessageToPast("我暂时还说不出来，也可以。"); setStep(4); }}>暂时说不出来</Button>
              <Button fullWidth variant="ghost" onPress={() => setStep(2)}>返回上一步</Button>
            </View>
          </>
        )}

        {step === 4 && (
          <>
            <ReviewHeader step={4} eyebrow="场景回看 · 最后一幕" title="把一个选择带回今天"
              description="过去没有因此被改写。但下一次遇到相似的时刻，你已经多了一个选择。" />
            <View accessibilityRole="radiogroup" style={{ flex: 1, alignContent: "center", justifyContent: "center", flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <BringCard compact={isCompact} title="记住一句话" description="留下刚才对过去的自己说的话"
                selected={bringChoice === "remember"} onPress={() => setBringChoice("remember")} />
              <BringCard compact={isCompact} title="试一个小动作" description={actionHint}
                selected={bringChoice === "small_action"} onPress={() => setBringChoice("small_action")} />
              <BringCard compact={isCompact} title="回到片场再试一次" description="不带走结论，继续走进这一幕"
                selected={bringChoice === "replay"} onPress={() => setBringChoice("replay")} />
              <BringCard compact={isCompact} title="只是看见就好" description="不生成任务、不要求改变"
                selected={bringChoice === "witness"} onPress={() => setBringChoice("witness")} />
            </View>
            <View style={{ marginTop: theme.spacing[5], gap: theme.spacing[2] }}>
              <Button fullWidth size="large" disabled={!bringChoice}
                onPress={() => bringChoice === "replay" ? (DIRECT_PREVIEW ? restartReview() : onReplay()) : setStep(5)}>
                {bringChoice === "replay" ? "回到片场继续这一幕" : "留下这张视角卡"}
              </Button>
              <Button fullWidth variant="ghost" onPress={() => setStep(3)}>返回上一步</Button>
            </View>
          </>
        )}

        {step === 5 && card && (
          <>
            <ReviewHeader step={5} eyebrow="这一幕，到这里就够了" title="你带回了一张视角卡"
              description="它不是结论，只是现在的你多看见了一点。" />
            <View style={{ flex: 1, justifyContent: "center" }}>
              <PerspectiveCard card={card} companionComment={companionComment} petName={petName} />
            </View>
            {!!error && <Text accessibilityRole="alert" style={{ marginTop: 12, textAlign: "center", color: theme.colors.error }}>{error}</Text>}
            <View style={{ marginTop: theme.spacing[5], gap: theme.spacing[2] }}>
              <Button fullWidth size="large" loading={settling} onPress={finishWithCard}>带着它回到今天</Button>
              <Button fullWidth variant="secondary" disabled={settling} onPress={restartReview}>再走一遍回看</Button>
              <Button fullWidth variant="ghost" disabled={settling} onPress={finishWithoutCard}>不留下，回到今天</Button>
            </View>
          </>
        )}
      </PageContainer>
    </ScrollView>
  );
}
