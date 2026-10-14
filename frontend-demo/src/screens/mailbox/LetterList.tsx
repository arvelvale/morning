/**
 * 信箱列表（改版 2026-10-14，原型 docs/design/prototypes/mailbox-redesign）：
 * - 今天：正经的信单独成卡（标题 + 两行预览 + 谁写的 + 几点）；一两句话的小纸条叠成一叠，点开再展开；
 * - 往期：按类型筛选 + 按天分组（显示时分），每天的小纸条只留一行「+N 张小纸条」；
 * - 右上角搜索：按标题和正文找。
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Bookmark, ChevronDown, ChevronUp, Mail, MessageCircle, Search, Sparkles, StickyNote, X } from "lucide-react-native";
import { paperColors, useTheme } from "../../design-system";
import {
  ApiLetter, LETTER_KIND_LABEL, LetterDay, LetterKind,
  dayKey, dayLabel, groupLettersByDay, letterClock, letterKind, matchLetter,
} from "./shared";

const KIND_TONE: Record<LetterKind, { fg: string; bg: string }> = {
  evening: { fg: "#C98E00", bg: "#FBEFC8" },
  rehearse: { fg: "#7563DE", bg: "#ECE8FD" },
  weekly: { fg: "#23917A", bg: "#D8F0E7" },
  note: { fg: "#C98E00", bg: "#FBEFC8" },
  other: { fg: "#8C8187", bg: "#F1ECE4" },
};

function KindIcon({ kind, size = 16 }: { kind: LetterKind; size?: number }) {
  const c = KIND_TONE[kind].fg;
  if (kind === "rehearse") return <MessageCircle size={size} color={c} />;
  if (kind === "weekly") return <Sparkles size={size} color={c} />;
  if (kind === "note") return <StickyNote size={size} color={c} />;
  return <Mail size={size} color={c} />;
}

/** 今天的信：一张卡，两行预览。 */
function LetterCard({ letter, petName, onPress }: { letter: ApiLetter; petName: string; onPress: () => void }) {
  const theme = useTheme();
  const kind = letterKind(letter);
  const tone = KIND_TONE[kind];
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${LETTER_KIND_LABEL[kind]}：${letter.title}`}
      style={({ pressed }) => ({
        borderRadius: 18, padding: 16, marginBottom: 10,
        backgroundColor: kind === "rehearse" ? "#FBF8FF" : "rgba(255,252,246,0.98)",
        borderWidth: 1, borderColor: kind === "rehearse" ? "#E4DEFA" : "rgba(255,255,255,0.6)",
        transform: [{ scale: pressed ? 0.985 : 1 }], ...theme.shadows.soft,
      })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: tone.bg }}>
          <Text style={{ fontSize: 11, color: tone.fg, fontWeight: "500" }}>{LETTER_KIND_LABEL[kind]}</Text>
        </View>
        <Text style={{ fontSize: 12, color: paperColors.meta2, flex: 1 }}>{petName} · {letterClock(letter)}</Text>
        {!letter.is_read && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#E26140" }} />}
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

/** 一叠小纸条：默认收起，点开展开成一行一张。 */
function NotesStack({ notes, onOpen }: { notes: ApiLetter[]; onOpen: (l: ApiLetter) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (notes.length === 0) return null;
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
      <Pressable onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${notes.length} 张小纸条，${open ? "收起" : "展开"}`}
        style={{
          flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingHorizontal: 14,
          borderRadius: 14, backgroundColor: "#FFFDF8",
        }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: KIND_TONE.note.bg }}>
          <StickyNote size={16} color={KIND_TONE.note.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: paperColors.ink2 }}>
            {notes.length} 张小纸条{unread ? ` · ${unread} 张没看` : ""}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: paperColors.meta2 }}>{titles}</Text>
        </View>
        <Text style={{ fontSize: 12, color: theme.colors.textMuted }}>{open ? "收起" : "展开"}</Text>
        {open ? <ChevronUp size={14} color={theme.colors.textMuted} /> : <ChevronDown size={14} color={theme.colors.textMuted} />}
      </Pressable>
      {open && notes.map(n => (
        <Pressable key={n.id} onPress={() => onOpen(n)}
          style={({ pressed }) => ({
            flexDirection: "row", gap: 10, paddingVertical: 11, paddingLeft: 54, paddingRight: 14,
            borderBottomWidth: 1, borderBottomColor: theme.colors.divider, borderStyle: "dashed",
            opacity: pressed ? 0.7 : 1,
          })}>
          <Text style={{ width: 40, fontSize: 12, lineHeight: 21, color: theme.colors.textMuted }}>{letterClock(n)}</Text>
          <Text numberOfLines={2} style={{ flex: 1, fontSize: 13.5, lineHeight: 21, color: n.is_read ? paperColors.sub : paperColors.ink2 }}>
            {n.body.replace(/\s+/g, " ")}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function PastRow({ letter, onPress }: { letter: ApiLetter; onPress: () => void }) {
  const theme = useTheme();
  const kind = letterKind(letter);
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: theme.colors.divider, opacity: pressed ? 0.7 : 1,
      })}>
      <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: KIND_TONE[kind].bg }}>
        <KindIcon kind={kind} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[theme.typography.textStyles.emotionalTitle, { fontSize: 16, lineHeight: 23, color: paperColors.ink2 }]}>
          {letter.title}
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.textMuted }}>{LETTER_KIND_LABEL[kind]}</Text>
      </View>
      <Text style={{ fontSize: 12, color: theme.colors.textMuted }}>{letterClock(letter)}</Text>
      {!letter.is_read && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#E26140" }} />}
    </Pressable>
  );
}

