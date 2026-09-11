/**
 * 片场模块公共：主题映射 hook、返回头、内置场景数据、子状态与场景详情类型。
 */
import React from "react";
import { Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { IconButton, useTheme } from "../../design-system";
import type { SceneSpec, TheaterSceneId } from "../../theater";

/** 片场内部沿用的紧凑色名（C.*）+ night 标记。 */
export function useSceneSurface() {
  const theme = useTheme();
  return {
    theme,
    night: theme.isNight,
    C: {
      text: theme.colors.textPrimary,
      text2: theme.colors.textSecondary,
      muted: theme.colors.textMuted,
      placeholder: theme.colors.placeholder,
    },
  };
}

/** 片场各步骤统一返回头（返回按钮 + 标题）。 */
export function SceneHeader({ onBack, title }: { onBack: () => void; title: string }) {
  const theme = useTheme();
  return (
    <View style={{ minHeight: 68, paddingHorizontal: theme.spacing[5], flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
      <IconButton accessibilityLabel="返回" icon={<ChevronLeft color={theme.colors.textSecondary} size={20} />} onPress={onBack} />
      <Text style={[theme.typography.textStyles.sectionTitle, { color: theme.colors.textPrimary }]}>{title}</Text>
    </View>
  );
}

// ─── 剧场幕布外壳（方案 A「沉浸剧场幕布式」）─────────────────────────────

/**
 * 幕布专用色：候场暗场（暖墨 + 帷幕 + 铜金）属特殊场景色，按 tokens.ts
 * 约定不放进主题 token，局部 const 声明即可（同 BUILT_IN_SCENES 的素材色）。
 */
export const CURTAIN_COLORS = {
  gold: "#C9A75A",          // 铜金（暗场高光）
  soft: "rgba(201,167,90,0.28)",
  stage: "#2B2520",         // 候场暖墨底
  stage2: "#38302A",        // 暖墨变体
  curtain: "#4E3E2C",       // 帷幕深棕
  curtainHi: "#6B5739",     // 帷幕亮纹
  lampOk: "#F0D477",        // 备场灯已就位
  lampIng: "#F0D477",       // 备场灯进行中
  lampWait: "#5A4E40",      // 备场灯未到
  narrText: "#F3ECDD",      // 候场旁白
  narrHint: "rgba(243,236,221,0.55)",
} as const;

const ACT_NAMES = ["第一幕 · 讲述", "第二幕 · 回顾", "第三幕 · 定妆"] as const;

/** 幕檐：金色半圆波纹带，剧场的签名元素（暗场用铜金）。 */
function ActValance({ dark }: { dark: boolean }) {
  const theme = useTheme();
  const color = dark ? CURTAIN_COLORS.gold : theme.colors.accentSurface;
  // 一排半圆凸起，超出部分被容器裁掉，形成波纹檐；数量取足，余量靠 overflow 吃掉
  return (
    <View style={{ height: 14, alignSelf: "stretch", overflow: "hidden" }}>
      <View style={{ position: "absolute", top: 8, left: 0, right: 0, height: 6, backgroundColor: color }} />
      <View style={{ flexDirection: "row", overflow: "hidden" }}>
        {Array.from({ length: 48 }).map((_, i) => (
          <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color, marginRight: 12 }} />
        ))}
      </View>
    </View>
  );
}

/**
 * 幕位指示：第几幕 + 三颗幕位灯（done / on / 待），替代百分比进度。
 * 浅色幕檐用主题 token；dark 变体供候场暗场使用（铜金 + 暖墨）。
 */
export function ActBar({ stage, onBack, dark = false, title, allDone = false }: {
  stage: number;             // 0 第一幕 / 1 第二幕 / 2 第三幕
  onBack?: () => void;
  dark?: boolean;
  /** 覆盖默认幕名（候场用「幕间 · 候场」）。 */
  title?: string;
  /** 三颗幕位灯全部置为 done（候场：三幕都已演完）。 */
  allDone?: boolean;
}) {
  const theme = useTheme();
  const gold = dark ? CURTAIN_COLORS.gold : theme.colors.accent;
  const onDot = dark ? CURTAIN_COLORS.lampOk : theme.colors.accentSurface;
  const doneDot = dark ? "#7A6A4E" : theme.colors.accentSoft;
  const waitDot = dark ? CURTAIN_COLORS.lampWait : theme.colors.border;
  const name = title ?? ACT_NAMES[stage] ?? ACT_NAMES[0];

  return (
    <View style={{ flexShrink: 0 }}>
      {dark ? <ActValance dark /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: theme.spacing[4], borderBottomWidth: dark ? 0 : 1, borderBottomColor: theme.colors.divider }}>
        <View style={{ width: 40, paddingLeft: theme.spacing[2] }}>
          {onBack ? (
            <IconButton accessibilityLabel="返回" icon={<ChevronLeft color={theme.colors.textSecondary} size={20} />} onPress={onBack} />
          ) : null}
        </View>
        <View style={{ flex: 1, alignItems: "center", gap: 7 }}>
          <Text style={{
            fontSize: 13, fontWeight: "500",
            color: dark ? gold : theme.colors.textSecondary,
          }}>
            {name}
          </Text>
          <View style={{ flexDirection: "row", gap: 5, alignItems: "center", minHeight: 6 }}>
            {[0, 1, 2].map((i) => {
              const isOn = !allDone && i === stage;
              const isDone = allDone || i < stage;
              return (
                <View key={i} style={{
                  width: isOn ? 15 : 5, height: 5, borderRadius: 3,
                  backgroundColor: isDone ? doneDot : isOn ? onDot : waitDot,
                }} />
              );
            })}
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>
    </View>
  );
}

