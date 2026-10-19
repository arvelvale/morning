/**
 * 信箱列表（改版 2026-10-14，原型 docs/design/prototypes/mailbox-redesign）：
 * - 今天：正经的信单独成卡（标题 + 两行预览 + 谁写的 + 几点）；一两句话的小纸条叠成一叠，点开再展开；
 * - 往期：按类型筛选 + 按天分组（显示时分），每天的小纸条只留一行「+N 张小纸条」；
 * - 右上角搜索：按标题和正文找；旁边的「整理」进入选择模式（多选删除 / 全部已读 / 清空全部）。
 *
 * 选择模式：每行左侧出现勾选圈，今天的卡片、小纸条（逐张列出）、往期都能选；
 * 「全选」选中的是当前看得见的（往期受筛选影响）。真正的删除在 MailboxScreen（乐观更新 + 回滚）。
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Bookmark, Check, ChevronDown, ChevronUp, ListChecks, Search, X } from "lucide-react-native";
import { paperColors, useTheme } from "../../design-system";
import {
  ApiLetter, LETTER_KIND_LABEL, LetterDay, LetterKind, PastFilter,
  dayKey, dayLabel, groupLettersByDay, idsOfDays, isAllSelected, letterClock, letterKind, matchLetter,
  shownDays, unreadCountOf,
} from "./shared";
import { LetterKindIcon } from "./LetterKindIcons";

const KIND_TONE: Record<LetterKind, { fg: string; bg: string }> = {
  evening: { fg: "#C98E00", bg: "#FBEFC8" },
  rehearse: { fg: "#7563DE", bg: "#ECE8FD" },
  weekly: { fg: "#23917A", bg: "#D8F0E7" },
  note: { fg: "#C98E00", bg: "#FBEFC8" },
  other: { fg: "#8C8187", bg: "#F1ECE4" },
};

/** 手绘图标（LetterKindIcons）：晚间信=信封+月亮、有句话=气泡+星、周报=日历+渐亮的点、小纸条=卷角便签。 */
function KindIcon({ kind, size = 16 }: { kind: LetterKind; size?: number }) {
  return <LetterKindIcon kind={kind} size={size} color={KIND_TONE[kind].fg} />;
}

/** 选择模式左侧的勾选圈。 */
function SelectDot({ on }: { on: boolean }) {
  const theme = useTheme();
  return (
    <View style={{
      width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center",
      borderWidth: on ? 0 : 1.5, borderColor: theme.colors.textMuted,
      backgroundColor: on ? theme.colors.accent : "transparent",
    }}>
      {on ? <Check size={13} color={theme.colors.textOnAccent} strokeWidth={3} /> : null}
    </View>
  );
}

