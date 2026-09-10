/**
 * 片场演绎：视觉小说式对话（打字机字幕 + 选项/自己说）+ 暂停/校准「TA 不太像」。
 * 背景按 render_kind 渲染：dynamic_image 用后端背景图（回合更新，crossfade），否则预置 3D 舞台。
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Easing, Image, Pressable, ScrollView, Text, TextInput, View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { Edit3, Play, Send, Volume2, VolumeX } from "lucide-react-native";
import { useReducedMotion, useTheme, paperColors } from "../../design-system";
import { Scene3D } from "../Scene3D";
import {
  getScene, streamSceneChoice, streamSceneCustom, calibrateScene, absUrl,
} from "../../api";
import type { SSEEvent } from "../../api";
import { speakReply, stopSpeaking } from "../../speak";
import { useTypewriter } from "../../useTypewriter";
import type { TheaterSceneId } from "../../theater";
import { SceneChoice, SceneDetail } from "./shared";
import { getSceneAdvancePhase } from "./sceneReview";

const bgFill = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };
const NARRATION_VOICE_KEY = "morning.sceneNarrationVoice";

/** galgame 动态背景：url 变化时旧图淡出、新图淡入（≤300ms）；
 *  加载前暖色底 + 指示器占位，加载失败退回暖色渐变。 */
function DynamicBackground({ url, reducedMotion }: { url: string | null; reducedMotion: boolean }) {
  const [current, setCurrent] = useState<string | null>(url);
  const [previous, setPrevious] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (url === current) return;
    const prev = current;
    setCurrent(url);
    setLoaded(false);
    setFailed(false);
    if (reducedMotion || !prev) {
      setPrevious(null);
      fade.setValue(1);
      return;
    }
    setPrevious(prev);
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true })
      .start(() => setPrevious(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, reducedMotion]);

  if (!current || failed) {
    return (
      <LinearGradient colors={["#2A1E14", "#3A2A1C", "#4A3626"]} style={bgFill} />
    );
  }
  return (
    <>
      {/* 暖色底：图片加载前的占位 */}
      <View style={[bgFill, { backgroundColor: "#3A2A1C" }]} />
      {previous && (
        <Image source={{ uri: previous }} resizeMode="cover" style={bgFill} />
      )}
      <Animated.Image source={{ uri: current }} resizeMode="cover"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={[bgFill, { opacity: previous ? fade : 1 }]} />
      {!loaded && !previous && (
        <View style={[bgFill, { alignItems: "center", justifyContent: "center" }]}>
          <ActivityIndicator color="rgba(246,231,168,0.85)" />
        </View>
      )}
      {/* 暗化遮罩：保证字幕/按钮文字可读 */}
      <View style={[bgFill, { backgroundColor: "rgba(20,14,10,0.28)" }]} />
    </>
  );
}

