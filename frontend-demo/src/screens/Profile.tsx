/**
 * 我的模块（ProfileScreen / PetChange / PetHandoff）。
 * 设置接 /api/v1/preferences；记忆管理接 /api/v1/memories 与 /api/v1/memory-review。
 */
import React, { useEffect, useRef, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import {
  Archive, Bell, Check, ChevronRight, Clock, Layers, LogOut, Moon, Shield, Trash2, Type,
} from "lucide-react-native";
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  IconButton,
  ListItem,
  LoadingState,
  PageContainer,
  PageHeader,
  useResponsive,
  useTheme,
} from "../design-system";
import { clearMemories, deleteMemory, getMemoryReview, listMemories } from "../api";
import { CURRENT_VERSION } from "../updateCheck";
import { getPetAvatar } from "../pets/assets";

function useProfileSurface() {
  const theme = useTheme();
  return {
    theme,
    night: theme.isNight,
    C: {
      text: theme.colors.textPrimary,
      text2: theme.colors.textSecondary,
      muted: theme.colors.textMuted,
      chevron: theme.colors.textMuted,
      rowDivider: theme.colors.divider,
    },
  };
}

function ProfileHeader({ onBack, title, action }: { onBack: () => void; title: string; action?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ minHeight: 68, paddingHorizontal: theme.spacing[5], flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
      <IconButton accessibilityLabel="返回" icon={<ChevronRight color={theme.colors.textSecondary} size={20} style={{ transform: [{ rotate: "180deg" }] }} />} onPress={onBack} />
      <Text style={[theme.typography.textStyles.sectionTitle, { flex: 1, color: theme.colors.textPrimary }]}>{title}</Text>
      {action}
    </View>
  );
}

export type Preferences = {
  proactive_enabled: boolean;
  proactive_frequency: "安静" | "温和" | "活跃" | string;
  sleep_reminder_time: string;
  keep_raw_dump: boolean;
  ephemeral_ttl_days: number;
  font_size: "小" | "标准" | "大" | string;
  companion_tone: string;
  reduce_transparency: boolean;
  profile_learning_enabled: boolean;
};

// ─── 睡前提醒 · 双列滚轮时间选择器（零依赖：自制 ScrollView + snap）─────────────
const WHEEL_ITEM_H = 44;
const WHEEL_VISIBLE = 5;
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")); // 5 分钟步进