/** 今天的信：一张卡，两行预览。 */
function LetterCard({ letter, petName, onPress, selecting, selected }: {
  letter: ApiLetter; petName: string; onPress: () => void; selecting?: boolean; selected?: boolean;
}) {
  const theme = useTheme();
  const kind = letterKind(letter);
  const tone = KIND_TONE[kind];
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${LETTER_KIND_LABEL[kind]}：${letter.title}`}
      accessibilityState={selecting ? { selected: !!selected } : undefined}
      style={({ pressed }) => ({
        borderRadius: 18, padding: 16, marginBottom: 10,
        backgroundColor: kind === "rehearse" ? "#FBF8FF" : "rgba(255,252,246,0.98)",
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? theme.colors.accent : kind === "rehearse" ? "#E4DEFA" : "rgba(255,255,255,0.6)",
        transform: [{ scale: pressed ? 0.985 : 1 }], ...theme.shadows.soft,
      })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {selecting && <SelectDot on={!!selected} />}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: tone.bg }}>
          <KindIcon kind={kind} size={14} />
          <Text style={{ fontSize: 11, color: tone.fg, fontWeight: "500" }}>{LETTER_KIND_LABEL[kind]}</Text>
        </View>
        <Text style={{ fontSize: 12, color: paperColors.meta2, flex: 1 }}>{petName} · {letterClock(letter)}</Text>
        {!letter.is_read && !selecting && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#E26140" }} />}
      </View>
      <Text numberOfLines={1} style={[theme.typography.textStyles.emotionalTitle, { fontSize: 18, lineHeight: 26, color: paperColors.ink2 }]}>
        {letter.title}
      </Text>
      <Text numberOfLines={2} style={{ fontSize: 14, lineHeight: 22, marginTop: 2, color: paperColors.body }}>
        {letter.body.replace(/\s+/g, " ")}
      </Text>
    </Pressable>
  );
}

/** 一叠小纸条：默认收起，点开展开成一行一张；选择模式下逐张列出，方便一张张勾。 */
function NotesStack({ notes, onOpen, selecting, selected }: {
  notes: ApiLetter[]; onOpen: (l: ApiLetter) => void; selecting?: boolean; selected?: ReadonlySet<number>;
}) {
  const theme = useTheme();
  const [openState, setOpen] = useState(false);
  if (notes.length === 0) return null;
  const open = openState || !!selecting;
  const unread = notes.filter(n => !n.is_read).length;
  const titles = [...new Set(notes.map(n => n.title))].slice(0, 3).join(" · ");
  return (
    <View style={{ marginTop: 4, marginBottom: open ? 8 : 18 }}>
      {!open && (
        <>
          <View style={{ position: "absolute", left: 20, right: 20, bottom: -10, height: 14, borderRadius: 12, backgroundColor: "#EFE9DE" }} />
          <View style={{ position: "absolute", left: 10, right: 10, bottom: -5, height: 14, borderRadius: 12, backgroundColor: "#F7F2E9" }} />
        </>
      )}
      <Pressable onPress={() => { if (!selecting) setOpen(o => !o); }} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${notes.length} 张小纸条，${open ? "收起" : "展开"}`}
        style={{
          flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingHorizontal: 14,
          borderRadius: 14, backgroundColor: "#FFFDF8",
        }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: KIND_TONE.note.bg }}>
          <KindIcon kind="note" size={18} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: paperColors.ink2 }}>
            {notes.length} 张小纸条{unread ? ` · ${unread} 张没看` : ""}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: paperColors.meta2 }}>{titles}</Text>
        </View>
        {!selecting && <Text style={{ fontSize: 12, color: theme.colors.textMuted }}>{open ? "收起" : "展开"}</Text>}
        {!selecting && (open ? <ChevronUp size={14} color={theme.colors.textMuted} /> : <ChevronDown size={14} color={theme.colors.textMuted} />)}
      </Pressable>
      {open && notes.map(n => (
        <Pressable key={n.id} onPress={() => onOpen(n)}
          accessibilityState={selecting ? { selected: !!selected?.has(n.id) } : undefined}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11,
            paddingLeft: selecting ? 14 : 54, paddingRight: 14,
            borderBottomWidth: 1, borderBottomColor: theme.colors.divider, borderStyle: "dashed",
            opacity: pressed ? 0.7 : 1,
          })}>
          {selecting && <SelectDot on={!!selected?.has(n.id)} />}
          <Text style={{ width: 40, fontSize: 12, lineHeight: 21, color: theme.colors.textMuted }}>{letterClock(n)}</Text>
          <Text numberOfLines={2} style={{ flex: 1, fontSize: 13.5, lineHeight: 21, color: n.is_read ? paperColors.sub : paperColors.ink2 }}>
            {n.body.replace(/\s+/g, " ")}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function PastRow({ letter, onPress, selecting, selected }: {
  letter: ApiLetter; onPress: () => void; selecting?: boolean; selected?: boolean;
}) {
  const theme = useTheme();
  const kind = letterKind(letter);
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityState={selecting ? { selected: !!selected } : undefined}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: theme.colors.divider, opacity: pressed ? 0.7 : 1,
      })}>
      {selecting && <SelectDot on={!!selected} />}
      <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: KIND_TONE[kind].bg }}>
        <KindIcon kind={kind} size={18} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[theme.typography.textStyles.emotionalTitle, { fontSize: 16, lineHeight: 23, color: paperColors.ink2 }]}>
          {letter.title}
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.textMuted }}>{LETTER_KIND_LABEL[kind]}</Text>
      </View>
      <Text style={{ fontSize: 12, color: theme.colors.textMuted }}>{letterClock(letter)}</Text>
      {!letter.is_read && !selecting && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#E26140" }} />}
    </Pressable>
  );
}

type Filter = PastFilter | "kept";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" }, { id: "evening", label: "晚间信" }, { id: "rehearse", label: "有句话" },
  { id: "weekly", label: "周报" }, { id: "note", label: "小纸条" }, { id: "kept", label: "我留下的" },
];

