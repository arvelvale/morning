/**
 * 桌宠来信：信封（未拆封）→ 信纸（拆开后）+ 音乐/场景邀请附件 + 等待态。
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Film, Heart, Music, Play } from "lucide-react-native";
import { CreamRipple, GrainTexture, paperColors } from "../../design-system";
import {
  ApiLetter,
  LetterState,
  SceneInviteAttachment,
  _fmtLetterDate,
  isSceneInvite,
  useMailboxSurface,
} from "./shared";

/** 未拆封信封：轻点触发涟漪并拆开。 */
function SealedEnvelope({ letter, onOpen, isOpening }: {
  letter: ApiLetter; onOpen: () => void; isOpening: boolean;
}) {
  const { C } = useMailboxSurface();
  const [showRipple, setShowRipple] = useState(false);
  // 涟漪计时器：存 ref 并在卸载时清理，避免卸载后 setState 警告
  const rippleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (rippleTimer.current) clearTimeout(rippleTimer.current); }, []);
  const handleTap = () => {
    setShowRipple(true);
    if (rippleTimer.current) clearTimeout(rippleTimer.current);
    rippleTimer.current = setTimeout(() => setShowRipple(false), 700);
    onOpen();
  };
  return (
    <Pressable onPress={handleTap} style={({ pressed }) => [{ alignItems: "center", transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <CreamRipple active={showRipple} />
      <View style={{
        width: 320, height: 205, borderRadius: 22, overflow: "hidden",
        backgroundColor: "rgba(252,247,225,0.96)", borderWidth: 1, borderColor: "rgba(255,255,255,0.58)",
      }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 20 }}>
          <View style={{ alignItems: "flex-end", marginBottom: 14 }}>
            <View style={{
              width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center",
              backgroundColor: isSceneInvite(letter) ? "rgba(243,218,202,0.75)" : "rgba(246,231,168,0.72)",
              borderWidth: 1, borderColor: "rgba(255,255,255,0.55)",
            }}>
              {isSceneInvite(letter)
                ? <Film size={16} color="#A26458" />
                : <Text style={{ fontSize: 17 }}>🌿</Text>}
            </View>
          </View>
          {isSceneInvite(letter) && (
            <View style={{ alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginBottom: 6, backgroundColor: "rgba(243,218,202,0.5)" }}>
              <Text style={{ fontSize: 10, fontWeight: "500", letterSpacing: 1, color: "#A26458" }}>场景邀请</Text>
            </View>
          )}
          <Text style={{ fontSize: 16, fontWeight: "500", marginBottom: 6, color: paperColors.ink2 }}>{letter.title}</Text>
          <Text style={{ fontSize: 12, marginBottom: 5, color: paperColors.meta2 }}>{_fmtLetterDate(letter.created_at)}</Text>
          <Text style={{ fontSize: 12, color: paperColors.dim }} numberOfLines={1}>{letter.body.slice(0, 24)}…</Text>
        </View>
        {/* 信封下折角近似 */}
        <View style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 54,
          backgroundColor: "rgba(243,216,199,0.20)",
        }} />
      </View>
      {!isOpening && (
        <Text style={{ marginTop: 20, fontSize: 13, letterSpacing: 0.3, color: C.muted }}>轻点拆开</Text>
      )}
    </Pressable>
  );
}