function WheelColumn({ data, index, onChange, night }: {
  data: string[]; index: number; onChange: (i: number) => void; night: boolean;
}) {
  const ref = useRef<ScrollView>(null);
  const [active, setActive] = useState(index);
  useEffect(() => {
    // 初次挂载滚到选中行（延迟等布局完成）
    const t = setTimeout(() => ref.current?.scrollTo({ y: index * WHEEL_ITEM_H, animated: false }), 10);
    return () => clearTimeout(t);
  }, []);
  const pick = (y: number) => Math.max(0, Math.min(data.length - 1, Math.round(y / WHEEL_ITEM_H)));
  return (
    <View style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE, width: 78 }}>
      <ScrollView
        ref={ref} showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_H} decelerationRate="fast" scrollEventThrottle={16}
        onScroll={(e) => setActive(pick(e.nativeEvent.contentOffset.y))}
        onScrollEndDrag={(e) => onChange(pick(e.nativeEvent.contentOffset.y))}
        onMomentumScrollEnd={(e) => { const i = pick(e.nativeEvent.contentOffset.y); setActive(i); onChange(i); }}
        contentContainerStyle={{ paddingVertical: WHEEL_ITEM_H * 2 }}>
        {data.map((v, i) => (
          <View key={i} style={{ height: WHEEL_ITEM_H, alignItems: "center", justifyContent: "center" }}>
            <Text style={{
              fontSize: 26, fontVariant: ["tabular-nums"],
              color: i === active ? (night ? "#EFE6D2" : "#3B3428") : (night ? "#97896E" : "#B8AD99"),
              fontWeight: i === active ? "600" : "400",
            }}>{v}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function TimePickerSheet({ visible, initial, night, onCancel, onConfirm }: {
  visible: boolean; initial: string; night: boolean; onCancel: () => void; onConfirm: (t: string) => void;
}) {
  const [h, setH] = useState(22);
  const [m, setM] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const [hh, mm] = (initial || "22:00").split(":").map((x) => parseInt(x, 10));
    setH(Number.isFinite(hh) ? Math.max(0, Math.min(23, hh)) : 22);
    setM(Number.isFinite(mm) ? (Math.round((mm % 60) / 5) % 12) : 0);
  }, [visible]);
  const bg = night ? "#332B22" : "#FCF8EE";
  const txt = night ? "#EFE6D2" : "#3B3428";
  const sub = night ? "#97896E" : "#9C907C";
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(30,22,12,0.35)" }} onPress={onCancel} />
      <View style={{ backgroundColor: bg, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34 }}>
        <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: "rgba(150,140,130,0.3)", alignSelf: "center", marginBottom: 14 }} />
        <Text style={{ fontSize: 16, fontWeight: "600", textAlign: "center", color: txt }}>睡前提醒</Text>
        <Text style={{ fontSize: 12, textAlign: "center", color: sub, marginTop: 3, marginBottom: 14 }}>到点了我会轻声提醒你，该歇一歇了</Text>
        <View style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <View pointerEvents="none" style={{
            position: "absolute", left: 24, right: 24, height: WHEEL_ITEM_H, top: (WHEEL_ITEM_H * (WHEEL_VISIBLE - 1)) / 2,
            borderRadius: 14, backgroundColor: "rgba(216,169,78,0.14)", borderWidth: 1, borderColor: "rgba(216,169,78,0.35)",
          }} />
          <WheelColumn data={HOURS} index={h} onChange={setH} night={night} />
          <Text style={{ fontSize: 26, fontWeight: "600", color: txt }}>:</Text>
          <WheelColumn data={MINS} index={m} onChange={setM} night={night} />
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <Pressable onPress={onCancel} style={{ flex: 1, paddingVertical: 13, borderRadius: 999, alignItems: "center", backgroundColor: "rgba(140,125,114,0.12)" }}>
            <Text style={{ fontSize: 14, color: sub }}>取消</Text>
          </Pressable>
          <Pressable onPress={() => onConfirm(`${HOURS[h]}:${MINS[m]}`)}
            style={{ flex: 1, paddingVertical: 13, borderRadius: 999, alignItems: "center", backgroundColor: "rgba(216,169,78,0.9)" }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#2A2114" }}>保存 {HOURS[h]}:{MINS[m]}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function ProfileScreen({
  onChangePet, night, onNightToggle, petName, petEmoji, petPresetId, petSummary,
  onMemory, onMemoryReview, preferences, onSetPreference, onLogout,
  onUserProfile,
}: {
  onChangePet: () => void; night: boolean; onNightToggle: () => void;
  petName: string; petEmoji: string; petPresetId?: string | null; petSummary?: string;
  onMemory: () => void; onMemoryReview: () => void;
  onUserProfile: () => void;
  preferences: Preferences;
  onSetPreference: (patch: Partial<Preferences>) => void;
  onLogout?: () => void;
}) {
  const { theme, C } = useProfileSurface();
  const { isExpanded } = useResponsive();
  const [showTimePicker, setShowTimePicker] = useState(false);

  const confirmLogout = () => {
    if (!onLogout) return;
    Alert.alert("退出登录", "退出后需要重新登录才能继续陪伴，确定吗？", [
      { text: "再想想", style: "cancel" },
      { text: "退出", style: "destructive", onPress: onLogout },
    ]);
  };

  const cycleFrequency = () => {
    const order = ["安静", "温和", "活跃"];
    const idx = order.indexOf(preferences.proactive_frequency);
    onSetPreference({ proactive_frequency: order[(idx + 1) % order.length] });
  };

  const cycleFontSize = () => {
    const sizes = ["小", "标准", "大"];
    const idx = sizes.indexOf(preferences.font_size);
    onSetPreference({ font_size: sizes[(idx + 1) % sizes.length] });
  };

  const sections = [
    { numeral: "壹", title: "陪伴设置", rows: [
      { icon: <Bell size={16} color={C.text2} />, label: "主动陪伴频率", val: preferences.proactive_frequency, act: cycleFrequency },
      { icon: <Clock size={16} color={C.text2} />, label: "睡前提醒", val: preferences.sleep_reminder_time, act: () => setShowTimePicker(true) },
    ]},
    { numeral: "贰", title: "记忆与隐私", rows: [
      { icon: <Shield size={16} color={C.text2} />, label: "喵灵对我的理解", val: "可查看与纠正", act: onUserProfile },
      { icon: <Archive size={16} color={C.text2} />, label: "记忆管理", val: "", act: onMemory },
      { icon: <Clock size={16} color={C.text2} />, label: "思绪保存期", val: `${preferences.ephemeral_ttl_days}天` },
      { icon: <Shield size={16} color={C.text2} />, label: "记忆审阅", val: "", act: onMemoryReview },
    ]},
    { numeral: "叁", title: "界面与体验", rows: [
      { icon: <Moon size={16} color={C.text2} />, label: "夜间氛围", val: night ? "开启" : "关闭", act: onNightToggle },
      { icon: <Type size={16} color={C.text2} />, label: "字体大小", val: preferences.font_size, act: cycleFontSize },
      { icon: <Layers size={16} color={C.text2} />, label: "减少透明度", val: preferences.reduce_transparency ? "开启" : "关闭", act: () => onSetPreference({ reduce_transparency: !preferences.reduce_transparency }) },
    ]},
  ];
  const avatar = getPetAvatar(petPresetId ?? null);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <PageContainer maxWidth={1100}>
        <PageHeader eyebrow="个人空间" title="我的" description="管理陪伴方式、记忆边界与阅读体验。" />
        <View style={{ flexDirection: isExpanded ? "row" : "column", alignItems: "flex-start", gap: theme.spacing[6] }}>
        {/* 扉页：藏书票式双线框，伙伴立像与名讳 */}
        <Card style={{ width: isExpanded ? 320 : "100%", padding: theme.spacing[3] }} onPress={onChangePet}>
          <View
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.control - 2,
              padding: 3,
            }}
          >
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.colors.divider,
                borderRadius: theme.radii.control - 5,
                alignItems: "center",
                paddingVertical: theme.spacing[6],
                paddingHorizontal: theme.spacing[4],
                gap: theme.spacing[2],
              }}
            >
              {avatar ? (
                <Image
                  source={avatar}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                  style={{ width: 96, height: 96 }}
                />
              ) : (
                <View
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.colors.accentSoft,
                  }}
                >
                  <Text style={{ fontSize: 36 }}>{petEmoji}</Text>
                </View>
              )}
              <Text
                style={[
                  theme.typography.textStyles.sectionTitle,
                  {
                    fontFamily: theme.typography.fontFamilies.sans,
                    color: C.text,
                    marginTop: theme.spacing[2],
                  },
                ]}
              >
                {petName}
              </Text>
              <Text
                style={[
                  theme.typography.textStyles.ambient,
                  { color: C.muted, textAlign: "center" },
                ]}
              >
                {petSummary ?? "你的陪伴伙伴"}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: theme.spacing[1],
                  marginTop: theme.spacing[3],
                }}
              >
                <Text
                  style={[theme.typography.textStyles.label, { color: theme.colors.accent }]}
                >
                  换一位伙伴
                </Text>
                <ChevronRight size={12} color={theme.colors.accent} />
              </View>
            </View>
          </View>
        </Card>
        <View style={{ flex: 1, width: "100%" }}>
        {sections.map((sec, si) => (
          <View key={si} style={{ marginBottom: 16 }}>
            <Text style={[theme.typography.textStyles.label, { marginBottom: theme.spacing[2], paddingHorizontal: theme.spacing[1], color: C.text2 }]}>
              {`${sec.numeral} · ${sec.title}`}
            </Text>
            <Card style={{ padding: theme.spacing[1] }}>
              {sec.rows.map((row, ri) => (
                <View key={ri}>
                  <ListItem
                    leading={row.icon}
                    title={row.label}
                    trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}><Text style={[theme.typography.textStyles.caption, { color: C.muted }]}>{row.val}</Text><ChevronRight size={14} color={C.chevron} /></View>}
                    onPress={row.act}
                  />
                  {ri < sec.rows.length - 1 ? <Divider /> : null}
                </View>
              ))}
            </Card>
          </View>
        ))}
        {onLogout && (
          <Pressable onPress={confirmLogout}
            style={({ pressed }) => [{
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
              marginTop: theme.spacing[1], paddingVertical: theme.spacing[4], borderRadius: theme.radii.control,
              backgroundColor: theme.colors.surface,
              borderWidth: 1, borderColor: theme.colors.border,
              opacity: pressed ? 0.6 : 1,
            }]}>
            <LogOut size={15} color={theme.colors.error} />
            <Text style={[theme.typography.textStyles.bodyStrong, { color: theme.colors.error }]}>退出登录</Text>
          </Pressable>
        )}
        <Text style={{
          marginTop: theme.spacing[4],
          textAlign: "center",
          fontSize: 12,
          color: C.muted,
        }}>
          当前版本 v{CURRENT_VERSION}
        </Text>
        </View>
        </View>
        </PageContainer>
      </ScrollView>

      <TimePickerSheet
        visible={showTimePicker}
        initial={preferences.sleep_reminder_time}
        night={night}
        onCancel={() => setShowTimePicker(false)}
        onConfirm={(t) => { onSetPreference({ sleep_reminder_time: t }); setShowTimePicker(false); }}
      />
    </View>
  );
}

