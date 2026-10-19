/**
 * 信箱主屏：只放信，像游戏邮箱一样简单。
 *
 * - 最新一封（信封→信纸）+ 往期来信列表 + 「我留下的」入口。
 *
 * 待办、灵感、情绪、记下的瞬间（原来的「思绪」分区）2026-10 起搬到「待办」Tab（screens/todos）。
 * 不再有「今日待启 / 三日寄存 / 长久珍藏」分区，来信也不设每日数量上限。
 */
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import {
  Button,
  Card,
  PageContainer,
  PageHeader,
} from "../../design-system";
import {
  acceptSceneInvite, ackLetter, createTreasure, deleteTreasure,
  hideAllLetters, hideLetter, hideLetters, listLetters, listTreasures, markAllLettersRead, markLetterRead,
} from "../../api";
import {
  ApiLetter, Keepsake,
  clearAllConfirm, clearBefore, dayKey, deleteSelectedConfirm, letterKind, letterTime, mapTreasure,
  markAllReadLocal, pruneSelection, removeLetters, restoreLetters, revertRead, toggleId, toggleSelectAll,
  useMailboxSurface,
} from "./shared";
import { ConfirmDialog } from "./ConfirmDialog";
import { KeepsakeAlbum, KeepsakeDetail } from "./Keepsakes";
import { LetterPaper } from "./Letters";
import { LetterList } from "./LetterList";
import { TonightLetter } from "./TonightLetter";
import { useGuide } from "../../guide/Guide";

/** 底部导航栏（BottomNavigation，绝对定位压在内容上）的高度；选择模式的「删除所选」条要坐在它上面，不然被盖住。 */
const NAV_BAR_HEIGHT = 78;

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

  // ─── 整理：多选清理 / 一键清理 / 全部已读 ───
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<"one" | "selected" | "all" | null>(null);
  // 列表变了（删了、刷新了）就把选中里已经不在的去掉
  useEffect(() => {
    setSelected(s => {
      if (s.size === 0) return s;
      const pruned = pruneSelection(s, letters);
      return pruned.size === s.size ? s : pruned;
    });
  }, [letters]);

  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };

  /**
   * 乐观删除：先从列表拿掉，后端「隐藏」失败再放回来并提示。
   * （后端是对用户隐藏、不物理删除，所以「失败放回」是安全的。）
   */
  const hideWithRollback = (ids: Set<number>, call: () => Promise<unknown>, doneMsg: string) => {
    const removed = letters.filter(l => ids.has(l.id));
    setLetters(ls => removeLetters(ls, ids));
    call().then(() => onToast?.(doneMsg)).catch(() => {
      setLetters(ls => restoreLetters(ls, removed));
      onToast?.("没删成，信还在，待会儿再试试");
    });
  };

  const confirmDelete = () => {
    const kind = confirming;
    setConfirming(null);
    if (kind === "one" && activeLetter) {
      const id = activeLetter.id;
      setReadingId(null);
      hideWithRollback(new Set([id]), () => hideLetter(id), "已删掉这封信");
    } else if (kind === "selected" && selected.size > 0) {
      const ids = new Set(selected);
      exitSelect();
      hideWithRollback(ids, () => hideLetters([...ids]), `已删掉 ${ids.size} 封`);
    } else if (kind === "all" && letters.length > 0) {
      // 只清「我看到的最新一封」及更早的：确认期间新到的信不会被误清
      const before = clearBefore(letters);
      const ids = new Set(letters.map(l => l.id));
      exitSelect();
      hideWithRollback(ids, () => hideAllLetters(before), "信箱清空了");
    }
  };

  const readAll = () => {
    const unreadIds = new Set(letters.filter(l => !l.is_read).map(l => l.id));
    if (unreadIds.size === 0) { onToast?.("没有没读的信了"); return; }
    setLetters(ls => markAllReadLocal(ls));
    markAllLettersRead()
      .then(() => onToast?.(`${unreadIds.size} 封都标为已读了`))
      .catch(() => {
        setLetters(ls => revertRead(ls, unreadIds));
        onToast?.("没标上，待会儿再试试");
      });
  };

  const confirmText = confirming === "selected" ? deleteSelectedConfirm(selected.size)
    : confirming === "all" ? clearAllConfirm(letters.length)
    : { title: "删掉这封信？", body: "删掉后在信箱里就看不到了。" };

  const reloadLetters = async () => {
    try {
      const list = await listLetters("?limit=100");
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

  const reloadTreasures = async () => {
    try {
      const list = await listTreasures();
      setKeepsakes((Array.isArray(list) ? list : []).map(mapTreasure));
    } catch { /* 网络异常保持当前列表 */ }
  };
  useEffect(() => { reloadTreasures(); reloadLetters(); }, []);
  const removeKeepsake = (id: string) => {
    setKeepsakes(ks => ks.filter(k => k.id !== id));
    setSelectedKeepsake(null);
    deleteTreasure(Number(id)).catch(() => {});
  };

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
        onDelete={() => setConfirming("one")}
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
      selecting={selecting} selected={selected}
      onEnterSelect={() => setSelecting(true)} onCancelSelect={exitSelect}
      onToggle={id => setSelected(s => toggleId(s, id))}
      onSelectAll={ids => setSelected(s => toggleSelectAll(ids, s))}
      onReadAll={readAll} onClearAll={() => setConfirming("all")}
      header={!todaysLetter || guide.active ? (
        <TonightLetter arrived={!!todaysLetter} onOpen={openTodaysLetter}
          petEmoji={petEmoji} petName={petName} petPresetId={petPresetId} />
      ) : null} />
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingBottom: selecting ? NAV_BAR_HEIGHT + 76 : 0 }}>
        <PageContainer maxWidth={760}>
          <PageHeader
            eyebrow="来信"
            title="信箱"
            description="信来了就读。"
          />
          <Card style={{ width: "100%", minWidth: 0 }}>
            {letterSection}
          </Card>
        </PageContainer>
      </ScrollView>

      {selecting && !activeLetter && (
        <View style={{
          position: "absolute", left: 0, right: 0, bottom: NAV_BAR_HEIGHT, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
          backgroundColor: theme.colors.background, borderTopWidth: 1, borderTopColor: theme.colors.divider,
        }}>
          <Button variant="danger" fullWidth disabled={selected.size === 0} onPress={() => setConfirming("selected")}>
            {selected.size ? `删除所选（${selected.size} 封）` : "删除所选"}
          </Button>
        </View>
      )}

      <ConfirmDialog visible={confirming !== null} title={confirmText.title} body={confirmText.body}
        confirmLabel={confirming === "all" ? "全部清掉" : "删掉"}
        onConfirm={confirmDelete} onCancel={() => setConfirming(null)} />

      {selectedKeepsake && (
        <KeepsakeDetail item={selectedKeepsake}
          onClose={() => setSelectedKeepsake(null)} onRemove={() => removeKeepsake(selectedKeepsake.id)} />
      )}
    </View>
  );
}