/** 往期：筛选 + 按天分组。筛「小纸条」时纸条逐张列出；其余筛选下每天的纸条收成一行。 */
function PastTimeline({ days, filter, onFilter, onOpen, onShowKept, selecting, selected }: {
  days: LetterDay[]; filter: PastFilter; onFilter: (f: PastFilter) => void;
  onOpen: (l: ApiLetter) => void; onShowKept: () => void;
  selecting?: boolean; selected?: ReadonlySet<number>;
}) {
  const theme = useTheme();
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const shown = shownDays(days, filter);
  const row = (l: ApiLetter) => (
    <PastRow key={l.id} letter={l} onPress={() => onOpen(l)} selecting={selecting} selected={!!selected?.has(l.id)} />
  );

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 12, letterSpacing: 0.5, color: theme.colors.textMuted, marginBottom: 8 }}>往期</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
        {FILTERS.map(f => (
          <Pressable key={f.id} onPress={() => (f.id === "kept" ? onShowKept() : onFilter(f.id))}
            accessibilityRole="tab" accessibilityState={{ selected: filter === f.id }}
            style={{
              paddingHorizontal: 13, paddingVertical: 6, borderRadius: 16,
              backgroundColor: filter === f.id ? theme.colors.accent : "rgba(255,255,255,0.7)",
            }}>
            <Text style={{ fontSize: 13, color: filter === f.id ? theme.colors.textOnAccent : theme.colors.textSecondary }}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {shown.length === 0 && (
        <Text style={{ fontSize: 13, color: theme.colors.textMuted, paddingVertical: 16, textAlign: "center" }}>这一类还没有往期的信</Text>
      )}
      {shown.map(d => {
        // 选择模式下纸条全部摊开，才能一张张勾
        const open = expandedDays.has(d.key) || !!selecting;
        return (
          <View key={d.key} style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 8 }}>{dayLabel(d.key)}</Text>
            {d.letters.map(row)}
            {d.notes.length > 0 && !open && (
              <Pressable onPress={() => setExpandedDays(s => new Set(s).add(d.key))} style={{ paddingVertical: 9, paddingLeft: 44 }}>
                <Text style={{ fontSize: 12, color: theme.colors.textMuted }}>+ {d.notes.length} 张小纸条</Text>
              </Pressable>
            )}
            {open && d.notes.map(row)}
          </View>
        );
      })}
    </View>
  );
}

/** 搜索结果：不分组，按时间倒序。 */
function SearchResults({ letters, query, onOpen }: { letters: ApiLetter[]; query: string; onOpen: (l: ApiLetter) => void }) {
  const theme = useTheme();
  const hits = letters.filter(l => matchLetter(l, query));
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 4 }}>
        {query.trim() ? `找到 ${hits.length} 封` : "输入标题或正文里的字"}
      </Text>
      {query.trim() ? hits.map(l => <PastRow key={l.id} letter={l} onPress={() => onOpen(l)} />) : null}
    </View>
  );
}