export function PetChange({ pets, activePetId, onBack, onHandoff }: {
  pets: { id: number | string; presetId?: string | null; name: string; emoji: string; summary?: string }[];
  activePetId: number | string | null;
  onBack: () => void;
  onHandoff: (petId: number | string) => void;
}) {
  const { theme, C } = useProfileSurface();
  const [sel, setSel] = useState<number | null>(null);
  const opts = pets.filter((p) => p.id !== activePetId);
  const currentName = pets.find((p) => p.id === activePetId)?.name ?? "当前伙伴";
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
      <PageContainer maxWidth={760}>
        <PageHeader
          action={<IconButton accessibilityLabel="返回个人设置" icon={<ChevronRight color={theme.colors.textSecondary} size={20} style={{ transform: [{ rotate: "180deg" }] }} />} onPress={onBack} />}
          eyebrow="陪伴伙伴"
          title="更换伙伴"
          description={`${currentName}会把粗粒度近况告诉新伙伴，不会复述细节。`}
        />
        <View style={{ gap: theme.spacing[3] }}>
        {opts.map((p, i) => {
          const avatar = getPetAvatar(p.presetId ?? String(p.id));
          return (
          <Card key={i} onPress={() => setSel(i)}
            style={{
              padding: 20, flexDirection: "row", alignItems: "center", gap: 16,
              borderWidth: sel === i ? 1.5 : 1,
              borderColor: sel === i ? theme.colors.accent : theme.colors.border,
              backgroundColor: sel === i ? theme.colors.accentSoft : theme.colors.surface,
            }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accentSoft }}>
              {avatar ? (
                <Image source={avatar} resizeMode="contain" accessibilityIgnoresInvertColors style={{ width: 58, height: 58 }} />
              ) : (
                <Text style={{ fontSize: 24 }}>{p.emoji}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "500", color: C.text }}>{p.name}</Text>
              <Text style={{ fontSize: 13, marginTop: 2, color: C.text2 }}>{p.summary ?? "陪伴伙伴"}</Text>
            </View>
            {sel === i && (
              <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accentSurface }}>
                <Check size={12} color={theme.colors.accent} strokeWidth={2.4} />
              </View>
            )}
          </Card>
          );
        })}
        <View style={{ marginTop: theme.spacing[5] }}>
          <Button onPress={() => opts[sel ?? -1] && onHandoff(opts[sel!].id)} fullWidth disabled={sel === null}>确认更换</Button>
        </View>
        </View>
      </PageContainer>
    </ScrollView>
  );
}

