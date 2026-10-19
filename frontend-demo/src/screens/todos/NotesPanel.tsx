/**
 * 「随手记」：倾倒整理出的 灵感 / 情绪 / 记下的瞬间，批注式单列，不堆卡片。
 * 原先在信箱的「思绪」分区里，2026-10 起搬到「待办」Tab；信箱只放信。
 *
 * - 带保存期的（后端 ephemeral，默认一个月）可随时珍藏或放下；
 * - 「记下的瞬间」可以点开：看整理后的话、你当时说的原话（后端有 evidence 才显示）、记下的日期时分。
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Archive, ChevronRight } from "lucide-react-native";

import { Button, EmptyState, ResponsiveOverlay, useTheme } from "../../design-system";
import {
  dropEphemeral, keepEphemeral, listCandidates, listEphemeral, listIdeas,
} from "../../api";
import { remainText } from "../mailbox/shared";
import { buildNotes, clockText, momentTime, SEAL_LABEL, type NoteRow } from "./notesLogic";

export function NotesPanel({ onToast }: { onToast?: (msg: string) => void }) {
  const theme = useTheme();
  const [ideas, setIdeas] = useState<any[]>([]);
  const [ephem, setEphem] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [opened, setOpened] = useState<NoteRow | null>(null);

  useEffect(() => {
    const load = async (fn: () => Promise<any>, set: (v: any[]) => void) => {
      try {
        const list = await fn();
        set(Array.isArray(list) ? list : []);
      } catch { /* 网络异常保持当前列表 */ }
    };
    void load(listIdeas, setIdeas);
    void load(listEphemeral, setEphem);
    void load(listCandidates, setCandidates);
  }, []);

  const rows = useMemo(() => buildNotes(ideas, ephem, candidates), [ideas, ephem, candidates]);
  const sealCounts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.seal] = (acc[r.seal] || 0) + 1;
    return acc;
  }, {});

  const keep = (row: NoteRow) => {
    setEphem((list) => list.filter((e) => e.id !== row.id));
    keepEphemeral(row.id).then(() => onToast?.("已替你收进「我留下的」")).catch(() => {});
  };
  const drop = (row: NoteRow) => {
    setEphem((list) => list.filter((e) => e.id !== row.id));
    setCandidates((list) => list.filter((e) => e.id !== row.id));
    dropEphemeral(row.id).catch(() => {});
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Archive color={theme.colors.textMuted} size={24} />}
        title="随手记还空着"
        description="倒出来的灵感、心情和记下的瞬间，整理后会来到这里。"
      />
    );
  }

  return (
    <>
      {/* 图例：单字章含义与条数 */}
      <View style={{ flexDirection: "row", gap: theme.spacing[5], marginBottom: theme.spacing[4] }}>
        {(["想", "情", "瞬"] as const).filter((s) => sealCounts[s]).map((s) => (
          <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
            <Seal char={s} size={26} />
            <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted }]}>
              {SEAL_LABEL[s]} · {sealCounts[s]}
            </Text>
          </View>
        ))}
      </View>

      {rows.map((row) => {
        const body = (
          <>
            <Seal char={row.seal} size={28} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={[theme.typography.textStyles.body, { color: theme.colors.textPrimary }]}>{row.text}</Text>
              {!!metaOf(row) && (
                <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted, marginTop: 2 }]}>
                  {metaOf(row)}
                </Text>
              )}
              {row.keepable && (
                <View style={{ flexDirection: "row", gap: theme.spacing[4], marginTop: theme.spacing[2] }}>
                  <Pressable onPress={() => keep(row)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                    <Text style={[theme.typography.textStyles.caption, { color: theme.colors.accent, fontWeight: "500" }]}>珍藏</Text>
                  </Pressable>
                  <Pressable onPress={() => drop(row)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                    <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted }]}>放下</Text>
                  </Pressable>
                </View>
              )}
            </View>
            {row.seal === "瞬" ? <ChevronRight color={theme.colors.textMuted} size={16} style={{ marginTop: 6 }} /> : null}
          </>
        );
        const rowStyle = {
          flexDirection: "row" as const, alignItems: "flex-start" as const, gap: theme.spacing[3],
          paddingVertical: theme.spacing[3], borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
        };
        // 瞬间整行可点开；其余是静态行。行内的「珍藏 / 放下」是嵌套的小按钮，点它们不会触发整行
        return row.seal === "瞬" ? (
          <Pressable
            accessibilityHint="点开看看当时记下了什么"
            accessibilityRole="button"
            key={row.key}
            onPress={() => setOpened(row)}
            style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.7 : 1 }]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={row.key} style={rowStyle}>{body}</View>
        );
      })}
      <Text style={[theme.typography.textStyles.label, { color: theme.colors.textMuted, marginTop: theme.spacing[4], textAlign: "center" }]}>
        没做决定的会保留一个月，到期轻轻放下
      </Text>

      {opened ? <MomentDetail onClose={() => setOpened(null)} row={opened} /> : null}
    </>
  );
}

/** 行下的小字：寄存的写剩余保存时间；候选瞬间写记下的时间；灵感写「灵感」。 */
function metaOf(row: NoteRow): string {
  if (row.expiresAt) return remainText(row.expiresAt);
  const at = momentTime(row.createdAt);
  if (row.seal === "瞬") return at ? clockText(at) : "";
  return row.seal === "想" ? "灵感" : "";
}

/** 单字章。 */
function Seal({ char, size, style }: { char: string; size: number; style?: object }) {
  const theme = useTheme();
  return (
    <View style={[{
      width: size, height: size, borderRadius: 4, borderWidth: 1, borderColor: theme.colors.border,
      alignItems: "center", justifyContent: "center",
    }, style]}>
      <Text style={{ fontSize: size <= 26 ? 13 : 14, color: theme.colors.accent }}>{char}</Text>
    </View>
  );
}

/** 「记下的瞬间」详情：整理后的话 + 你当时说的（有才显示）+ 日期时分。不能编辑。 */
function MomentDetail({ row, onClose }: { row: NoteRow; onClose: () => void }) {
  const theme = useTheme();
  const at = momentTime(row.createdAt);
  return (
    <ResponsiveOverlay onClose={onClose} title="记下的瞬间" visible>
      <View style={{ paddingHorizontal: theme.spacing[5], paddingTop: theme.spacing[4], paddingBottom: theme.spacing[6], gap: theme.spacing[4] }}>
        {at ? (
          <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted }]}>{clockText(at)}</Text>
        ) : null}
        <Text style={[theme.typography.textStyles.body, { fontSize: 17, lineHeight: 27, color: theme.colors.textPrimary }]}>
          {row.text}
        </Text>
        {row.evidence ? (
          <View style={{
            gap: theme.spacing[1], paddingLeft: theme.spacing[4], paddingVertical: theme.spacing[1],
            borderLeftWidth: 2, borderLeftColor: theme.colors.border,
          }}>
            <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textMuted }]}>你当时说</Text>
            <Text style={[theme.typography.textStyles.body, { color: theme.colors.textSecondary }]}>{row.evidence}</Text>
          </View>
        ) : null}
        <Button fullWidth onPress={onClose} variant="secondary">收起</Button>
      </View>
    </ResponsiveOverlay>
  );
}
