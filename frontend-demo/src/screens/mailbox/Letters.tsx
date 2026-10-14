/**
 * 读信：信纸（正文 + 附件）+ 一排轻量操作。
 *
 * 改版（2026-10-14，原型 docs/design/prototypes/mailbox-redesign）：
 * - 不再有「信封 → 拆开」的仪式，列表里点哪封就直接读哪封；
 * - 三个大按钮收成一排：主按钮「收到啦」，回一句 / 留下 变成图标；
 * - 「有句话」（scene_invite）按段落排：你说过 / 可以这样开口 / 对方可能会说 → 你可以接，
 *   信末「进去说说看」才去搭场景，进入原来的问答片场。
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Bookmark, Check, DoorOpen, Heart, MessageCircle, Music, Play, Reply } from "lucide-react-native";
import { GrainTexture, paperColors, useTheme } from "../../design-system";
import { ApiLetter, Rehearsal, _fmtLetterDate, letterKind, rehearsalOf } from "./shared";

const MOOD = "#7563DE";
const MOOD_SOFT = "rgba(236,232,253,0.9)";

/** 信中音乐附件：试听 + 收藏。 */
function LetterAttachment({ attachment, saved, onSave }: {
  attachment: NonNullable<ApiLetter["attachment"]>; saved: boolean; onSave: () => void;
}) {
  return (
    <View style={{
      marginTop: 20, borderRadius: 16, overflow: "hidden",
      backgroundColor: "rgba(249,241,204,0.55)", borderWidth: 1, borderColor: "rgba(255,255,255,0.55)",
    }}>
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <Music size={12} color="#B98232" />
          <Text style={{ fontSize: 12, fontWeight: "500", color: "#B98232" }}>{attachment.label ?? "信里夹了点什么"}</Text>
        </View>
        <Text style={{ fontSize: 14, fontWeight: "500", color: paperColors.ink2 }} numberOfLines={1}>{attachment.title}</Text>
        {!!attachment.artist && <Text style={{ fontSize: 12, marginTop: 2, color: paperColors.meta2 }}>{attachment.artist}</Text>}
        {!!attachment.reason && (
          <Text style={{ fontSize: 13, marginTop: 10, lineHeight: 19, color: paperColors.body }}>{attachment.reason}</Text>
        )}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <Pressable style={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
            backgroundColor: "rgba(246,231,168,0.72)",
          }}>
            <Play size={11} color={paperColors.ink2} />
            <Text style={{ fontSize: 13, fontWeight: "500", color: paperColors.ink2 }}>试听一下</Text>
          </Pressable>
          <Pressable onPress={onSave}
            style={{
              flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
              backgroundColor: saved ? "rgba(221,237,227,0.55)" : "rgba(255,255,255,0.5)",
            }}>
            <Heart size={11} color={saved ? "#5A8A6A" : paperColors.meta2} />
            <Text style={{ fontSize: 13, color: saved ? "#5A8A6A" : paperColors.meta2 }}>{saved ? "已留着" : "替我留着"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={{ fontSize: 12, fontWeight: "600", letterSpacing: 1, color: MOOD, marginBottom: 6 }}>{children}</Text>
  );
}

/** 「有句话」正文：你说过 / 可以这样开口 / 对方可能会说 → 你可以接。 */
function RehearsalBody({ r }: { r: Rehearsal }) {
  const theme = useTheme();
  const hand = [theme.typography.textStyles.petVoice, { color: paperColors.body }];
  const who = r.counterpart || "对方";
  return (
    <View style={{ gap: 18 }}>
      {!!r.lead && <Text style={[hand, { fontSize: 17, lineHeight: 28 }]}>{r.lead}</Text>}
      {!!r.quote && (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <MessageCircle size={13} color={MOOD} />
            <Text style={{ fontSize: 12, fontWeight: "600", letterSpacing: 1, color: MOOD }}>你说过</Text>
          </View>
          <View style={{ backgroundColor: MOOD_SOFT, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Text style={[hand, { fontSize: 16, lineHeight: 26, color: paperColors.ink2 }]}>“{r.quote}”</Text>
          </View>
        </View>
      )}
      <View>
        <SectionLabel>可以这样开口</SectionLabel>
        {r.openers.map((s, i) => (
          <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: "#D8D0F6", paddingLeft: 12, marginVertical: 4 }}>
            <Text style={[hand, { fontSize: 16, lineHeight: 26 }]}>“{s}”</Text>
          </View>
        ))}
      </View>
      {r.replies.length > 0 && (
        <View style={{ gap: 10 }}>
          <SectionLabel>{`${who}可能会说`}</SectionLabel>
          {r.replies.map((x, i) => (
            <View key={i}>
              <Text style={{ fontSize: 14, lineHeight: 22, fontWeight: "600", color: paperColors.ink2 }}>“{x.they}”</Text>
              <Text style={{ fontSize: 14, lineHeight: 22, color: paperColors.sub }}>你可以接：{x.you}</Text>
            </View>
          ))}
        </View>
      )}
      {!!r.closing && <Text style={[hand, { fontSize: 16, lineHeight: 26 }]}>{r.closing}</Text>}
    </View>
  );
}

