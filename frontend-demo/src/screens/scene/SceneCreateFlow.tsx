/**
 * 片场创建流程：内置场景阅读卡（ScenePortal）、语音创建入口（CreateSceneEntry）、
 * 口述采集（SceneNarrationCapture）、整理预览（SceneSummaryPreview）、角色设定（CharacterSetupSheet）。
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Pressable, ScrollView, Text, View,
} from "react-native";
import { ArrowRight, Lock, Mic } from "lucide-react-native";
import { Button, Card, CreamRipple, TextField, TextArea, useResponsive, useTheme } from "../../design-system";
import { parseSceneNarration, parseSceneRole } from "../../api";
import type { SceneParseResult } from "../../api";
import { useVoiceInput } from "../../useVoiceInput";
import { ActBar, BuiltInScene, CharReady, useSceneSurface } from "./shared";

/** 内置场景：稳定的阅读卡片，不以滚动位置决定能否进入。 */
export function ScenePortal({ scene, index, onEnter }: {
  scene: BuiltInScene; index: number; onEnter: () => void;
}) {
  const theme = useTheme();
  return (
    <Card onPress={onEnter} style={{ flex: 1, minHeight: 216, padding: theme.spacing[6], borderWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing[6] }}>
        <Text style={[theme.typography.textStyles.label, { color: theme.colors.textMuted }]}>{String(index + 1).padStart(2, "0")}</Text>
        <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textSecondary, flexShrink: 1, marginLeft: theme.spacing[4], textAlign: "right" }]}>{scene.relationships.join(" · ")}</Text>
      </View>
      <Text accessibilityRole="header" style={[theme.typography.textStyles.sectionTitle, { color: theme.colors.textPrimary, fontSize: 23, lineHeight: 32 }]}>{scene.title}</Text>
      <Text style={[theme.typography.textStyles.body, { marginTop: theme.spacing[2], marginBottom: theme.spacing[6], color: theme.colors.textSecondary }]}>{scene.desc}</Text>
      <View style={{ marginTop: "auto", flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
        <Text style={[theme.typography.textStyles.caption, { color: theme.colors.accent }]}>进入场景</Text>
        <ArrowRight size={16} color={theme.colors.accent} />
      </View>
    </Card>
  );
}

/** 语音和文字仍进入同一个采集流程，只收敛入口的视觉层级。 */
export function CreateSceneEntry({ onStart }: { onStart: () => void }) {
  const { theme, C } = useSceneSurface();
  const { isExpanded } = useResponsive();
  return (
    <View style={{ gap: theme.spacing[5], paddingVertical: theme.spacing[6], flexDirection: isExpanded ? "row" : "column" }}>
      <View style={{ flex: 1, gap: theme.spacing[2] }}>
        <Text style={[theme.typography.textStyles.sectionTitle, { color: C.text }]}>想重演的，是哪一天？</Text>
        <Text style={[theme.typography.textStyles.body, { color: C.text2, maxWidth: 440 }]}>
          讲给我听，或者慢慢写下来。{"\n"}不用组织好语言，也不用从头讲起。
        </Text>
      </View>
      <View style={{ width: isExpanded ? 320 : "100%", gap: theme.spacing[3] }}>
        <Button onPress={onStart} fullWidth>点一下，开始讲</Button>
        <Text style={[theme.typography.textStyles.caption, { color: C.muted }]}>或者写下来</Text>
        <Card onPress={onStart} style={{ padding: theme.spacing[4], borderRadius: theme.radii.control }}>
          <Text style={[theme.typography.textStyles.body, { color: C.placeholder }]}>那件事发生在……</Text>
        </Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
          <Lock size={12} color={C.muted} />
          <Text style={[theme.typography.textStyles.label, { color: C.muted, flex: 1 }]}>这里说的话，只留在你和喵灵之间</Text>
        </View>
      </View>
    </View>
  );
}