/** 选择模式顶栏：已选 N 封 · 全选 · 取消，下面一行放两个批量动作。 */
function SelectBar({ count, allOn, unread, onSelectAll, onCancel, onReadAll, onClearAll }: {
  count: number; allOn: boolean; unread: number;
  onSelectAll: () => void; onCancel: () => void; onReadAll: () => void; onClearAll: () => void;
}) {
  const theme = useTheme();
  const textBtn = (label: string, onPress: () => void, color: string) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ paddingHorizontal: 12, height: 36, justifyContent: "center", borderRadius: 18, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontSize: 14, fontWeight: "500", color }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ marginBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.colors.textPrimary }}>
          {count ? `已选 ${count} 封` : "选择要整理的信"}
        </Text>
        {textBtn(allOn ? "取消全选" : "全选", onSelectAll, theme.colors.accent)}
        {textBtn("取消", onCancel, theme.colors.textSecondary)}
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        <Pressable onPress={onReadAll} disabled={unread === 0} accessibilityRole="button" accessibilityLabel="全部标为已读"
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17,
            backgroundColor: theme.colors.surface, opacity: unread === 0 ? 0.45 : pressed ? 0.7 : 1,
          })}>
          <Check size={14} color={theme.colors.textSecondary} />
          <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{unread ? `全部标为已读（${unread}）` : "全部标为已读"}</Text>
        </Pressable>
        <Pressable onPress={onClearAll} accessibilityRole="button" accessibilityLabel="清空全部"
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", height: 34, paddingHorizontal: 14, borderRadius: 17,
            backgroundColor: "rgba(208,83,58,0.10)", opacity: pressed ? 0.7 : 1,
          })}>
          <Text style={{ fontSize: 13, fontWeight: "500", color: theme.colors.error }}>清空全部</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function LetterList({
  letters, petName, header, keptCount, onOpen, onShowKept,
  selecting = false, selected, onEnterSelect, onCancelSelect, onToggle, onSelectAll, onReadAll, onClearAll,
}: {
  letters: ApiLetter[];
  petName: string;
  /** 顶部插槽：今晚的信横幅 */
  header?: React.ReactNode;
  keptCount: number;
  onOpen: (l: ApiLetter) => void;
  onShowKept: () => void;
  /** 选择模式（多选清理）：状态在 MailboxScreen，这里只管显示 */
  selecting?: boolean;
  selected?: ReadonlySet<number>;
  onEnterSelect?: () => void;
  onCancelSelect?: () => void;
  onToggle?: (id: number) => void;
  /** 参数是当前看得见的所有 id（今天 + 筛选后的往期） */
  onSelectAll?: (visibleIds: number[]) => void;
  onReadAll?: () => void;
  onClearAll?: () => void;
}) {
  const theme = useTheme();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PastFilter>("all");
  const days = useMemo(() => groupLettersByDay(letters), [letters]);
  const todayKey = dayKey(new Date());
  const today = days.find(d => d.key === todayKey) ?? null;
  const past = days.filter(d => d.key !== todayKey);
  const todayCount = today ? today.letters.length + today.notes.length : 0;
  const unread = unreadCountOf(letters);
  const sel = selected ?? new Set<number>();
  const visibleIds = useMemo(
    () => [...(today ? idsOfDays([today]) : []), ...idsOfDays(shownDays(past, filter))],
    [today, past, filter],
  );
  const openOrToggle = (l: ApiLetter) => (selecting ? onToggle?.(l.id) : onOpen(l));

  return (
    <View>
      {selecting ? (
        <SelectBar count={sel.size} allOn={isAllSelected(visibleIds, sel)} unread={unread}
          onSelectAll={() => onSelectAll?.(visibleIds)} onCancel={() => onCancelSelect?.()}
          onReadAll={() => onReadAll?.()} onClearAll={() => onClearAll?.()} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {searching ? (
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, height: 40, borderRadius: 20, paddingHorizontal: 14, backgroundColor: theme.colors.surface }}>
              <Search size={16} color={theme.colors.textMuted} />
              <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="搜来信"
                placeholderTextColor={theme.colors.placeholder}
                style={{ flex: 1, fontSize: 14, color: theme.colors.textPrimary, paddingVertical: 0 }} />
            </View>
          ) : (
            <Text style={{ flex: 1, fontSize: 13, color: theme.colors.textMuted }}>
              {todayCount ? `今天 ${todayCount} 封` : "今天还没有信"}{unread ? ` · ${unread} 封没读` : ""}
            </Text>
          )}
          {!searching && letters.length > 0 && onEnterSelect && (
            <Pressable accessibilityRole="button" accessibilityLabel="整理来信" onPress={onEnterSelect}
              style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 38, paddingHorizontal: 13, borderRadius: 19, backgroundColor: theme.colors.surface }}>
              <ListChecks size={16} color={theme.colors.textSecondary} />
              <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>整理</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel={searching ? "关闭搜索" : "搜索来信"}
            onPress={() => { setSearching(s => !s); setQuery(""); }}
            style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface }}>
            {searching ? <X size={17} color={theme.colors.textSecondary} /> : <Search size={17} color={theme.colors.textSecondary} />}
          </Pressable>
        </View>
      )}

      {searching && !selecting ? <SearchResults letters={letters} query={query} onOpen={onOpen} /> : (
        <>
          {!selecting && header}
          {today && (
            <View style={{ marginTop: selecting ? 8 : 10 }}>
              <Text style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 8 }}>{dayLabel(today.key)}</Text>
              {today.letters.map(l => (
                <LetterCard key={l.id} letter={l} petName={petName} onPress={() => openOrToggle(l)}
                  selecting={selecting} selected={sel.has(l.id)} />
              ))}
              <NotesStack notes={today.notes} onOpen={openOrToggle} selecting={selecting} selected={sel} />
            </View>
          )}
          {past.length > 0 && (
            <PastTimeline days={past} filter={filter} onFilter={setFilter} onOpen={openOrToggle} onShowKept={onShowKept}
              selecting={selecting} selected={sel} />
          )}
          {letters.length === 0 && (
            <Text style={{ fontSize: 14, lineHeight: 22, color: theme.colors.textMuted, textAlign: "center", paddingVertical: 28 }}>
              还没有来信。有想告诉你的时候，{petName}会写来。
            </Text>
          )}
          {!selecting && (
            <Pressable onPress={onShowKept} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 18, paddingVertical: 8 }}>
              <Bookmark size={15} color={theme.colors.textSecondary} />
              <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>我留下的{keptCount ? ` ${keptCount} 封` : ""}</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}