/** 动态 galgame 立绘：图片人物（保留呼吸浮动 + 说话声波动效），加载失败退回纯背景。 */
function CharacterArtwork({ name, isSpeaking, isListening, spriteUrl }: {
  name: string; isSpeaking: boolean; isListening: boolean; spriteUrl: string;
}) {
  const bounce = useRef(new Animated.Value(0)).current;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [spriteUrl]);
  useEffect(() => {
    if (isSpeaking) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(bounce, { toValue: -4, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(bounce, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [isSpeaking, bounce]);

  // 立绘加载失败：不画人物，退回纯背景/舞台
  if (failed) return null;

  return (
    <Animated.View style={{ alignItems: "center", transform: [{ translateY: bounce }] }}>
      {isListening && (
        <View style={{
          position: "absolute", top: 20, width: 260, height: 260, borderRadius: 130,
          backgroundColor: "rgba(246,231,168,0.18)",
        }} />
      )}
      {!loaded && (
        <View style={{
          position: "absolute", width: 300, height: 380, borderRadius: 24,
          backgroundColor: "rgba(246,231,168,0.10)", alignItems: "center", justifyContent: "center",
        }}>
          <ActivityIndicator color="rgba(255,255,255,0.6)" />
        </View>
      )}
      <Image source={{ uri: spriteUrl }} resizeMode="contain"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={{ width: 300, height: 380 }} />
      {isSpeaking && (
        <View style={{ flexDirection: "row", gap: 3, marginTop: 6, alignItems: "flex-end", height: 14 }}>
          {[1, 2, 3].map(j => (
            <View key={j} style={{ width: 3, height: 4 + j * 3, backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 1.5 }} />
          ))}
        </View>
      )}
    </Animated.View>
  );
}

/** 片场演绎主组件。 */
export function ScenePlay({ sceneId, theater, onEnd }: {
  sceneId?: number | null;
  /** 背景 theater 3D 场景，默认家中餐桌 */
  theater?: TheaterSceneId;
  onEnd: () => void;
}) {
  const theme = useTheme();
  const [phase, setPhase] = useState<"intro" | "playing" | "paused" | "busy" | "closure" | "ending">("intro");
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [error, setError] = useState("");
  const [streamText, setStreamText] = useState("");
  const [adjustInput, setAdjustInput] = useState("");
  const [showAdjust, setShowAdjust] = useState(false);
  const [showCustom, setShowCustom] = useState(false);   // 「自己说」输入行是否展开
  const [customText, setCustomText] = useState("");
  const [narrationVoice, setNarrationVoice] = useState(false);
  const [bgUpdating, setBgUpdating] = useState(false);   // 回合背景图重生成中（保留旧图）
  const bgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // done 回调里延时刷新的计时器：卸载时清理
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    AsyncStorage.getItem(NARRATION_VOICE_KEY)
      .then((value) => setNarrationVoice(value === "1"))
      .catch(() => {});
  }, []);

  const loadScene = async (): Promise<SceneDetail | null> => {
    if (!sceneId) return null;
    try {
      const s = await getScene(sceneId);
      setScene(s);
      setError("");
      return s;
    } catch (err) {
      setError((err as any)?.message ?? "加载场景失败");
      return null;
    }
  };

  useEffect(() => { loadScene(); }, [sceneId]);

  const stopBgPoll = () => {
    if (bgPollRef.current) { clearInterval(bgPollRef.current); bgPollRef.current = null; }
    setBgUpdating(false);
  };

  // 推进后背景图由后端异步重生成：轮询直到 bg_image 变化（约 8s 一次，最多 4 次）
  const startBgPoll = (knownBg: string | null) => {
    if (!sceneId) return;
    stopBgPoll();
    setBgUpdating(true);
    let tries = 0;
    bgPollRef.current = setInterval(async () => {
      tries += 1;
      try {
        const s = await getScene(sceneId);
        const nextBg: string | null = s?.bg_image ?? null;
        if (nextBg && nextBg !== knownBg) {
          setScene(s);
          stopBgPoll();
        } else if (tries >= 4) {
          stopBgPoll();
        }
      } catch {
        if (tries >= 4) stopBgPoll();
      }
    }, 8000);
  };

  // 卸载时清理轮询与延时计时器
  useEffect(() => () => {
    stopBgPoll();
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
  }, [sceneId]);

  const speakers = new Set((scene?.beats ?? []).map(b => b.speaker).filter(s => s && s !== "旁白"));
  const charName = speakers.size > 0 ? Array.from(speakers)[0] : (scene?.title ?? "TA");
  const isDynamic = scene?.render_kind === "dynamic_image";
  // 生成式 3D：后端下发 scene_spec，前端 assembleScene 拼装低多边形场景
  const genSpec = scene?.render_kind === "generated_3d" ? scene?.scene_spec ?? null : null;
  const bgImageUrl = isDynamic ? absUrl(scene?.bg_image) : null;
  const spriteUrl = isDynamic ? absUrl(scene?.characters?.[0]?.sprite_url) : null;
  const spriteCharName = scene?.characters?.[0]?.name;
  // theater 优先用后端下发的 theater_id，其次 props，最后兜底 dining
  const effectiveTheater = ((scene?.theater_id as TheaterSceneId | undefined) ?? theater ?? "dining");
  const sceneName = scene?.title ?? "片场";
  const latestBeat = scene?.beats?.[scene.beats.length - 1];
  const isStreaming = phase === "busy" && streamText.length > 0;
  const isSpeaking = isStreaming || ((phase === "playing" || phase === "closure" || phase === "ending") && latestBeat?.speaker === "旁白");
  // 打字机：SSE token 与整段 beat（含开场白）都逐字浮现；reduced motion 直接全量
  const rawSubtitle = isStreaming ? streamText : (latestBeat?.text ?? "……");
  const typedSubtitle = useTypewriter(rawSubtitle, reducedMotion);
  const narrationText = (phase === "playing" || phase === "closure" || phase === "ending") && latestBeat?.speaker === "旁白"
    ? (latestBeat.text ?? "").trim()
    : "";

  // 只朗读已经定稿的旁白；SSE 仍在逐 token 生成时不反复请求 TTS。
  useEffect(() => {
    if (!narrationVoice || !narrationText) {
      stopSpeaking();
      return;
    }
    speakReply(narrationText);
    return stopSpeaking;
  }, [narrationText, narrationVoice]);

  const toggleNarrationVoice = () => {
    setNarrationVoice((previous) => {
      const next = !previous;
      AsyncStorage.setItem(NARRATION_VOICE_KEY, next ? "1" : "0").catch(() => {});
      if (!next) stopSpeaking();
      return next;
    });
  };

  // 推进剧情的公共 SSE 回调：token 先入缓冲（打字机按节奏显示），done 时刷新场景 / 结束。
  const advanceCb = (e: SSEEvent) => {
    if (e.event === "token" && e.data?.delta) setStreamText(t => t + e.data.delta);
    if (e.event === "done") {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => {
        loadScene().then((s) => {
          setStreamText("");
          const nextPhase = getSceneAdvancePhase(e.data);
          if (nextPhase === "ending") {
            stopBgPoll();
            setPhase("ending");
          } else if (nextPhase === "closure") {
            setPhase("closure");
          } else {
            setPhase("playing");
            // galgame 场景：后台重生成背景，轮询等新图就绪后平滑切换
            if (s?.render_kind === "dynamic_image") startBgPoll(s.bg_image ?? null);
          }
        });
      }, 100);
    }
  };

  const handleChoice = (choice: SceneChoice) => {
    if (!sceneId || phase === "busy") return;
    setPhase("busy");
    setStreamText("");
    streamSceneChoice(sceneId, choice.id, advanceCb).catch((err) => {
      setPhase("playing");
      setError((err as any)?.message ?? "推进失败，请重试");
    });
  };

  // 「自己说」：提交用户自由输入，作为一次回应推进剧情。
  const handleCustom = () => {
    const text = customText.trim();
    if (!sceneId || phase === "busy" || !text) return;
    setShowCustom(false);
    setCustomText("");
    setPhase("busy");
    setStreamText("");
    streamSceneCustom(sceneId, text, advanceCb).catch((err) => {
      setPhase("playing");
      setError((err as any)?.message ?? "推进失败，请重试");
    });
  };

  const handleCalibrate = async () => {
    if (!sceneId || !adjustInput.trim()) return;
    try {
      await calibrateScene(sceneId, charName, adjustInput.trim());
      setAdjustInput("");
      setShowAdjust(false);
      setPhase("playing");
      await loadScene();
    } catch (err) {
      setError((err as any)?.message ?? "校准失败");
    }
  };

  if (!scene) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 15, color: paperColors.sub2 }}>正在进入场景…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* 场景背景：动态 galgame 用背景图（随回合更新，crossfade 切换）；生成式 3D 用 SceneSpec 拼装；否则预置 3D 舞台 */}
      {isDynamic ? (
        <DynamicBackground url={bgImageUrl} reducedMotion={reducedMotion} />
      ) : genSpec ? (
        <Scene3D spec={genSpec} />
      ) : (
        <Scene3D sceneId={effectiveTheater} />
      )}

      {/* Top bar */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 52, paddingBottom: 16, zIndex: 10 }}>
        <Pressable onPress={() => (phase === "playing" || phase === "paused") && setPhase(phase === "paused" ? "playing" : "paused")}
          disabled={phase !== "playing" && phase !== "paused"}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
            backgroundColor: "rgba(255,252,245,0.28)", borderWidth: 1, borderColor: "rgba(255,255,255,0.38)",
            opacity: phase === "playing" || phase === "paused" ? 1 : 0.55,
          }}>
          {phase === "paused" ? <Play size={12} color="rgba(255,255,255,0.82)" /> : <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.82)" }}>⏸</Text>}
          <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.82)" }}>
            {phase === "ending" ? "已结束" : phase === "closure" ? "已暂停" : phase === "paused" ? "继续" : "暂停"}
          </Text>
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 13, fontWeight: "500", color: "rgba(255,255,255,0.9)" }}>{sceneName}</Text>
          <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{charName}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => (phase === "playing" || phase === "paused") && setShowAdjust(true)}
            disabled={phase !== "playing" && phase !== "paused"}
            style={{
              paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
              backgroundColor: "rgba(255,252,245,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
              opacity: phase === "playing" || phase === "paused" ? 1 : 0.4,
            }}>
            <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.65)" }}>TA不太像</Text>
          </Pressable>
          <Pressable onPress={onEnd}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
              backgroundColor: "rgba(255,252,245,0.22)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)",
            }}>
            <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>离开</Text>
          </Pressable>
        </View>
      </View>

      {/* Character（box-none：空白区手势穿透到底层 Scene3D，可拖动转视角；角色/按钮本身仍可点）
          始终占中间 flex:1 把底部字幕推到屏幕下方；仅动态 galgame 有立绘时才画人物，
          预置 3D 舞台交给场景本身表现（空容器手势穿透到 Scene3D）。 */}
      <View pointerEvents="box-none" style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 16, zIndex: spriteUrl ? 10 : 1 }}>
        {spriteUrl && (
          <CharacterArtwork name={spriteCharName || charName} isSpeaking={isSpeaking} isListening={false} spriteUrl={spriteUrl} />
        )}
      </View>

      {/* playing / busy：电影字幕层（半透明渐变，尽量露出背后的 3D 舞台） */}
      {(phase === "playing" || phase === "busy" || phase === "closure" || phase === "ending") && (
        <LinearGradient
          colors={["transparent", "rgba(20,14,10,0.25)", "rgba(20,14,10,0.55)"]}
          style={{ paddingTop: 72, paddingHorizontal: 16, paddingBottom: 14, zIndex: 10 }}>
          {/* 旁白 / 对白：限高，可下拉滚动看全文 */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: "500", color: "#E8C877" }}>
              {isStreaming ? "旁白" : (latestBeat?.speaker || charName)}
            </Text>
            {isSpeaking && (
              <View style={{ flexDirection: "row", gap: 2, alignItems: "flex-end", height: 12 }}>
                {[1, 2, 3].map(j => (
                  <View key={j} style={{ width: 2, height: 4 + j * 3, backgroundColor: "rgba(232,200,119,0.7)", borderRadius: 1 }} />
                ))}
              </View>
            )}
            {(isStreaming || latestBeat?.speaker === "旁白") && (
              <Pressable
                accessibilityLabel={narrationVoice ? "关闭旁白语音" : "开启旁白语音"}
                accessibilityRole="switch"
                accessibilityState={{ checked: narrationVoice }}
                onPress={toggleNarrationVoice}
                style={({ pressed }) => ({
                  marginLeft: "auto",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: narrationVoice
                    ? "rgba(246,231,168,0.24)"
                    : "rgba(255,255,255,0.10)",
                  borderWidth: 1,
                  borderColor: narrationVoice
                    ? "rgba(232,200,119,0.52)"
                    : "rgba(255,255,255,0.22)",
                  opacity: pressed ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                {narrationVoice
                  ? <Volume2 size={13} color="#E8C877" />
                  : <VolumeX size={13} color="rgba(255,255,255,0.68)" />}
                <Text style={{
                  fontSize: 11,
                  color: narrationVoice ? "#E8C877" : "rgba(255,255,255,0.68)",
                }}>
                  旁白语音
                </Text>
              </Pressable>
            )}
          </View>
          <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled showsVerticalScrollIndicator={true}>
            <Text style={{ fontSize: 15, lineHeight: 24, color: "rgba(255,255,255,0.95)" }}>
              {typedSubtitle}
            </Text>
          </ScrollView>
          {bgUpdating && (
            <Text style={{ fontSize: 11, marginTop: 6, color: "rgba(255,255,255,0.55)" }}>画面更新中…</Text>
          )}

          {phase === "playing" && (
            <View style={{ marginTop: 12, gap: 8 }}>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.68)", marginBottom: 2 }}>
                你想怎么回应？
              </Text>
              {(scene?.choices ?? []).map(choice => (
                <Pressable key={choice.id} onPress={() => handleChoice(choice)}
                  style={({ pressed }) => ({
                    paddingVertical: 11, paddingHorizontal: 15, borderRadius: 16,
                    backgroundColor: "rgba(255,252,245,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.24)",
                    opacity: pressed ? 0.7 : 1,
                  })}>
                  <Text style={{ fontSize: 13, lineHeight: 19, color: "#FFFFFF" }}>{choice.label}</Text>
                </Pressable>
              ))}
              {/* 第三项：自己说（与预设选项同等视觉权重） */}
              {!showCustom ? (
                <Pressable onPress={() => setShowCustom(true)}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 7,
                    paddingVertical: 11, paddingHorizontal: 15, borderRadius: 16,
                    borderWidth: 1, borderColor: "rgba(255,255,255,0.24)",
                    backgroundColor: "rgba(246,231,168,0.14)",
                  }}>
                  <Edit3 size={13} color="rgba(255,255,255,0.78)" />
                  <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.82)" }}>自己说……</Text>
                </Pressable>
              ) : (
                <View style={{
                  flexDirection: "row", alignItems: "center", gap: 8,
                  paddingLeft: 15, paddingRight: 6, paddingVertical: 6, borderRadius: 24,
                  backgroundColor: "rgba(255,252,245,0.95)", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)",
                }}>
                  <TextInput
                    value={customText} onChangeText={setCustomText} autoFocus
                    placeholder="说点你自己想说的…" placeholderTextColor={paperColors.dim}
                    onSubmitEditing={handleCustom} returnKeyType="send"
                    style={{ flex: 1, fontSize: 14, color: paperColors.ink, paddingVertical: 6 }} />
                  <Pressable onPress={handleCustom}
                    style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accentSurface }}>
                    <Send size={15} color={theme.colors.textOnAccent} />
                  </Pressable>
                </View>
              )}
              <Pressable onPress={onEnd} style={{ paddingVertical: 6, alignItems: "center" }}>
                <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.68)" }}>到这里就好</Text>
              </Pressable>
            </View>
          )}

          {phase === "busy" && (
            <View style={{ paddingTop: 12, alignItems: "center" }}>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>正在继续…</Text>
            </View>
          )}

          {(phase === "closure" || phase === "ending") && (
            <View style={{ paddingTop: 14, gap: 10 }}>
              <Text style={{ fontSize: 13, lineHeight: 20, textAlign: "center", color: "rgba(255,255,255,0.78)" }}>
                {phase === "closure" ? "好像已经说到这里了。要把这一幕停在这里吗？" : "这一幕在这里停下了"}
              </Text>
              <Pressable onPress={onEnd}
                style={({ pressed }) => ({
                  paddingVertical: 12,
                  borderRadius: 999,
                  alignItems: "center",
                  backgroundColor: "rgba(246,231,168,0.88)",
                  opacity: pressed ? 0.78 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}>
                <Text style={{ fontSize: 14, fontWeight: "500", color: paperColors.ink2 }}>回顾刚才的回应</Text>
              </Pressable>
              {phase === "closure" && (
                <Pressable onPress={() => setPhase("playing")}
                  style={({ pressed }) => ({
                    paddingVertical: 10,
                    alignItems: "center",
                    opacity: pressed ? 0.65 : 1,
                  })}>
                  <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.78)" }}>我还想再说一句</Text>
                </Pressable>
              )}
            </View>
          )}
        </LinearGradient>
      )}

      {/* intro / paused：控制白面板（设置类界面，保留可读性好的实底） */}
      {(phase === "intro" || phase === "paused") && (
        <View style={{
          marginHorizontal: 12, marginBottom: 16, borderRadius: 28, overflow: "hidden", zIndex: 10,
          backgroundColor: "rgba(255,252,245,0.88)", borderWidth: 1, borderColor: "rgba(255,255,255,0.55)",
        }}>
          {phase === "intro" && (
            <View style={{ padding: 20 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Text style={{ fontSize: 14 }}>🌿</Text>
                <Text style={{ fontSize: 12, color: paperColors.dim }}>米露</Text>
              </View>
              <Text style={{ fontSize: 14, lineHeight: 22, marginBottom: 16, color: paperColors.ink }}>
                场景准备好了。你可以随时离开，这里没有对错。
              </Text>
              <Pressable onPress={() => setPhase("playing")}
                style={{ paddingVertical: 12, borderRadius: 999, alignItems: "center", backgroundColor: "rgba(246,231,168,0.82)" }}>
                <Text style={{ fontSize: 14, fontWeight: "500", color: paperColors.ink2 }}>好的，开始</Text>
              </Pressable>
            </View>
          )}

        {phase === "paused" && (
          <View style={{ padding: 20 }}>
            <Text style={{ fontSize: 14, fontWeight: "500", marginBottom: 16, color: paperColors.ink }}>已暂停</Text>
            {!!error && (
              <Text style={{ fontSize: 12, textAlign: "center", marginBottom: 12, color: "#A26458" }}>{error}</Text>
            )}
            {!showAdjust ? (
              <View style={{ gap: 8 }}>
                <Pressable onPress={() => setPhase("playing")}
                  style={{ paddingVertical: 12, borderRadius: 999, alignItems: "center", backgroundColor: "rgba(246,231,168,0.82)" }}>
                  <Text style={{ fontSize: 14, fontWeight: "500", color: paperColors.ink2 }}>继续场景</Text>
                </Pressable>
                <Pressable onPress={() => setShowAdjust(true)}
                  style={{
                    paddingVertical: 12, borderRadius: 999, alignItems: "center",
                    backgroundColor: "rgba(255,252,245,0.65)", borderWidth: 1, borderColor: "rgba(255,255,255,0.45)",
                  }}>
                  <Text style={{ fontSize: 14, color: paperColors.sub }}>TA 不太像</Text>
                </Pressable>
                <Pressable onPress={onEnd} style={{ paddingVertical: 8, alignItems: "center" }}>
                  <Text style={{ fontSize: 13, color: paperColors.dim }}>到这里就好</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 13, color: paperColors.sub2 }}>补充一句，比如"她不会这么快原谅我。"</Text>
                <TextInput
                  value={adjustInput} onChangeText={setAdjustInput}
                  placeholder="她其实更固执一点…" placeholderTextColor={paperColors.dim} autoFocus
                  style={{
                    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, fontSize: 14,
                    backgroundColor: "rgba(255,252,245,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", color: paperColors.ink,
                  }}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => setShowAdjust(false)}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 999, alignItems: "center", backgroundColor: "rgba(255,252,245,0.65)" }}>
                    <Text style={{ fontSize: 13, color: paperColors.sub }}>取消</Text>
                  </Pressable>
                  <Pressable onPress={handleCalibrate}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 999, alignItems: "center", backgroundColor: "rgba(246,231,168,0.82)" }}>
                    <Text style={{ fontSize: 13, fontWeight: "500", color: paperColors.ink2 }}>调整后继续</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
      )}
    </View>
  );
}