/** 第一幕 · 讲述：按住麦克录音转写，或直接文字输入；「我在听」波形示意正在采集。 */
export function SceneNarrationCapture({ onBack, onConfirm }: {
  onBack: () => void; onConfirm: (text: string) => void;
}) {
  const { theme, C } = useSceneSurface();
  const { isExpanded } = useResponsive();
  const [text, setText] = useState("");
  const beforeRecording = useRef("");
  // 真机 PCM 在录音中把累计转写整体替换到描述框；松手后的整段识别再校准最终文本。
  const voice = useVoiceInput(
    (finalText) => setText(`${beforeRecording.current}${finalText}`),
    (partialText) => setText(`${beforeRecording.current}${partialText}`),
  );
  const placeholder = "我想回到上周和朋友吵架之后。地点在学校门口，她准备打车离开。她平时比较敏感，生气后会假装不在意，但其实很希望我先道歉。我想试着把她叫住。";
  const micHint = voice.transcribing ? "正在转写…" : voice.isRecording ? "松开结束录音" : "按住说话";
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ActBar stage={0} onBack={onBack} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20,
          // 手机底部导航绝对定位在内容之上；转写文本变长后需要留出完整导航高度，
          // 否则末尾的「讲完了」会被遮住，滚动容器却已经到达底部。
          paddingBottom: isExpanded ? 24 : 128,
          gap: 20,
        }}
      >
        <View style={{ paddingTop: 8 }}>
          <Text style={{ fontSize: 24, fontWeight: "500", lineHeight: 34, color: C.text }}>
            想重演的，{"\n"}是哪一天？
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 21, marginTop: 8, color: C.muted }}>
            讲给我听，或者慢慢写下来。{"\n"}不用组织好语言，也不用从头讲起。
          </Text>
        </View>

        {/* 麦克风光晕：按住说话，录音中金色反馈 */}
        <View style={{ alignItems: "center", gap: 10, marginTop: 4 }}>
          <View style={{ width: 112, height: 112, alignItems: "center", justifyContent: "center" }}>
            <View style={{
              position: "absolute", width: 112, height: 112, borderRadius: 56,
              backgroundColor: theme.colors.accentSoft,
            }} />
            <Pressable
              onPressIn={() => {
                beforeRecording.current = text;
                void voice.start();
              }}
              onPressOut={() => { void voice.stop(); }}
              disabled={voice.transcribing}
              style={({ pressed }) => ({
                width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center",
                backgroundColor: voice.isRecording ? theme.colors.accentSurface : theme.colors.surfaceElevated,
                borderWidth: 2, borderColor: voice.isRecording ? theme.colors.accent : theme.colors.border,
                opacity: voice.transcribing ? 0.6 : 1,
                transform: [{ scale: pressed ? 0.94 : 1 }],
              })}>
              <Mic size={26} color={theme.colors.accent} />
            </Pressable>
          </View>
          <Text style={{ fontSize: 12, color: C.muted }}>{micHint}</Text>
          {voice.error ? <Text style={{ fontSize: 12, color: theme.colors.error }}>{voice.error}</Text> : null}
        </View>

        {/* 我在听：录音时出现，示意不急、慢慢讲 */}
        {voice.isRecording ? (
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 12,
            padding: 12, borderRadius: 18,
            backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, height: 26 }}>
              {[10, 18, 26, 16, 22, 12].map((h, i) => (
                <View key={i} style={{ width: 3, height: h, borderRadius: 2, backgroundColor: theme.colors.accent, opacity: 0.75 }} />
              ))}
            </View>
            <Text style={{ fontSize: 12.5, color: C.text2 }}>
              <Text style={{ fontWeight: "600", color: C.text }}>我在听</Text> · 不急，慢慢讲
            </Text>
          </View>
        ) : null}

        {/* 转写 / 手动输入区：语音追加或直接打字 */}
        <TextArea accessibilityLabel="场景讲述"
          value={text} onChangeText={setText}
          placeholder={placeholder}
          style={{ minHeight: 200 }}
        />
        <Button onPress={() => onConfirm(text || placeholder)} fullWidth>讲完了</Button>
      </ScrollView>
    </View>
  );
}

