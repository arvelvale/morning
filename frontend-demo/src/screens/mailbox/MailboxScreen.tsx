/**
 * 信箱主屏：「来信 + 思绪」双层，像游戏邮箱一样简单。
 *
 * - 来信：最新一封（信封→信纸）+ 往期来信列表 + 「我留下的」入口；
 * - 思绪：倾倒整理出的念头统一放这里——办（待办）/想（灵感）/情（情绪）/景（片段），
 *   批注式单列，不堆卡片；带保存期的思绪可随时珍藏或放下（默认保留一个月，后端 TTL）。
 *
 * 不再有「今日待启 / 三日寄存 / 长久珍藏」分区，来信也不设每日数量上限。
 */
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Archive, Check, ChevronLeft } from "lucide-react-native";
import {
  Card,
  Chip,
  EmptyState,
  PageContainer,
  PageHeader,
  useResponsive,
} from "../../design-system";
import {
  acceptSceneInvite, ackLetter, createTreasure, deleteTodo, deleteTreasure,
  dropEphemeral, keepEphemeral, listEphemeral, listIdeas, listLetters, listTodos, listTreasures,
  markLetterRead, updateTodo,
} from "../../api";
import {
  ApiLetter, Keepsake, Task, TODAY_DATE,
  dayKey, letterKind, letterTime, mapTodo, mapTreasure, remainText, useMailboxSurface,
} from "./shared";
import { KeepsakeAlbum, KeepsakeDetail } from "./Keepsakes";
import { LetterPaper } from "./Letters";
import { LetterList } from "./LetterList";
import { TonightLetter } from "./TonightLetter";
import { useGuide } from "../../guide/Guide";

/** 思绪批注行：单字章 + 正文 + 元信息 + 轻量动作。 */
interface ThoughtRow {
  key: string;
  seal: string;
  text: string;
  meta: string;
  done?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  onKeep?: () => void;
  onDrop?: () => void;
}

/** 待办的轻量时间文案：今天 / 今天 15:00 / 8月2日。 */
function dueText(t: Task): string {
  if (t.date === TODAY_DATE) return t.time ? `今天 ${t.time}` : "今天";
  const [y, m, d] = t.date.split("-").map(Number);
  return `${y === new Date().getFullYear() ? "" : `${y}年`}${m}月${d}日${t.time ? ` ${t.time}` : ""}`;
}

/** 后端 ephemeral 的 kind → 单字章（情绪→情，片段/候选→景，兜底→想）。 */
function sealOfKind(kind: string): string {
  if (kind === "emotion" || kind === "情绪") return "情";
  if (kind === "fragment" || kind === "片段" || kind === "候选") return "景";
  return "想";
}