export function PetHandoff({ onBack, onDone, oldPet, newPet, handoffContent }: {
  onBack: () => void; onDone: () => void;
  oldPet?: { name: string; emoji: string };
  newPet?: { name: string; emoji: string };
  handoffContent?: string | null;
}) {
  const { theme, C } = useProfileSurface();
  const oldName = oldPet?.name ?? "前任伙伴";
  const newEmoji = newPet?.emoji ?? "☀️";
  const bodyText = handoffContent && handoffContent.trim()
    ? handoffContent
    : "嗨。\n\n这位朋友最近在处理一些需要时间消化的事情，心情整体还不错，偶尔会有点累。\n\n喜欢睡前说说话。有几件事放在信箱里还没处理完。\n\n好好陪着她。";
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
      <PageContainer maxWidth={720} style={{ flex: 1, justifyContent: "center" }}>
      <View style={{ gap: theme.spacing[5], alignItems: "center" }}>
        <View style={{ alignSelf: "flex-start" }}>
          <IconButton accessibilityLabel="返回选择伙伴" icon={<ChevronRight color={theme.colors.textSecondary} size={20} style={{ transform: [{ rotate: "180deg" }] }} />} onPress={onBack} />
        </View>
        <Text style={{ fontSize: 56 }}>{newEmoji}</Text>
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 22, fontWeight: "500", marginBottom: 4, color: C.text }}>来自{oldName}的交接信</Text>
          <Text style={{ fontSize: 14, color: C.text2 }}>给新来的伙伴看的</Text>
        </View>
        <Card emphasized style={{ alignSelf: "stretch" }}>
          <Text style={[theme.typography.textStyles.body, { color: C.text }]}>{bodyText}</Text>
        </Card>
        <View style={{ alignSelf: "stretch" }}>
          <Button onPress={onDone} fullWidth>认识新伙伴</Button>
        </View>
      </View>
      </PageContainer>
    </ScrollView>
  );
}