/** 整理预览：把口述送后端整理成结构化字段，失败可重试。 */
export function SceneSummaryPreview({ narration, onBack, onConfirm }: {
  narration: string;
  onBack: () => void;
  onConfirm: (parsed: SceneParseResult) => void;
}) {
  const { theme, C } = useSceneSurface();
  const { isExpanded } = useResponsive();
  const [parsed, setParsed] = useState<SceneParseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 进页面就把用户刚说的那段送去整理；失败给重试，不再显示写死的示例数据
  const run = React.useCallback(() => {
    setLoading(true);
    setError("");
    parseSceneNarration(narration)
      .then((res) => setParsed(res))
      .catch((e) => setError(e?.message ?? "整理失败，再试一次"))
      .finally(() => setLoading(false));
  }, [narration]);

  useEffect(() => { run(); }, [run]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ActBar stage={1} onBack={onBack} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
          <CreamRipple active />
          <Text style={{ fontSize: 15, color: C.text2 }}>我在整理你刚说的…</Text>
        </View>
      </View>
    );
  }

  if (error || !parsed) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ActBar stage={1} onBack={onBack} />
        <View style={{ flex: 1, paddingHorizontal: 20, gap: 16, justifyContent: "center" }}>
          <Text style={{ fontSize: 15, color: C.text, textAlign: "center" }}>{error || "整理失败"}</Text>
          <Button onPress={run} fullWidth>再试一次</Button>
          <Pressable onPress={onBack} style={{ paddingVertical: 12, alignItems: "center" }}>
            <Text style={{ fontSize: 13, color: C.muted }}>回去重新说</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const items = parsed.items ?? [];
  const hasMissing = (parsed.missing?.length ?? 0) > 0;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ActBar stage={1} onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20, paddingBottom: isExpanded ? 24 : 128, gap: 20 }}>
        <View style={{ paddingTop: 8 }}>
          <Text style={{ fontSize: 24, fontWeight: "500", lineHeight: 34, color: C.text }}>
            我把听到的，{"\n"}整理成了这一幕
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 21, marginTop: 8, color: C.muted }}>
            看看对不对——不对的地方，点一下就能改。
          </Text>
        </View>
        <View style={{
          borderRadius: 20, overflow: "hidden",
          backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
        }}>
          {items.map((item, i) => (
            <View key={item.key ?? i} style={{
              flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingVertical: 14,
              borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: theme.colors.divider,
            }}>
              <Text style={{ fontSize: 12, width: 96, marginTop: 2, color: C.muted }}>{item.label}</Text>
              {/* 用户没提到的字段留空，不编造内容 */}
              <Text style={{
                fontSize: 14, flex: 1, lineHeight: 20,
                color: item.value ? C.text : C.placeholder,
                fontStyle: item.value ? "normal" : "italic",
              }}>
                {item.value || "你没提到，下一步可以补充"}
              </Text>
            </View>
          ))}
        </View>
        {hasMissing ? (
          <Text style={{ fontSize: 12, color: C.muted }}>
            空着的部分不影响继续，进入下一步时可以补。
          </Text>
        ) : null}
        <View style={{ gap: 8, marginTop: "auto" }}>
          <Button onPress={() => onConfirm(parsed)} fullWidth>就是这样，继续</Button>
          <Pressable onPress={onBack} style={{ paddingVertical: 12, alignItems: "center" }}>
            <Text style={{ fontSize: 13, color: C.muted }}>我再补充几句</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