type Filter = "all" | LetterKind | "kept";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" }, { id: "evening", label: "晚间信" }, { id: "rehearse", label: "有句话" },
  { id: "weekly", label: "周报" }, { id: "note", label: "小纸条" }, { id: "kept", label: "我留下的" },
];

/** 往期：筛选 + 按天分组。筛「小纸条」时纸条逐张列出；其余筛选下每天的纸条收成一行。 */
function PastTimeline({ days, onOpen, onShowKept }: {
  days: LetterDay[]; onOpen: (l: ApiLetter) => void; onShowKept: () => void;
}) {
  const theme = useTheme();
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const shown = days.map(d => {
    if (filter === "note") return { ...d, letters: d.notes, notes: [] };
    if (filter === "all") return d;
    return { ...d, letters: d.letters.filter(l => letterKind(l) === filter), notes: [] };
  }).filter(d => d.letters.length > 0 || d.notes.length > 0);

  return (
    <View style={{ marginTop: 22 }}>
      <Text style={{ fontSize: 12, letterSpacing: 0.5, color: theme.colors.textMuted, marginBottom: 8 }}>往期</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
        {FILTERS.map(f => (
          <Pressable key={f.id} onPress={() => (f.id === "kept" ? onShowKept() : setFilter(f.id))}
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
        const open = expandedDays.has(d.key);
        return (
          <View key={d.key} style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 8 }}>{dayLabel(d.key)}</Text>
            {d.letters.map(l => <PastRow key={l.id} letter={l} onPress={() => onOpen(l)} />)}
            {d.notes.length > 0 && !open && (
              <Pressable onPress={() => setExpandedDays(s => new Set(s).add(d.key))} style={{ paddingVertical: 9, paddingLeft: 44 }}>
                <Text style={{ fontSize: 12, color: theme.colors.textMuted }}>+ {d.notes.length} 张小纸条</Text>
              </Pressable>
            )}
            {open && d.notes.map(l => <PastRow key={l.id} letter={l} onPress={() => onOpen(l)} />)}
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

export function LetterList({ letters, petName, header, keptCount, onOpen, onShowKept }: {
  letters: ApiLetter[];
  petName: string;
  /** 顶部插槽：今晚的信横幅 */
  header?: React.ReactNode;
  keptCount: number;
  onOpen: (l: ApiLetter) => void;
  onShowKept: () => void;
}) {
  const theme = useTheme();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const days = useMemo(() => groupLettersByDay(letters), [letters]);
  const todayKey = dayKey(new Date());
  const today = days.find(d => d.key === todayKey) ?? null;
  const past = days.filter(d => d.key !== todayKey);
  const todayCount = today ? today.letters.length + today.notes.length : 0;
  const unread = letters.filter(l => !l.is_read).length;

  return (
    <View>
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
        <Pressable accessibilityRole="button" accessibilityLabel={searching ? "关闭搜索" : "搜索来信"}
          onPress={() => { setSearching(s => !s); setQuery(""); }}
          style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface }}>
          {searching ? <X size={17} color={theme.colors.textSecondary} /> : <Search size={17} color={theme.colors.textSecondary} />}
        </Pressable>
      </View>

      {searching ? <SearchResults letters={letters} query={query} onOpen={onOpen} /> : (
        <>
          {header}
          {today && (
            <View>
              <Text style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 8 }}>{dayLabel(today.key)}</Text>
              {today.letters.map(l => <LetterCard key={l.id} letter={l} petName={petName} onPress={() => onOpen(l)} />)}
              <NotesStack notes={today.notes} onOpen={onOpen} />
            </View>
          )}
          {past.length > 0 && <PastTimeline days={past} onOpen={onOpen} onShowKept={onShowKept} />}
          {letters.length === 0 && (
            <Text style={{ fontSize: 14, lineHeight: 22, color: theme.colors.textMuted, textAlign: "center", paddingVertical: 28 }}>
              还没有来信。有想告诉你的时候，{petName}会写来。
            </Text>
          )}
          <Pressable onPress={onShowKept} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 18, paddingVertical: 8 }}>
            <Bookmark size={15} color={theme.colors.textSecondary} />
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>我留下的{keptCount ? ` ${keptCount} 封` : ""}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