/** 信末入口：点了才搭场景，进入问答片场。 */
function EnterSceneButton({ onEnter, entering, counterpart }: { onEnter?: () => void; entering?: boolean; counterpart?: string }) {
  const theme = useTheme();
  return (
    <View style={{ marginTop: 20 }}>
      <Pressable onPress={onEnter} disabled={!onEnter || entering}
        accessibilityRole="button" accessibilityLabel="进去说说看"
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18,
          backgroundColor: theme.colors.accent, opacity: entering ? 0.85 : 1,
          transform: [{ scale: pressed && !entering ? 0.98 : 1 }],
        })}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" }}>
          {entering ? <ActivityIndicator color="#fff" size="small" /> : <DoorOpen size={18} color="#fff" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: theme.colors.textOnAccent }}>
            {entering ? "正在搭场景…" : "进去说说看"}
          </Text>
          <Text style={{ fontSize: 12, marginTop: 2, color: "rgba(255,255,255,0.75)" }}>
            {entering ? "搭好就进去，大概十几秒" : `搭一个小场景，和${counterpart || "对方"}练一遍`}
          </Text>
        </View>
      </Pressable>
      <Text style={{ textAlign: "center", fontSize: 12, marginTop: 10, color: paperColors.meta2 }}>
        点了才搭场景；不想练，看完这封信就够了。
      </Text>
    </View>
  );
}

function IconAction({ label, active, onPress, children }: { label: string; active?: boolean; onPress?: () => void; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({
        width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center",
        backgroundColor: active ? "rgba(226,97,64,0.10)" : theme.colors.surface,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}>
      {children}
    </Pressable>
  );
}

/** 信纸：抬头（日期时分 + 标题）+ 正文 / 有句话 + 附件 + 一排操作。 */
export function LetterPaper({ letter, petName, saved, onAck, acking, acked, onReply, onSave, onEnterScene, entering, onGotoKeepsakes }: {
  letter: ApiLetter; petName: string;
  saved: boolean; onAck: () => void; acking?: boolean; acked?: boolean;
  onReply: () => void; onSave: () => void;
  onEnterScene?: () => void; entering?: boolean;
  onGotoKeepsakes?: () => void;
}) {
  const [attachSaved, setAttachSaved] = useState(false);
  const theme = useTheme();
  const kind = letterKind(letter);
  const rehearsal = kind === "rehearse" ? rehearsalOf(letter) : null;
  const paras = letter.body.split("\n").filter(p => p.trim());
  const musicAttachment = letter.attachment && kind !== "rehearse" && letter.attachment.title ? letter.attachment : null;

  return (
    <View>
      <View style={{
        borderRadius: 22, overflow: "hidden",
        backgroundColor: "rgba(255,253,247,0.98)", borderWidth: 1, borderColor: "rgba(255,255,255,0.6)",
      }}>
        <GrainTexture />
        <View style={{ padding: 22 }}>
          <Text style={{ fontSize: 12.5, color: paperColors.meta2 }}>{_fmtLetterDate(letter.created_at)}</Text>
          <Text style={[theme.typography.textStyles.emotionalTitle, { fontSize: 22, lineHeight: 32, marginTop: 4, marginBottom: 16, color: paperColors.ink2 }]}>
            {letter.title}
          </Text>

          {rehearsal ? <RehearsalBody r={rehearsal} /> : (
            <View style={{ gap: 14 }}>
              {paras.map((para, i) => (
                <Text key={i} style={[theme.typography.textStyles.petVoice, { fontSize: 17, lineHeight: 29, color: paperColors.body }]}>{para}</Text>
              ))}
            </View>
          )}

          {musicAttachment && (
            <LetterAttachment attachment={musicAttachment} saved={attachSaved} onSave={() => setAttachSaved(s => !s)} />
          )}

          <Text style={[theme.typography.textStyles.petVoice, { fontSize: 16, textAlign: "right", marginTop: 16, color: paperColors.meta2 }]}>
            —— {petName}
          </Text>
        </View>
      </View>

      {kind === "rehearse" && (
        <EnterSceneButton onEnter={onEnterScene} entering={entering} counterpart={rehearsal?.counterpart} />
      )}

      {/* 一排操作：主按钮收到啦 + 回一句 / 留下 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 }}>
        <Pressable onPress={onAck} disabled={!!acking || !!acked}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flex: 1, height: 46, borderRadius: 23, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            // 有句话的主角是「进去说说看」，收到啦退成浅色，避免两个深色按钮抢
            backgroundColor: acked || kind === "rehearse" ? theme.colors.accentSoft : theme.colors.accent,
            opacity: acking ? 0.7 : 1,
            transform: [{ scale: pressed && !acking && !acked ? 0.98 : 1 }],
          })}>
          <Check size={16} color={acked || kind === "rehearse" ? theme.colors.accent : theme.colors.textOnAccent} />
          <Text style={{ fontSize: 15, fontWeight: "600", color: acked || kind === "rehearse" ? theme.colors.accent : theme.colors.textOnAccent }}>
            {acked ? `${petName}知道啦` : acking ? "正在告诉它…" : "收到啦"}
          </Text>
        </Pressable>
        <IconAction label="回它一句" onPress={onReply}>
          <Reply size={18} color={theme.colors.textSecondary} />
        </IconAction>
        <IconAction label={saved ? "已经留下" : "把这封信留下"} active={saved} onPress={saved ? onGotoKeepsakes : onSave}>
          <Bookmark size={18} color={saved ? "#E26140" : theme.colors.textSecondary} fill={saved ? "#E26140" : "transparent"} />
        </IconAction>
      </View>
      <Text style={{ textAlign: "center", fontSize: 12, marginTop: 12, color: theme.colors.textMuted }}>
        {saved ? "已经替你收好，在「我留下的」里" : "不留下的话，它会安静地待在往期里。"}
      </Text>
    </View>
  );
}