/** 角色设定：称呼/关系/介绍/补充，静默请求行为倾向，确认后进入场景。 */
export function CharacterSetupSheet({ scene, parsed, onBack, onReady }: {
  scene: BuiltInScene | null;
  /** 走「描述场景」路径时带上场景整理结果，用来预填称呼/关系/行为倾向 */
  parsed?: SceneParseResult | null;
  onBack: () => void;
  onReady: (char: CharReady) => void;
}) {
  const { theme, C } = useSceneSurface();
  const { isExpanded } = useResponsive();
  const [name, setName] = useState(parsed?.people ?? "");
  const [rel, setRel] = useState(parsed?.relation || scene?.relationships[0] || "");
  const [desc, setDesc] = useState("");
  // 补充校准：预设 chips 多选 + 一条手动补充，合并成一段（业务结构不变，仍是 string）
  const ADJUST_CHIPS = ["语气再轻一点", "别安排 TA 笑场", "关系再近一点", "场景要有风"];
  const [picked, setPicked] = useState<string[]>([]);
  const [adjusted, setAdjusted] = useState("");
  const adjustedFull = [...picked, adjusted].filter(Boolean).join("；");
  const [entryRipple, setEntryRipple] = useState(false);
  // 渲染方式：默认生成式 3D（方案 A），可切回图片 galgame
  const [renderKind, setRenderKind] = useState<"generated_3d" | "dynamic_image">("generated_3d");

  // 静默请求后端整理 TA 的行为倾向（不阻塞进入，traits 在搭建时一并使用）
  const traitsRef = React.useRef<string[]>(parsed?.counterpart_traits ?? []);
  const traitsFiredRef = React.useRef(false);
  // 进入涟漪计时器：卸载时清理，避免卸载后 setState
  const enterTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (enterTimer.current) clearTimeout(enterTimer.current); }, []);
  React.useEffect(() => {
    if (traitsFiredRef.current) return;
    if (!name && !desc) return;
    traitsFiredRef.current = true;
    parseSceneRole({
      name, relation: rel, desc,
      extra_traits: parsed?.counterpart_traits ?? [],
    })
      .then((res) => { traitsRef.current = res.traits ?? []; })
      .catch(() => { /* 静默失败，不影响进入 */ });
  }, [name, rel, desc, parsed]);

  const handleEnter = () => {
    setEntryRipple(true);
    if (enterTimer.current) clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => {
      setEntryRipple(false);
      onReady({ name: name || "TA", relation: rel, desc, adjusted: adjustedFull, traits: traitsRef.current, renderKind });
    }, 380);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ActBar stage={2} onBack={onBack} />

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20,
            // 手机底部导航是绝对定位；为最后一组操作留出可滚动空间，避免按钮被覆盖。
            paddingBottom: isExpanded ? 24 : 128,
            gap: 20,
          }}
        >
          {/* 第三幕 · 定妆 标题 */}
          <View style={{ paddingTop: 8 }}>
            <Text style={{ fontSize: 24, fontWeight: "500", lineHeight: 34, color: C.text }}>
              开演前，{"\n"}给 TA 定妆
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 21, marginTop: 8, color: C.muted }}>
              喵灵按你的记忆来演 TA，演得不像的地方，现在告诉我。
            </Text>
          </View>

          <View style={{ gap: 14 }}>
            <View>
              <Text style={{ fontSize: 12, marginBottom: 8, paddingHorizontal: 4, color: C.muted }}>称呼 TA 为</Text>
              <TextField accessibilityLabel="称呼 TA 为"
                value={name} onChangeText={setName}
                placeholder="比如：妈妈、她、老朋友…"
              />
            </View>

            <View>
              <Text style={{ fontSize: 12, marginBottom: 8, paddingHorizontal: 4, color: C.muted }}>我们的关系</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(scene?.relationships ?? ["朋友", "家人", "恋人", "同事"]).map(r => (
                  <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: rel === r }} onPress={() => setRel(r)}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, borderRadius: theme.radii.control,
                      backgroundColor: rel === r ? theme.colors.accentSoft : theme.colors.surface,
                      borderWidth: 1,
                      borderColor: rel === r ? theme.colors.focus : theme.colors.border,
                    }}>
                    <Text style={{ fontSize: 13, color: C.text }}>{r}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View>
              <Text style={{ fontSize: 12, marginBottom: 8, paddingHorizontal: 4, color: C.muted }}>你记忆里的 TA</Text>
              <TextArea accessibilityLabel="你记忆里的 TA"
                value={desc} onChangeText={setDesc}
                placeholder={`比如：${name || "她"}平时说话比较直，不太表达关心，但其实很在意我…`}
              />
            </View>

            <View>
              <Text style={{ fontSize: 12, marginBottom: 8, paddingHorizontal: 4, color: C.muted }}>补充校准（可多选）</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {ADJUST_CHIPS.map(c => {
                  const on = picked.includes(c);
                  return (
                    <Pressable key={c} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setPicked(prev => on ? prev.filter(x => x !== c) : [...prev, c])}
                      style={{
                        paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, borderRadius: theme.radii.control,
                        backgroundColor: on ? theme.colors.accentSoft : theme.colors.surface,
                        borderWidth: 1,
                        borderColor: on ? theme.colors.focus : theme.colors.border,
                      }}>
                      <Text style={{ fontSize: 13, fontWeight: on ? "600" : "400", color: on ? theme.colors.textPrimary : theme.colors.textSecondary }}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ marginTop: theme.spacing[3] }}>
              <TextField accessibilityLabel="补充校准"
                value={adjusted} onChangeText={setAdjusted}
                placeholder="或者，还有什么想补充的？（可选）"
              />
              </View>
            </View>
          </View>

          <View style={{ gap: 8, marginTop: 8 }}>
            {/* 渲染方式选择：3D 场景（生成式低多边形）/ 图片场景（galgame） */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {([["generated_3d", "3D 场景"], ["dynamic_image", "图片场景"]] as const).map(([k, label]) => {
                const on = renderKind === k;
                return (
                  <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setRenderKind(k)}
                    style={{
                      flex: 1, minHeight: 44, paddingVertical: 10, borderRadius: theme.radii.control, alignItems: "center",
                      backgroundColor: on ? theme.colors.accentSoft : theme.colors.surface,
                      borderWidth: 1,
                      borderColor: on ? theme.colors.focus : theme.colors.border,
                    }}>
                    <Text style={{ fontSize: 13, fontWeight: on ? "600" : "400", color: on ? theme.colors.textPrimary : theme.colors.textSecondary }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View>
              <CreamRipple active={entryRipple} />
              <Button onPress={handleEnter} fullWidth>定妆，准备开演</Button>
            </View>
            <Text style={{ fontSize: 11, textAlign: "center", color: C.muted }}>
              这些只用来演好这一幕，不做别的用途。
            </Text>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