export function MailboxScreen({ onReplyLetter, onToast, onPlayScene, petName = "你的伙伴", petPresetId = null, petEmoji = "✨" }: {
  onReplyLetter: (letter: { title: string; body: string } | null) => void;
  onToast?: (msg: string) => void;
  /** 接受场景邀请后进入片场演绎（sceneId + 预设剧场 id，dynamic_image 时 theaterId 为 null） */
  onPlayScene?: (sceneId: number, theaterId: string | null) => void;
  petName?: string;
  petPresetId?: string | null;
  petEmoji?: string;
}) {
  const { theme, C } = useMailboxSurface();
  const guide = useGuide();
  const { isExpanded } = useResponsive();
  const [sec, setSec] = useState(0);
  const sections = ["来信", "思绪"];

  // ─── 思绪：待办 / 灵感 / 临时思绪 ───
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ideas, setIdeas] = useState<any[]>([]);
  const [ephem, setEphem] = useState<any[]>([]);

  // ─── 我留下的（原「长久珍藏」，只作为来信页的安静入口）───
  const [keepsakes, setKeepsakes] = useState<Keepsake[]>([]);
  const [selectedKeepsake, setSelectedKeepsake] = useState<Keepsake | null>(null);
  const [showKeepsakes, setShowKeepsakes] = useState(false);

  // ─── 来信（真实后端）───
  const [letters, setLetters] = useState<ApiLetter[]>([]);
  // 改版（2026-10-14）：列表 ↔ 读信两种状态；readingId 为空就是列表
  const [readingId, setReadingId] = useState<number | null>(null);
  const [savedLetterIds, setSavedLetterIds] = useState<Set<number>>(new Set());
  const [ackingLetter, setAckingLetter] = useState(false);
  const [ackedLetterIds, setAckedLetterIds] = useState<Set<number>>(new Set());

  const activeLetter = letters.find(l => l.id === readingId) ?? null;

  const reloadLetters = async () => {
    try {
      const list = await listLetters("");
      setLetters(Array.isArray(list) ? list : []);
    } catch { /* 网络异常保持当前 */ }
  };

  /** 点开一封信：直接读，顺手标已读。 */
  const openLetter = (letter: ApiLetter) => {
    setReadingId(letter.id);
    setShowKeepsakes(false);
    if (!letter.is_read) {
      markLetterRead(letter.id).catch(() => {});
      setLetters(ls => ls.map(l => l.id === letter.id ? { ...l, is_read: true } : l));
    }
  };

  const handleSaveLetter = async () => {
    if (!activeLetter || savedLetterIds.has(activeLetter.id)) return;
    try {
      await createTreasure({
        source_type: "letter", source_id: activeLetter.id,
        title: activeLetter.title, content: activeLetter.body,
      });
      setSavedLetterIds(s => new Set(s).add(activeLetter.id));
      onToast?.("已替你收好 ✦");
      reloadTreasures();
    } catch {
      onToast?.("没存上，待会儿再试试");
    }
  };

  const handleAckLetter = async () => {
    if (!activeLetter || ackingLetter || ackedLetterIds.has(activeLetter.id)) return;
    setAckingLetter(true);
    try {
      const res = await ackLetter(activeLetter.id);
      setAckedLetterIds(s => new Set(s).add(activeLetter.id));
      onToast?.(res.message || "它知道你收到了");
    } catch {
      onToast?.("它知道你收到了");
    } finally {
      setAckingLetter(false);
    }
  };

  // ─── scene_invite：接受邀请 → 建场景 → 进片场 ───
  const [enteringScene, setEnteringScene] = useState(false);
  const handleEnterScene = async (letter: ApiLetter) => {
    if (enteringScene) return;
    setEnteringScene(true);
    try {
      const res = await acceptSceneInvite(letter.id);
      setLetters(ls => ls.map(l => l.id === letter.id ? { ...l, is_read: true } : l));
      if (onPlayScene) onPlayScene(res.scene_id, res.theater_id ?? null);
      else onToast?.("场景已经搭好，从这封信进去就能开始");
    } catch (e: any) {
      onToast?.(e?.message || "场景没布置好，待会儿再试试");
    } finally {
      setEnteringScene(false);
    }
  };

  const reloadTasks = async () => {
    try {
      const list = await listTodos("");
      setTasks((Array.isArray(list) ? list : []).map(mapTodo));
    } catch { /* 网络异常保持当前列表 */ }
  };
  const reloadIdeas = async () => {
    try {
      const list = await listIdeas();
      setIdeas(Array.isArray(list) ? list : []);
    } catch { /* 网络异常保持当前列表 */ }
  };
  const reloadTreasures = async () => {
    try {
      const list = await listTreasures();
      setKeepsakes((Array.isArray(list) ? list : []).map(mapTreasure));
    } catch { /* 网络异常保持当前列表 */ }
  };
  const reloadEphemeral = async () => {
    try {
      const list = await listEphemeral();
      setEphem(Array.isArray(list) ? list : []);
    } catch { /* 网络异常保持当前列表 */ }
  };
  useEffect(() => { reloadTasks(); reloadIdeas(); reloadTreasures(); reloadEphemeral(); reloadLetters(); }, []);

  const toggleTask = (id: string) => {
    let done = false;
    setTasks(ts => ts.map(t => {
      if (t.id === id) { done = !t.completed; return { ...t, completed: done }; }
      return t;
    }));
    updateTodo(Number(id), { status: done ? "done" : "pending" }).catch(() => {});
  };
  const deleteTask = (id: string) => {
    setTasks(ts => ts.filter(t => t.id !== id));
    deleteTodo(Number(id)).catch(() => {});
  };
  const keepEph = (id: number) => {
    setEphem(list => list.filter(e => e.id !== id));
    keepEphemeral(id).then(reloadTreasures).catch(() => {});
  };
  const dropEph = (id: number) => {
    setEphem(list => list.filter(e => e.id !== id));
    dropEphemeral(id).catch(() => {});
  };
  const removeKeepsake = (id: string) => {
    setKeepsakes(ks => ks.filter(k => k.id !== id));
    setSelectedKeepsake(null);
    deleteTreasure(Number(id)).catch(() => {});
  };

  // ─── 思绪批注列表：办（待办）→ 想（灵感）→ 情/景（临时思绪）───
  const rows: ThoughtRow[] = [
    ...tasks.map(t => ({
      key: `task-${t.id}`,
      seal: "办",
      text: t.title,
      meta: dueText(t),
      done: t.completed,
      onToggle: () => toggleTask(t.id),
      onRemove: t.completed ? () => deleteTask(t.id) : undefined,
    })),
    ...ideas.map(it => ({
      key: `idea-${it.id}`,
      seal: "想",
      text: it.surface_text || it.content || "",
      meta: "灵感",
    })),
    ...ephem.map(it => ({
      key: `eph-${it.id}`,
      seal: sealOfKind(String(it.kind || "")),
      text: it.surface_text || it.content || "",
      meta: remainText(it.expires_at),
      onKeep: () => keepEph(it.id),
      onDrop: () => dropEph(it.id),
    })),
  ];
  const sealCounts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.seal] = (acc[r.seal] || 0) + 1;
    return acc;
  }, {});

  const unreadLetters = letters.filter(l => !l.is_read).length;

  // 今天的晚间来信到了没有（只认晚间信；有句话、小纸条不算）
  const todayKeyNow = dayKey(new Date());
  const todaysLetter = letters.find(l => letterKind(l) === "evening" && (() => {
    const t = letterTime(l);
    return t != null && dayKey(t) === todayKeyNow;
  })()) ?? null;
  const openTodaysLetter = () => { if (todaysLetter) openLetter(todaysLetter); };

  const backBar = (label: string, onBack: () => void) => (
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 6, marginBottom: 10, opacity: pressed ? 0.6 : 1 })}>
      <ChevronLeft size={18} color={C.text2} />
      <Text style={[theme.typography.textStyles.caption, { color: C.text2 }]}>{label}</Text>
    </Pressable>
  );

  const letterSection = activeLetter ? (
    <>
      {backBar("回到信箱", () => setReadingId(null))}
      <LetterPaper letter={activeLetter} petName={petName}
        saved={savedLetterIds.has(activeLetter.id)}
        onAck={handleAckLetter} acking={ackingLetter} acked={ackedLetterIds.has(activeLetter.id)}
        onReply={() => onReplyLetter({ title: activeLetter.title, body: activeLetter.body })}
        onSave={handleSaveLetter}
        onEnterScene={() => handleEnterScene(activeLetter)} entering={enteringScene}
        onGotoKeepsakes={() => { setReadingId(null); setShowKeepsakes(true); }} />
    </>
  ) : showKeepsakes ? (
    <>
      {backBar("回到来信", () => setShowKeepsakes(false))}
      <KeepsakeAlbum keepsakes={keepsakes} onSelectItem={setSelectedKeepsake} onRemove={removeKeepsake} />
    </>
  ) : (
    <LetterList letters={letters} petName={petName} keptCount={keepsakes.length}
      onOpen={openLetter} onShowKept={() => setShowKeepsakes(true)}
      header={!todaysLetter || guide.active ? (
        <TonightLetter arrived={!!todaysLetter} onOpen={openTodaysLetter}
          petEmoji={petEmoji} petName={petName} petPresetId={petPresetId} />
      ) : null} />
  );

  const thoughtSection = (
    <>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Archive color={theme.colors.textMuted} size={24} />}
          title="思绪盒还空着"
          description="睡前倾倒的念头，整理后会来到这里。"
        />
      ) : (
        <>
          {/* 图例：单字章含义与条数 */}
          <View style={{ flexDirection: "row", gap: theme.spacing[5], marginBottom: theme.spacing[4] }}>
            {["办", "想", "情", "景"].filter(s => sealCounts[s]).map(s => (
              <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                <View style={{
                  width: 26, height: 26, borderRadius: 4, borderWidth: 1, borderColor: theme.colors.border,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ fontSize: 13, color: theme.colors.accent }}>{s}</Text>
                </View>
                <Text style={[theme.typography.textStyles.caption, { color: C.muted }]}>
                  {{ 办: "待办", 想: "灵感", 情: "情绪", 景: "片段" }[s]} · {sealCounts[s]}
                </Text>
              </View>
            ))}
          </View>

          {rows.map(row => (
            <View key={row.key} style={{
              flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3],
              paddingVertical: theme.spacing[3], borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
            }}>
              <View style={{
                width: 28, height: 28, borderRadius: 4, borderWidth: 1, borderColor: theme.colors.border,
                alignItems: "center", justifyContent: "center", marginTop: 2,
              }}>
                <Text style={{ fontSize: 14, color: theme.colors.accent }}>{row.seal}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[
                  theme.typography.textStyles.body,
                  { color: row.done ? C.muted : C.text, textDecorationLine: row.done ? "line-through" : "none" },
                ]}>{row.text}</Text>
                {!!row.meta && (
                  <Text style={[theme.typography.textStyles.caption, { color: C.muted, marginTop: 2 }]}>{row.meta}</Text>
                )}
                {(row.onKeep || row.onDrop) && (
                  <View style={{ flexDirection: "row", gap: theme.spacing[4], marginTop: theme.spacing[2] }}>
                    {row.onKeep && (
                      <Pressable onPress={row.onKeep} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                        <Text style={[theme.typography.textStyles.caption, { color: theme.colors.accent, fontWeight: "500" }]}>珍藏</Text>
                      </Pressable>
                    )}
                    {row.onDrop && (
                      <Pressable onPress={row.onDrop} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                        <Text style={[theme.typography.textStyles.caption, { color: C.muted }]}>放下</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
              {row.onToggle && (
                <Pressable onPress={row.onToggle} hitSlop={8}
                  style={({ pressed }) => ({
                    width: 24, height: 24, borderRadius: 12, marginTop: 2,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: row.done ? theme.colors.accentSurface : "transparent",
                    borderWidth: 2, borderColor: row.done ? theme.colors.accent : theme.colors.border,
                    transform: [{ scale: pressed ? 0.9 : 1 }],
                  })}>
                  {row.done && <Check size={12} color={theme.colors.textOnAccent} />}
                </Pressable>
              )}
              {row.onRemove && (
                <Pressable onPress={row.onRemove} hitSlop={8} style={{ marginTop: 5 }}>
                  <Text style={[theme.typography.textStyles.caption, { color: C.muted }]}>移除</Text>
                </Pressable>
              )}
            </View>
          ))}
          <Text style={[theme.typography.textStyles.label, { color: C.muted, marginTop: theme.spacing[4], textAlign: "center" }]}>
            没做决定的思绪会保留一个月，到期轻轻放下
          </Text>
        </>
      )}
    </>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <PageContainer maxWidth={1180}>
          <PageHeader
            eyebrow="来信与思绪"
            title="信箱"
            description="信来了就读，思绪替你收着。"
          />
          {!isExpanded ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing[2], paddingBottom: theme.spacing[5] }}>
              {sections.map((s, i) => (
                <Chip key={s} selected={sec === i} onPress={() => setSec(i)}>
                  {s}{i === 0 && unreadLetters > 0 ? ` · ${unreadLetters}` : ""}
                </Chip>
              ))}
            </ScrollView>
          ) : null}
          <View style={{ flexDirection: isExpanded ? "row" : "column", alignItems: "flex-start", gap: theme.spacing[6] }}>
            {isExpanded ? (
              <Card style={{ width: 260, padding: theme.spacing[2] }}>
                {sections.map((s, i) => (
                  <Pressable
                    key={s}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: sec === i }}
                    onPress={() => setSec(i)}
                    style={({ pressed }) => ({
                      minHeight: 52,
                      paddingHorizontal: theme.spacing[4],
                      borderRadius: theme.radii.control,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      backgroundColor: sec === i ? theme.colors.accentSoft : pressed ? theme.colors.surfacePressed : "transparent",
                    })}
                  >
                    <Text style={[theme.typography.textStyles.bodyStrong, { color: sec === i ? theme.colors.accent : theme.colors.textSecondary }]}>
                      {s}
                    </Text>
                    {i === 0 && unreadLetters > 0 ? <Chip>{unreadLetters}</Chip> : null}
                  </Pressable>
                ))}
              </Card>
            ) : null}
            <Card style={{ flex: 1, width: "100%", minWidth: 0 }}>
              {sec === 0 ? letterSection : thoughtSection}
            </Card>
          </View>
        </PageContainer>
      </ScrollView>

      {selectedKeepsake && (
        <KeepsakeDetail item={selectedKeepsake}
          onClose={() => setSelectedKeepsake(null)} onRemove={() => removeKeepsake(selectedKeepsake.id)} />
      )}
    </View>
  );
}