// ─── 记忆管理 ────────────────────────────────────────────────────────────────

function SensitivityBadge({ label, night }: { label: string; night: boolean }) {
  const colors: Record<string, string> = {
    "日常": "#A3C9A8",
    "个人": "#D4B483",
    "较私密": "#C98B8B",
    "很私密": "#A88B9A",
  };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors[label] ?? "#D4B483" }}>
      <Text style={{ fontSize: 11, color: night ? "#2A2114" : "#3B3428" }}>{label}</Text>
    </View>
  );
}

export function MemoryScreen({ onBack, onToast }: { onBack: () => void; onToast: (msg: string) => void }) {
  const { theme, C } = useProfileSurface();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listMemories();
      setItems(data as any[]);
    } catch (e: any) {
      onToast(e?.message || "读取记忆失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: number) => {
    try {
      await deleteMemory(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      onToast("已删除");
    } catch (e: any) {
      onToast(e?.message || "删除失败");
    }
  };

  const clearAll = async () => {
    try {
      await clearMemories();
      setItems([]);
      onToast("已清空全部记忆");
    } catch (e: any) {
      onToast(e?.message || "清空失败");
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ProfileHeader onBack={onBack} title="记忆管理" action={
        items.length > 0 ? (
          <IconButton accessibilityLabel="清空全部记忆" icon={<Trash2 size={18} color={C.text2} />} onPress={clearAll} />
        ) : null
      } />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <PageContainer maxWidth={860} style={{ paddingTop: theme.spacing[2] }}>
        {loading ? (
          <LoadingState label="正在读取记忆…" />
        ) : items.length === 0 ? (
          <EmptyState icon={<Archive color={C.muted} size={24} />} title="还没有需要管理的记忆" description="需要长期保留的内容会出现在这里。" />
        ) : (
          <View style={{ gap: 12 }}>
            {items.map((item) => (
              <Card key={item.id}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Text style={{ fontSize: 12, color: C.muted }}>{item.kind}</Text>
                  <Text style={{ fontSize: 12, color: C.muted }}>·</Text>
                  <Text style={{ fontSize: 12, color: C.muted }}>{item.updated_at?.slice(0, 10)}</Text>
                </View>
                <Text style={{ fontSize: 15, lineHeight: 22, color: C.text }}>{item.surface_text || item.content}</Text>
                <Pressable onPress={() => remove(item.id)} style={{ alignSelf: "flex-end", marginTop: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(201,139,139,0.18)" }}>
                  <Text style={{ fontSize: 12, color: theme.colors.error }}>删除</Text>
                </Pressable>
              </Card>
            ))}
          </View>
        )}
        </PageContainer>
      </ScrollView>
    </View>
  );
}

export function MemoryReviewScreen({ onBack, onToast }: { onBack: () => void; onToast: (msg: string) => void }) {
  const { theme, night, C } = useProfileSurface();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMemoryReview()
      .then((data) => setItems(data as any[]))
      .catch((e: any) => onToast(e?.message || "读取审阅面失败"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <ProfileHeader onBack={onBack} title="记忆审阅" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <PageContainer maxWidth={860} style={{ paddingTop: theme.spacing[2] }}>
        <Text style={[theme.typography.textStyles.body, { color: C.text2, marginBottom: theme.spacing[4] }]}>
          这里只显示日常/个人/较私密/很私密软标签，不暴露诊断或轴名。
        </Text>
        {loading ? (
          <LoadingState label="正在准备审阅内容…" />
        ) : items.length === 0 ? (
          <EmptyState icon={<Shield color={C.muted} size={24} />} title="暂无可审阅的记忆" description="这里会显示记忆的隐私标签，方便你随时检查。" />
        ) : (
          <View style={{ gap: 12 }}>
            {items.map((item) => (
              <Card key={item.id}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: C.muted }}>{item.kind}</Text>
                  <SensitivityBadge label={item.sensitivity} night={night} />
                </View>
                <Text style={{ fontSize: 15, lineHeight: 22, color: C.text }}>{item.surface_text}</Text>
              </Card>
            ))}
          </View>
        )}
        </PageContainer>
      </ScrollView>
    </View>
  );
}
