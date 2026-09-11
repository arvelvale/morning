/**
 * 片场主屏：响应式场景列表 + 我的场景 + 待确认片段 + 语音创建入口。
 * 创建流程（口述→整理→角色设定）以子状态在本组件内切换，搭建中/失败用覆盖层呈现。
 */
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { ChevronLeft, Trash2 } from "lucide-react-native";
import {
  Button, Card, PageContainer, PageHeader, useResponsive,
} from "../../design-system";
import {
  listSceneTemplates, listScenes, createScene, deleteScene,
  listCandidates, dismissCandidate, streamConfirmCandidate,
} from "../../api";
import type { SceneParseResult } from "../../api";
import type { TheaterSceneId } from "../../theater";
import {
  BUILT_IN_SCENES, BuiltInScene, CharReady, SceneSubState,
  _AMBIENT, _AMBIENT_DEFAULT, useSceneSurface,
} from "./shared";
import { BuildFailed, BuildingStage } from "./BuildOverlays";
import {
  CharacterSetupSheet, CreateSceneEntry, SceneNarrationCapture, SceneSummaryPreview, ScenePortal,
} from "./SceneCreateFlow";

/** 后端 SceneOut（我的场景） */
interface MyScene {
  id: number; title: string; status: string; setting: string; turn: number;
}

/** 后端 CandidateOut（待确认片段） */
interface Candidate {
  id: number; content: string; surface_text: string; status: string | null; created_at: string;
}