// ─── 内置场景数据 ────────────────────────────────────────────────────────────

export interface BuiltInScene {
  id: string; title: string; desc: string;
  relationships: string[]; colors: [string, string, ...string[]];
  ambientColor: string; ambientColor2: string;
  /** 进入演练时，ScenePlay 背景挂载的 theater 3D 场景。 */
  theater: TheaterSceneId;
}

export const BUILT_IN_SCENES: BuiltInScene[] = [
  {
    id: "night-call", title: "深夜通话",
    desc: "有些话，隔着一通电话才说得出口。",
    relationships: ["恋人", "朋友", "异地家人"],
    colors: ["#261A10", "#3A2618", "#4D3828", "#5C4838"],
    ambientColor: "rgba(255,148,48,0.18)", ambientColor2: "rgba(255,200,100,0.10)",
    theater: "bedroom",
  },
  {
    id: "dinner-table", title: "家中餐桌",
    desc: "最难说出口的话，常常发生在最熟悉的地方。",
    relationships: ["父母", "家庭", "伴侣"],
    colors: ["#F5ECD8", "#EDD9BE", "#E2C9A0"],
    ambientColor: "rgba(255,195,60,0.38)", ambientColor2: "rgba(255,230,140,0.22)",
    theater: "dining",
  },
  {
    id: "leaving-road", title: "离开的路上",
    desc: "有些告别，也许还来得及换一种说法。",
    relationships: ["恋人", "朋友", "同学", "同事"],
    colors: ["#E8D5C0", "#D9C09E", "#C8A882", "#B89878"],
    ambientColor: "rgba(255,175,70,0.32)", ambientColor2: "rgba(240,200,130,0.18)",
    theater: "station",
  },
];

// 后端模板没有环境光字段，按 id 补默认值（本地卡片渲染用）
export const _AMBIENT: Record<string, { ambientColor: string; ambientColor2: string }> = {
  "night-call": { ambientColor: "rgba(255,148,48,0.18)", ambientColor2: "rgba(255,200,100,0.10)" },
  "dinner-table": { ambientColor: "rgba(255,195,60,0.38)", ambientColor2: "rgba(255,230,140,0.22)" },
  "leaving-road": { ambientColor: "rgba(255,175,70,0.32)", ambientColor2: "rgba(240,200,130,0.18)" },
};
export const _AMBIENT_DEFAULT = { ambientColor: "rgba(255,195,60,0.25)", ambientColor2: "rgba(255,230,140,0.15)" };

export type SceneSubState = "browsing" | "capturing" | "reviewing" | "setup";

/** 角色设定三步的产物。失败重试时原样复用，避免用户重新填一遍。 */
export interface CharReady {
  name: string;
  relation: string;
  desc: string;
  adjusted: string;
  traits: string[];
  /** 渲染方式：generated_3d 生成式 3D / dynamic_image 图片 galgame。 */
  renderKind: "generated_3d" | "dynamic_image";
}

// ─── 场景详情类型（ScenePlay / SceneEnd 共用）─────────────────────────────────

export interface SceneBeat { speaker: string; text: string; }
export interface SceneChoice { id: string; label: string; }
export interface SceneCharacter { name: string; sprite_url: string | null; }
export interface SceneDetail {
  id: number; title: string; status: string; setting: string;
  beats: SceneBeat[] | null; choices: SceneChoice[] | null;
  history: any[] | null; turn: number;
  render_kind?: string | null;
  theater_id?: string | null;
  bg_image?: string | null;
  characters?: SceneCharacter[] | null;
  scene_spec?: SceneSpec | null;   // generated_3d：前端 Scene3D 据此拼装
}
