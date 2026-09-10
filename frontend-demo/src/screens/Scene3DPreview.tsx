/**
 * 生成式 3D 场景预览屏（?screen=scene3d-preview）。
 *
 * 开发/验收用，不参与正式业务流程。两种模式：
 *  - 样例：SCENE_SAMPLES 的手写绝对坐标 SceneSpec，回归验证渲染与相机；
 *  - 关系：layout/fixtures.ts 的关系版夹具 → solveLayout 现场解算 → 渲染，
 *    同时展示解算/校验报告；支持粘贴任意 SemanticSceneSpec JSON 快速试错。
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Scene3D } from "./Scene3D";
import { assembleAnySpec, SCENE_SAMPLES, SEMANTIC_FIXTURES } from "../theater";
import type { LayoutReport, SceneSpec, SemanticSceneSpec } from "../theater";

const ABS_KEYS = Object.keys(SCENE_SAMPLES);
const FIX_KEYS = Object.keys(SEMANTIC_FIXTURES);

type Mode = "abs" | "sem" | "paste";

export function Scene3DPreview() {
  const [mode, setMode] = useState<Mode>("sem");
  const [absKey, setAbsKey] = useState(ABS_KEYS[0]);
  const [fixKey, setFixKey] = useState(FIX_KEYS[0]);
  const [pasteText, setPasteText] = useState("");
  const [pasteParsed, setPasteParsed] = useState<SemanticSceneSpec | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const input: unknown = mode === "abs"
    ? SCENE_SAMPLES[absKey]
    : mode === "sem"
      ? SEMANTIC_FIXTURES[fixKey]
      : pasteParsed;

  // 每次输入变化都现场解算一次，取报告展示（渲染复用 Scene3D 内部的 assembleAnySpec）
  const report = useMemo<LayoutReport | null>(() => {
    if (mode === "paste" && !pasteParsed) return null;
    if (!input) return null;
    try {
      return assembleAnySpec(input).layoutReport ?? null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const applyPaste = () => {
    try {
      const obj = JSON.parse(pasteText);
      setPasteError(null);
      setPasteParsed(obj as SemanticSceneSpec);
    } catch (e) {
      setPasteError(String(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Scene3D spec={(input as SceneSpec) ?? undefined} />

      {/* 顶部第一行：模式切换 */}
      <View style={ROW_STYLE}>
        {(["abs", "sem", "paste"] as const).map((m) => pill(
          m === "abs" ? "样例·绝对坐标" : m === "sem" ? "关系版夹具" : "粘贴语义 JSON",
          mode === m, () => setMode(m),
        ))}
      </View>

      {/* 第二行：对应清单切换 */}
      {mode !== "paste" && (
        <ScrollView horizontal style={{ position: "absolute", top: 92 }} contentContainerStyle={ROW_INNER}>
          {(mode === "abs" ? ABS_KEYS : FIX_KEYS).map((k) =>
            pill(k, (mode === "abs" ? absKey : fixKey) === k,
              () => (mode === "abs" ? setAbsKey(k) : setFixKey(k))))}
        </ScrollView>
      )}

      {/* 粘贴模式输入区 */}
      {mode === "paste" && (
        <View style={{ position: "absolute", top: 92, left: 16, right: 16 }}>
          <TextInput
            value={pasteText}
            onChangeText={setPasteText}
            placeholder='{"kind":"semantic","env":{...},"props":[...],"characters":[...]}'
            placeholderTextColor="rgba(255,255,255,0.35)"
            multiline
            style={{
              backgroundColor: "rgba(20,24,32,0.72)", borderRadius: 12, borderWidth: 1,
              borderColor: "rgba(255,255,255,0.2)", color: "#f0ead8", fontSize: 12,
              padding: 10, maxHeight: 140, fontFamily: "monospace",
            }}
          />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Pressable onPress={applyPaste} style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
              backgroundColor: "rgba(246,231,168,0.9)",
            }}>
              <Text style={{ color: "#463f3c", fontWeight: "600", fontSize: 13 }}>解算</Text>
            </Pressable>
            {pasteError && <Text style={{ color: "#ff9a8a", fontSize: 12, alignSelf: "center" }}>{pasteError}</Text>}
          </View>
        </View>
      )}

      {/* 底部：解算报告 + 手势提示 */}
      <View style={{ position: "absolute", bottom: 24, left: 16, right: 16, maxHeight: 150 }}>
        {report && (
          <ScrollView style={{ opacity: 0.85 }}>
            <Text style={repText}>
              {report.fixes.map((s) => `✓ ${s}`).join("\n")}
              {report.fixes.length && report.warnings.length ? "\n" : ""}
              {report.warnings.map((s) => `⚠ ${s}`).join("\n")}
            </Text>
          </ScrollView>
        )}
        <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center", marginTop: 4 }}>
          单指拖动转视角 · 双指捏合缩放
        </Text>
      </View>
    </View>
  );
}

const ROW_STYLE: React.ComponentProps<typeof View>["style"] = {
  position: "absolute", top: 44, left: 0, right: 0,
  flexDirection: "row", gap: 8, paddingHorizontal: 16, justifyContent: "center",
};
const ROW_INNER: React.ComponentProps<typeof View>["style"] = {
  flexDirection: "row", gap: 8, alignItems: "center",
};

function pill(label: string, on: boolean, onPress: () => void) {
  return (
    <Pressable key={label} onPress={onPress} style={{
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
      backgroundColor: on ? "rgba(246,231,168,0.92)" : "rgba(20,24,32,0.55)",
      borderWidth: 1, borderColor: on ? "rgba(196,149,58,0.5)" : "rgba(255,255,255,0.25)",
    }}>
      <Text style={{ fontSize: 13, fontWeight: on ? "600" : "400", color: on ? "#463f3c" : "rgba(255,255,255,0.85)" }}>{label}</Text>
    </Pressable>
  );
}

const repText = { color: "rgba(255,255,255,0.75)", fontSize: 11, lineHeight: 15 };