/** 片场主屏。 */
export function SceneScreen({ onPlay }: { onPlay: (sceneId: number, theater?: TheaterSceneId) => void }) {
  const { theme, C } = useSceneSurface();
  const { isExpanded } = useResponsive();
  const [subState, setSubState] = useState<SceneSubState>("browsing");
  const [selectedScene, setSelectedScene] = useState<BuiltInScene | null>(null);
  const [templates, setTemplates] = useState<BuiltInScene[]>(BUILT_IN_SCENES);
  const [myScenes, setMyScenes] = useState<MyScene[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [narration, setNarration] = useState("");
  const [parsedScene, setParsedScene] = useState<SceneParseResult | null>(null);
  // 失败重试用：记住上一次角色设定的结果，重试时不用让用户重新填
  const [pendingChar, setPendingChar] = useState<CharReady | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  // 「切到后台等待」：收起候场覆盖层但生成继续；失败仍要弹 BuildFailed 告知。
  const [stageHidden, setStageHidden] = useState(false);

  const refreshCandidates = () =>
    listCandidates()
      .then((list) => setCandidates(Array.isArray(list) ? list : []))
      .catch(() => {});

  // 删除已生成的场景（长按触发，二次确认）；成功后从列表移除。
  const handleDeleteScene = (s: MyScene) => {
    Alert.alert("删除这个场景？", `「${s.title}」删除后无法恢复。`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除", style: "destructive",
        onPress: () => {
          setMyScenes((prev) => prev.filter((x) => x.id !== s.id));
          deleteScene(s.id).catch(() => {
            // 失败则拉回最新列表（避免假删）
            listScenes().then((list) => setMyScenes(Array.isArray(list) ? list : [])).catch(() => {});
          });
        },
      },
    ]);
  };

  useEffect(() => {
    listSceneTemplates()
      .then((list) => {
        if (Array.isArray(list) && list.length) {
          setTemplates(list.map((t: any) => ({
            id: t.id, title: t.title, desc: t.desc,
            relationships: t.relationships ?? [],
            colors: (t.colors?.length ? t.colors : ["#F5ECD8", "#E2C9A0"]) as BuiltInScene["colors"],
            theater: (BUILT_IN_SCENES.find(b => b.id === t.id)?.theater ?? "bedroom") as TheaterSceneId,
            ...(_AMBIENT[t.id] ?? _AMBIENT_DEFAULT),
          })));
        }
      })
      .catch(() => { /* 离线用本地内置模板 */ });
    listScenes()
      .then((list) => setMyScenes(Array.isArray(list) ? list : []))
      .catch(() => {});
    refreshCandidates();
  }, []);

  const handleConfirmCandidate = (c: Candidate) => {
    if (generating) return;
    setGenerating(true);
    setGenError("");
    streamConfirmCandidate(c.id, (e) => {
      if (e.event === "done" && e.data?.scene_id) {
        setGenerating(false);
        onPlay(e.data.scene_id);
      }
    })
      .catch((err) => {
        setGenerating(false);
        setGenError(err?.message ?? "确认失败，再试一次");
      });
  };

  const handleDismissCandidate = (id: number) => {
    dismissCandidate(id).then(refreshCandidates).catch(() => {});
  };

  const handleBack = () => {
    if (subState === "capturing") setSubState("browsing");
    else if (subState === "reviewing") setSubState("capturing");
    else if (subState === "setup") setSubState(selectedScene ? "browsing" : "reviewing");
    else setSubState("browsing");
  };

  // 角色设定完成 → 真实生成开场，拿到 scene_id 进入演练
  // 渲染方式由用户在设定页选择（char.renderKind）：generated_3d 生成式 3D / dynamic_image 图片 galgame，
  // 后端据此产 SceneSpec 或背景图+立绘，进入 ScenePlay 后按 render_kind 渲染。
  //
  // ⚠️ 失败时**不能**卸载 CharacterSetupSheet：它一卸载 step/输入全丢，用户会被莫名
  // 甩回「谁在你面前」第一步。所以 generating/genError 都用覆盖层呈现（见下方 return）。
  const buildScene = React.useCallback((char: CharReady) => {
    setGenerating(true);
    setStageHidden(false);
    setGenError("");
    // 字段优先用「场景整理」抽出来的真实内容；走内置模板路径时回落到模板标题
    const p = parsedScene;
    const fields = {
      title: p?.title || selectedScene?.title || (char.name ? `和${char.name}的那一刻` : "那一刻"),
      people: (char.name || p?.people || "TA") + (char.relation ? `（${char.relation}）` : ""),
      place: p?.place || selectedScene?.title || "",
      plot: [
        narration,
        p?.counterpart_action ? `此刻对方：${p.counterpart_action}` : "",
        char.traits.length ? `对方会怎么表现：${char.traits.join("；")}` : "",
        char.desc,
        char.adjusted ? `补充：${char.adjusted}` : "",
      ].filter(Boolean).join("。"),
      intent: p?.intent || char.adjusted || char.desc || "试着说出没说的话",
      render_kind: char.renderKind,
    };
    createScene(fields)
      .then((scene) => {
        setGenerating(false);
        // galgame 场景按 render_kind 渲染，theater 参数被忽略，沿用原选择即可
        onPlay(scene.id, selectedScene?.theater);
      })
      .catch((err) => {
        setGenerating(false);
        setGenError(err?.message ?? "生成失败，再试一次");
      });
  }, [parsedScene, selectedScene, narration, onPlay]);

  const handleCharReady = (char: CharReady) => {
    if (generating) return;
    setPendingChar(char);   // 记下来，失败后可以原样重试，不用重新填
    buildScene(char);
  };

  const retryBuild = () => {
    if (pendingChar) buildScene(pendingChar);
    else setGenError("");
  };

  // 覆盖层：搭建中（候场） / 搭建失败。用 absolute 盖在内容之上，而不是 return 掉内容，
  // 这样 CharacterSetupSheet 不会被卸载，用户填的称呼/介绍在失败后还在。
  // 「切到后台」只隐藏候场覆盖层，生成完成仍 onPlay 进入场景；失败时 BuildFailed 照常弹出。
  const overlay = generating && !stageHidden ? (
    <BuildingStage onHide={() => setStageHidden(true)} />
  ) : genError ? (
    <BuildFailed error={genError} canRetry={!!pendingChar}
      onRetry={retryBuild} onDismiss={() => setGenError("")} />
  ) : null;

  if (subState === "capturing") {
    return (
      <View style={{ flex: 1 }}>
        <SceneNarrationCapture onBack={handleBack}
          onConfirm={(text) => { setNarration(text); setSubState("reviewing"); }} />
        {overlay}
      </View>
    );
  }
  if (subState === "reviewing") {
    return (
      <View style={{ flex: 1 }}>
        <SceneSummaryPreview narration={narration} onBack={handleBack}
          onConfirm={(p) => { setParsedScene(p); setSubState("setup"); }} />
        {overlay}
      </View>
    );
  }
  if (subState === "setup") {
    return (
      <View style={{ flex: 1 }}>
        <CharacterSetupSheet scene={selectedScene} parsed={parsedScene}
          onBack={handleBack} onReady={handleCharReady} />
        {overlay}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
      <PageContainer maxWidth={1180}>
      <PageHeader
        title="片场"
        description="进入一个场景，试着说出不同的话。这里没有标准答案，也可以随时离开。"
      />

      <View style={{ flexDirection: isExpanded ? "row" : "column", flexWrap: "wrap", gap: theme.spacing[4], marginBottom: theme.spacing[4] }}>
        {templates.map((scene, i) => (
          <View key={scene.id} style={{ width: isExpanded ? "31%" : "100%", flexGrow: isExpanded ? 1 : 0, minWidth: 0 }}>
            <ScenePortal scene={scene} index={i}
              onEnter={() => { setSelectedScene(scene); setParsedScene(null); setSubState("setup"); }} />
          </View>
        ))}
      </View>

      <View style={{ marginTop: theme.spacing[4] }}>
        {/* 我的场景（后端） */}
        {myScenes.length > 0 && (
          <View style={{ marginBottom: theme.spacing[5] }}>
            <Text style={[theme.typography.textStyles.sectionTitle, { marginBottom: theme.spacing[3], color: C.text }]}>我的场景</Text>
            {myScenes.map(s => (
              <Pressable key={s.id} onPress={() => onPlay(s.id)} onLongPress={() => handleDeleteScene(s)}
                style={({ pressed }) => [{
                  paddingVertical: theme.spacing[4], paddingHorizontal: theme.spacing[2], flexDirection: "row", alignItems: "center",
                  backgroundColor: pressed ? theme.colors.surfacePressed : "transparent", borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "500", color: C.text }}>{s.title}</Text>
                  <Text style={{ fontSize: 12, marginTop: 2, color: C.muted }}>
                    {s.status === "settled" ? "已结算" : `进行中 · 第 ${s.turn} 轮`}
                  </Text>
                </View>
                {/* 删除：点按也可删（含二次确认），与长按等效 */}
                <Pressable onPress={() => handleDeleteScene(s)} hitSlop={10}
                  style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", marginRight: 2 }}>
                  <Trash2 size={15} color={C.muted} />
                </Pressable>
                <ChevronLeft size={15} color={C.muted} style={{ transform: [{ rotate: "180deg" }] }} />
              </Pressable>
            ))}
          </View>
        )}
        {/* 候选片段（后端） */}
        {candidates.length > 0 && (
          <View style={{ marginBottom: theme.spacing[5] }}>
            <Text style={[theme.typography.textStyles.sectionTitle, { marginBottom: theme.spacing[3], color: C.text }]}>待确认片段</Text>
            {candidates.map(c => (
              <Card key={c.id} style={{ marginBottom: theme.spacing[2] }}>
                <Text style={{ fontSize: 14, lineHeight: 20, color: C.text }}>
                  {(c.surface_text || c.content).slice(0, 120)}
                  {(c.surface_text || c.content).length > 120 ? "…" : ""}
                </Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <View style={{ flex: 1 }}><Button fullWidth onPress={() => handleConfirmCandidate(c)}>进入场景</Button></View>
                  <View style={{ flex: 1 }}><Button fullWidth variant="secondary" onPress={() => handleDismissCandidate(c.id)}>忽略</Button></View>
                </View>
              </Card>
            ))}
          </View>
        )}
        {!!genError && (
          <Text style={{ fontSize: 12, textAlign: "center", marginBottom: 8, color: "#A26458" }}>{genError}</Text>
        )}
        <View style={{ height: 1, marginVertical: 24, backgroundColor: theme.colors.divider }} />
        <CreateSceneEntry onStart={() => {
          setSelectedScene(null);
          setParsedScene(null);
          setSubState("capturing");
        }} />
      </View>
      </PageContainer>
      </ScrollView>
      {overlay}
    </View>
  );
}