/** 信中音乐附件：试听 + 收藏。 */
function LetterAttachment({ attachment, saved, onSave }: {
  attachment: NonNullable<ApiLetter["attachment"]>; saved: boolean; onSave: () => void;
}) {
  return (
    <View style={{
      marginVertical: 20, borderRadius: 18, overflow: "hidden",
      backgroundColor: "rgba(249,241,204,0.55)", borderWidth: 1, borderColor: "rgba(255,255,255,0.55)",
    }}>
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <Music size={12} color="#B98232" />
          <Text style={{ fontSize: 12, fontWeight: "500", color: "#B98232" }}>{attachment.label ?? "信里夹了点什么"}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{
            width: 48, height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center",
            backgroundColor: "rgba(246,231,168,0.65)", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)",
          }}>
            <Music size={20} color="#B98232" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "500", color: paperColors.ink2 }} numberOfLines={1}>{attachment.title}</Text>
            {!!attachment.artist && <Text style={{ fontSize: 12, marginTop: 2, color: paperColors.meta2 }}>{attachment.artist}</Text>}
          </View>
        </View>
        {!!attachment.reason && (
          <Text style={{ fontSize: 13, marginTop: 12, lineHeight: 19, color: paperColors.body }}>{attachment.reason}</Text>
        )}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <Pressable style={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
            backgroundColor: "rgba(246,231,168,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)",
          }}>
            <Play size={11} color={paperColors.ink2} />
            <Text style={{ fontSize: 13, fontWeight: "500", color: paperColors.ink2 }}>试听一下</Text>
          </Pressable>
          <Pressable onPress={onSave}
            style={{
              flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
              backgroundColor: saved ? "rgba(221,237,227,0.55)" : "rgba(255,255,255,0.5)",
              borderWidth: 1, borderColor: "rgba(255,255,255,0.45)",
            }}>
            <Heart size={11} color={saved ? "#5A8A6A" : paperColors.meta2} />
            <Text style={{ fontSize: 13, color: saved ? "#5A8A6A" : paperColors.meta2 }}>{saved ? "已留着" : "替我留着"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** scene_invite 场景邀请卡：Film 图标 + 场景种子摘要 + 「进入场景」按钮 */
function SceneInviteCard({ attachment, onEnter, entering }: {
  attachment: SceneInviteAttachment; onEnter?: () => void; entering?: boolean;
}) {
  const seed = attachment.seed || {};
  const people = Array.isArray(seed.people) ? seed.people.filter(Boolean).join("、") : "";
  return (
    <View style={{
      marginVertical: 20, borderRadius: 18, overflow: "hidden",
      backgroundColor: "rgba(243,218,202,0.4)", borderWidth: 1, borderColor: "rgba(255,255,255,0.55)",
    }}>
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <Film size={12} color="#A26458" />
          <Text style={{ fontSize: 12, fontWeight: "500", color: "#A26458" }}>为你备好了一个小场景</Text>
        </View>
        {!!seed.title && (
          <Text style={{ fontSize: 14, fontWeight: "500", marginBottom: 6, color: paperColors.ink2 }}>{seed.title}</Text>
        )}
        {(!!seed.place || !!people) && (
          <Text style={{ fontSize: 12, marginBottom: 6, color: paperColors.meta2 }}>
            {[seed.place, people].filter(Boolean).join(" · ")}
          </Text>
        )}
        {!!seed.plot && (
          <Text style={{ fontSize: 13, lineHeight: 19, marginBottom: 12, color: paperColors.body }}>{seed.plot}</Text>
        )}
        <Pressable onPress={onEnter} disabled={!onEnter || entering}
          style={({ pressed }) => [{
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
            paddingVertical: 12, borderRadius: 999,
            backgroundColor: entering ? "rgba(246,225,143,0.4)" : "rgba(246,225,143,0.82)",
            borderWidth: 1, borderColor: "rgba(255,255,255,0.5)",
            transform: [{ scale: pressed ? 0.97 : 1 }],
          }]}>
          <Play size={12} color="#6E5A28" />
          <Text style={{ fontSize: 14, fontWeight: "500", color: "#6E5A28" }}>
            {entering ? "正在布置场景…" : "进入场景"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** 拆开后的信纸：正文段落 + 附件 + 收到/回信/珍藏操作。 */
function LetterPaper({ letter, petName, saved, onAck, acking, acked, onReply, onSave, onEnterScene, entering, onGotoKeepsakes }: {
  letter: ApiLetter; petName: string;
  saved: boolean; onAck: () => void; acking?: boolean; acked?: boolean;
  onReply: () => void; onSave: () => void;
  onEnterScene?: () => void; entering?: boolean;
  onGotoKeepsakes?: () => void;
}) {
  const [attachSaved, setAttachSaved] = useState(false);
  const sceneInvite = isSceneInvite(letter);
  const paras = letter.body.split("\n").filter(p => p.trim());
  return (
    <View style={{
      borderRadius: 24, overflow: "hidden",
      backgroundColor: "rgba(255,253,247,0.96)", borderWidth: 1, borderColor: "rgba(255,255,255,0.6)",
    }}>
      <GrainTexture />
      {/* 信纸左侧边线 */}
      <View style={{ position: "absolute", left: 44, top: 0, bottom: 0, width: 1, backgroundColor: "rgba(243,216,199,0.3)" }} />
      <View style={{ padding: 24 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <View>
            <Text style={{ fontSize: 12, marginBottom: 4, color: paperColors.meta2 }}>{_fmtLetterDate(letter.created_at)}</Text>
            <Text style={{ fontSize: 20, fontWeight: "500", color: paperColors.ink2 }}>{letter.title}</Text>
          </View>
          <View style={{
            width: 38, height: 38, borderRadius: 8, alignItems: "center", justifyContent: "center",
            backgroundColor: "rgba(246,231,168,0.6)", borderWidth: 1.5, borderColor: "rgba(196,149,58,0.3)", borderStyle: "dashed",
          }}>
            <Text style={{ fontSize: 18 }}>🌿</Text>
          </View>
        </View>

        <View style={{ gap: 16 }}>
          {paras.map((para, i) => (
            <Text key={i} style={{ fontSize: 15, lineHeight: 25, color: paperColors.body }}>{para}</Text>
          ))}
        </View>

        {letter.attachment && sceneInvite && (
          <SceneInviteCard attachment={letter.attachment as SceneInviteAttachment}
            onEnter={onEnterScene} entering={entering} />
        )}
        {letter.attachment && !sceneInvite && (
          <LetterAttachment attachment={letter.attachment} saved={attachSaved} onSave={() => setAttachSaved(s => !s)} />
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <Text style={{ fontSize: 15, fontStyle: "italic", letterSpacing: 0.5, color: paperColors.meta2 }}>{petName}</Text>
          <View style={{ width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(243,216,199,0.45)" }}>
            <Text style={{ fontSize: 14 }}>✦</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={{ marginTop: 24, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={onAck} disabled={!!acking || !!acked}
              style={({ pressed }) => [{
                flex: 1, paddingVertical: 12, borderRadius: 999, alignItems: "center",
                backgroundColor: acked ? "rgba(221,237,227,0.55)" : acking ? "rgba(246,231,168,0.4)" : "rgba(246,231,168,0.75)",
                borderWidth: 1, borderColor: "rgba(255,255,255,0.5)",
                opacity: acked ? 0.7 : 1,
                transform: [{ scale: pressed && !acking && !acked ? 0.97 : 1 }],
              }]}>
              <Text style={{ fontSize: 14, fontWeight: "500", color: acked ? "#5A8A6A" : paperColors.ink2 }}>
                {acked ? "✓ 已收到" : acking ? "正在告诉它…" : "收到啦"}
              </Text>
            </Pressable>
            <Pressable onPress={onReply}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 999, alignItems: "center", backgroundColor: "rgba(255,252,245,0.7)", borderWidth: 1, borderColor: "rgba(255,255,255,0.45)" }}>
              <Text style={{ fontSize: 14, color: paperColors.body }}>回它一句</Text>
            </Pressable>
          </View>
          <Pressable onPress={onSave}
            style={{
              paddingVertical: 12, borderRadius: 999, alignItems: "center",
              backgroundColor: saved ? "rgba(221,237,227,0.55)" : "rgba(255,252,245,0.6)",
              borderWidth: 1, borderColor: "rgba(255,255,255,0.4)",
            }}>
            <Text style={{ fontSize: 14, color: saved ? "#5A8A6A" : paperColors.meta2 }}>
              {saved ? "✓ 已经替你收好" : "把这封信留下"}
            </Text>
          </Pressable>
          {!saved && (
            <Text style={{ textAlign: "center", fontSize: 11, marginTop: 8, lineHeight: 16, color: paperColors.meta2 }}>
              如果不留下，它会在明天的新信到达时离开。
            </Text>
          )}
          {saved && (
            <Pressable onPress={onGotoKeepsakes} style={{ alignItems: "center", marginTop: 8 }}>
              <Text style={{ fontSize: 12, color: paperColors.dim }}>去「我留下的」看看</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

/** 今天还没有来信时的等待态。 */
function WaitingLetterState() {
  const { C } = useMailboxSurface();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 20 }}>
      <View style={{
        width: 120, height: 80, borderRadius: 14, alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(255,252,245,0.65)", borderWidth: 1, borderColor: "rgba(255,255,255,0.45)",
      }}>
        <Text style={{ fontSize: 28 }}>✉️</Text>
      </View>
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontSize: 15, fontWeight: "500", marginBottom: 6, color: C.text }}>今天的信还在路上</Text>
        <Text style={{ fontSize: 13, lineHeight: 19, color: C.muted }}>有想告诉你的时候，它会送来。</Text>
      </View>
    </View>
  );
}

/** 来信主视图：按 letterState 在等待/信封/信纸之间切换。letter 为当前展示的信件。 */
export function DailyLetterView({ letter, petName, letterState, onReply, onOpenLetter, onSaveLetter, onAckLetter, acking, ackedIds, onEnterScene, entering, onGotoKeepsakes }: {
  letter: ApiLetter | null; petName: string; letterState: LetterState;
  onReply: () => void; onOpenLetter: () => void; onSaveLetter: () => void; onAckLetter: () => void;
  acking?: boolean; ackedIds?: Set<number>;
  onEnterScene?: (letter: ApiLetter) => void; entering?: boolean;
  onGotoKeepsakes?: () => void;
}) {
  const saved = letterState === "saved";
  const isOpening = letterState === "opening";
  const showEnvelope = letter != null && (letterState === "sealed" || letterState === "opening");
  const showLetter = letter != null && (letterState === "opened" || letterState === "saved");

  return (
    <View>
      {(letter == null || letterState === "waiting") && <WaitingLetterState />}
      {showEnvelope && (
        <View style={{ alignItems: "center", paddingVertical: 32 }}>
          <SealedEnvelope letter={letter} onOpen={onOpenLetter} isOpening={isOpening} />
        </View>
      )}
      {showLetter && (
        <LetterPaper letter={letter} petName={petName} saved={saved}
          onAck={onAckLetter} acking={acking} acked={ackedIds?.has(letter.id) ?? false}
          onReply={onReply} onSave={onSaveLetter}
          onEnterScene={onEnterScene ? () => onEnterScene(letter) : undefined}
          entering={entering} onGotoKeepsakes={onGotoKeepsakes} />
      )}
    </View>
  );
}
