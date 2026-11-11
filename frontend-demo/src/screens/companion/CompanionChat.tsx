/**
 * 聊天页：文字对话（含往日会话续聊、回信上下文）+ 逐 token 流式回复 + 语音输入
 * + 发图片（桌宠看图回应，图片不进记忆）+ 聊到想重演的事时出一张「进场景」的邀请卡片。
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Camera, ChevronLeft, History, ImagePlus, Mic, Send, Sparkles, Square, X } from "lucide-react-native";

import {
  Button,
  PetAvatar,
  GlassSurface,
  IconButton,
  MessageBubble,
  StatusDot,
  useResponsive,
  useTheme,
} from "../../design-system";
import {
  authedImageSource,
  createConversation,
  createScene,
  detectSceneIntent,
  getActivePet,
  getConversation,
  getLatestConversation,
  streamChatReply,
  type IntentSeed,
} from "../../api";
import { MAX_IMAGES_PER_MESSAGE, sseErrorDetail, type PickedImage } from "../../chatImages";
import { pickChatImages, takeChatPhoto } from "../../chatImagePicker";
import { useVoiceInput } from "../../useVoiceInput";
import { useTodos } from "../todos/TodosContext";

type CompanionChatProps = {
  initialText?: string;
  letterContext?: string;
  mode?: string;
  onBack: () => void;
  onOpenHistory: () => void;
  /** 用户接受了「进场景」的邀请、场景搭好之后调用。不传则不出邀请卡片。 */
  onEnterScene?: (sceneId: number, theaterId?: string) => void;
  petPresetId?: string | null;
  petName: string;
  seedConversationId?: number | null;
  resumeLatest?: boolean;
};

type ImageRef = { uri: string; headers?: Record<string, string> };
type ChatMessage = { role: string; text: string; images?: ImageRef[] };
type SceneInvite = { seed: IntentSeed | null; theaterId: string | null };

const GREETING = "嗯，我在。今天有什么想聊的吗？";
/** 太短的话不值得判断「想不想进场景」（与后端 MIN_INTENT_CHARS 一致）。 */
const MIN_INTENT_CHARS = 6;

/** 聊天页组件（文字对话 + 流式回复）。 */
export function CompanionChat({
  initialText = "",
  letterContext = "",
  mode = "free_chat",
  onBack,
  onOpenHistory,
  onEnterScene,
  petPresetId = null,
  petName,
  seedConversationId = null,
  resumeLatest = false,
}: CompanionChatProps) {
  const theme = useTheme();
  const { isCompact } = useResponsive();
  const { refresh: refreshTodos } = useTodos();
  const shouldLoadHistory = seedConversationId != null || resumeLatest;
  const [input, setInput] = useState(initialText);
  const [messages, setMessages] = useState<ChatMessage[]>(
    shouldLoadHistory
      ? []   // 往日会话：先加载历史，见下方 effect
      : letterContext
        ? [{ role: "agent", text: letterContext }]   // 回信场景：先把这封信作为它刚说的话显示
        : [{ role: "agent", text: GREETING }]
  );
  const [historyLoading, setHistoryLoading] = useState(shouldLoadHistory);
  const [historyError, setHistoryError] = useState(false);
  const [historyAttempt, retryHistory] = useState(0);
  // 回信场景：首条用户消息需把这封信作为上下文带给后端（只带一次）
  const letterRepliedRef = useRef(false);
  const [thinking, setThinking] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const convIdRef = useRef<number | null>(seedConversationId);
  // 待发送的图片（还没发出去，显示在输入框上方）
  const [pending, setPending] = useState<PickedImage[]>([]);
  const [picking, setPicking] = useState(false);
  const [imageHint, setImageHint] = useState<string | null>(null);
  // 「进场景」邀请：一次只挂一张；用户说了「先不用」的同一幕不再问
  const [invite, setInvite] = useState<SceneInvite | null>(null);
  const [building, setBuilding] = useState(false);
  const [inviteError, setInviteError] = useState(false);
  const declinedRef = useRef<Set<string>>(new Set());
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const voice = useVoiceInput((text) =>
    setInput((previous) => (previous ? `${previous} ${text}` : text)),
  );

  // 首页续上最近的自由聊天，往日列表则打开用户选中的会话。
  useEffect(() => {
    if (!shouldLoadHistory) return;
    let alive = true;
    const detailRequest = seedConversationId == null
      ? getLatestConversation()
      : getConversation(seedConversationId);
    detailRequest
      .then((detail) => {
        if (!alive) return;
        convIdRef.current = detail?.id ?? null;
        const history: ChatMessage[] = (detail?.messages ?? []).map((m: any) => ({
          role: m.role === "user" ? "user" : "agent",
          text: m.content ?? "",
          images: Array.isArray(m.images) && m.images.length ? m.images.map(authedImageSource) : undefined,
        }));
        setMessages(history.length ? history : [{ role: "agent", text: GREETING }]);
      })
      .catch(() => {
        if (!alive) return;
        setHistoryError(true);
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [shouldLoadHistory, seedConversationId, historyAttempt]);

  const blocked = historyLoading || historyError;
  const canSend = (input.trim().length > 0 || pending.length > 0) && !sending && !blocked;

  const addImages = async (source: "library" | "camera" = "library") => {
    if (picking || sending || blocked || pending.length >= MAX_IMAGES_PER_MESSAGE) return;
    setPicking(true);
    setImageHint(null);
    try {
      const picked = source === "camera"
        ? await takeChatPhoto()
        : await pickChatImages(MAX_IMAGES_PER_MESSAGE - pending.length);
      if (picked.length) setPending((current) => [...current, ...picked].slice(0, MAX_IMAGES_PER_MESSAGE));
    } catch (error: any) {
      setImageHint(error?.message || "图片没选上，再试一次");
    } finally {
      setPicking(false);
    }
  };

  const send = async () => {
    if (!canSend || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const text = input.trim();
    const images = pending;
    setInput("");
    setPending([]);
    setImageHint(null);
    setMessages((current) => [
      ...current,
      { role: "user", text, images: images.length ? images.map((i) => ({ uri: i.uri })) : undefined },
    ]);
    setThinking(true);
    // 回信场景：首条用户消息把这封信作为上下文带给后端，让宠物基于信回应（信只带一次、不显示在气泡里）。
    let sendText = text;
    if (text && letterContext && !letterRepliedRef.current) {
      letterRepliedRef.current = true;
      sendText = `（我在回复你刚写给我的信：「${letterContext}」）\n${text}`;
    }
    // 首个 token 到达前只显示"•••"占位泡；到达后再追加 assistant 泡逐 token 填充，
    // 避免出现「空泡 + 思考泡」两个气泡（DAY-201）。
    let started = false;

    // 想不想「进场景」：和回复并行判断，不拖慢回复；等回复说完再把邀请卡片放出来，不在流式中途插进来。
    let replyDone = false;
    let found: SceneInvite | null = null;
    if (onEnterScene && mode === "free_chat" && text.length >= MIN_INTENT_CHARS) {
      detectSceneIntent(text, "chat")
        .then((r) => {
          if (!r?.worth || !aliveRef.current) return;
          const title = r.seed?.title ?? "";
          if (declinedRef.current.has(title)) return;
          found = { seed: r.seed ?? null, theaterId: r.theater_id ?? null };
          if (replyDone) { setInviteError(false); setInvite(found); }
        })
        .catch(() => { /* 识别失败不影响聊天 */ });
    }

    try {
      if (convIdRef.current == null) {
        let petId: number | null = null;
        try {
          const pet = await getActivePet();
          petId = pet?.id ?? null;
        } catch {
          // 无主桌宠也能聊。
        }
        const conversation = await createConversation(petId, mode);
        convIdRef.current = conversation.id;
      }
      const conversationId = convIdRef.current;
      if (conversationId == null) throw new Error("会话创建失败");

      await streamChatReply(conversationId, sendText, (delta) => {
        const first = !started;
        started = true;
        setThinking(false);
        setMessages((current) => {
          if (first) {
            return [...current, { role: "agent", text: delta }];
          }
          const next = [...current];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, text: last.text + delta };
          return next;
        });
      }, () => { void refreshTodos(); }, images.map((i) => ({ data: i.data, mime: i.mime })));
    } catch (error) {
      // 后端明确说了原因（图片太大、格式不对、需要填密钥）就照实说；否则给通用的话
      const detail = started ? null : sseErrorDetail(error);
      const message = detail ?? (started ? "回复中断了，等会儿再聊吧。" : "这次没能回你，等会儿再试试吧。");
      setMessages((current) => [...current, { role: "agent", text: message }]);
    } finally {
      sendingRef.current = false;
      setSending(false);
      setThinking(false);
      replyDone = true;
      if (found && aliveRef.current) { setInviteError(false); setInvite(found); }
    }
  };

  const acceptInvite = async () => {
    if (!invite || building || !onEnterScene) return;
    setBuilding(true);
    setInviteError(false);
    try {
      const seed = invite.seed ?? {};
      const scene = await createScene({
        title: seed.title ?? undefined,
        people: seed.people ?? undefined,
        place: seed.place ?? undefined,
        plot: seed.plot ?? undefined,
        intent: seed.intent ?? undefined,
        theater_id: invite.theaterId,
      });
      if (!aliveRef.current) return;
      setInvite(null);
      onEnterScene(scene.id, scene.theater_id ?? invite.theaterId ?? undefined);
    } catch {
      if (aliveRef.current) setInviteError(true);
    } finally {
      if (aliveRef.current) setBuilding(false);
    }
  };

  const declineInvite = () => {
    if (building) return;
    declinedRef.current.add(invite?.seed?.title ?? "");
    setInvite(null);
  };

  const thumb = isCompact ? 132 : 168;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 880,
          alignSelf: "center",
          flex: 1,
          paddingHorizontal: isCompact ? theme.spacing[4] : theme.spacing[8],
          paddingTop: isCompact ? theme.spacing[3] : theme.spacing[6],
        }}
      >
        <View
          style={{
            minHeight: 56,
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing[3],
            paddingBottom: theme.spacing[3],
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
          }}
        >
          <IconButton
            accessibilityLabel="返回"
            icon={<ChevronLeft color={theme.colors.textSecondary} size={22} />}
            onPress={onBack}
          />
          <PetAvatar presetId={petPresetId} />
          <View style={{ flex: 1 }}>
            <Text
              style={[
                theme.typography.textStyles.bodyStrong,
                { color: theme.colors.textPrimary },
              ]}
            >
              {petName}
            </Text>
            <StatusDot label="在听" />
          </View>
          <IconButton
            accessibilityLabel="聊天历史"
            icon={<History color={theme.colors.textSecondary} size={20} />}
            onPress={onOpenHistory}
          />
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingBottom: theme.spacing[4],
            paddingTop: theme.spacing[6],
          }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
          ref={scrollRef}
          style={{ flex: 1 }}
        >
          {historyLoading ? (
            <ActivityIndicator
              color={theme.colors.accent}
              style={{ marginTop: theme.spacing[10] }}
            />
          ) : null}
          {historyError ? (
            <View style={{ alignItems: "center", gap: theme.spacing[3] }}>
              <Text style={[theme.typography.textStyles.body, { color: theme.colors.textSecondary }]}>
                聊天记录暂时没加载出来。
              </Text>
              <Button variant="secondary" onPress={() => {
                setHistoryError(false);
                setHistoryLoading(true);
                retryHistory((attempt) => attempt + 1);
              }}>重新加载</Button>
            </View>
          ) : null}
          {seedConversationId != null && !historyLoading && messages.length > 0 ? (
            <Text
              style={[
                theme.typography.textStyles.caption,
                {
                  color: theme.colors.textMuted,
                  marginBottom: theme.spacing[4],
                  textAlign: "center",
                },
              ]}
            >
              —— 往日的聊天 ——
            </Text>
          ) : null}
          {messages.map((message, index) => (
            <View key={`${message.role}-${index}`}>
              {message.images?.length ? (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: theme.spacing[2],
                    justifyContent: message.role === "agent" ? "flex-start" : "flex-end",
                    marginBottom: theme.spacing[2],
                  }}
                >
                  {message.images.map((source, i) => (
                    <Image
                      accessibilityLabel="发出的图片"
                      key={`${source.uri}-${i}`}
                      resizeMode="cover"
                      source={source}
                      style={{
                        width: thumb,
                        height: thumb,
                        borderRadius: theme.radii.card,
                        backgroundColor: theme.colors.surface,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    />
                  ))}
                </View>
              ) : null}
              {message.text ? (
                <MessageBubble
                  petPresetId={petPresetId}
                  text={message.text}
                  variant={message.role === "agent" ? "agent" : "user"}
                />
              ) : null}
            </View>
          ))}
          {thinking ? (
            <MessageBubble
              petPresetId={petPresetId}
              pending
              text="•••"
              variant="agent"
            />
          ) : null}
          {invite ? (
            <View
              accessibilityLabel="进场景的邀请"
              style={{
                marginTop: theme.spacing[3],
                padding: theme.spacing[4],
                gap: theme.spacing[3],
                borderRadius: theme.radii.card,
                borderWidth: 1,
                borderColor: theme.colors.accent,
                backgroundColor: theme.colors.accentSoft,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                <Sparkles color={theme.colors.accent} size={16} />
                <Text style={[theme.typography.textStyles.bodyStrong, { color: theme.colors.textPrimary, flex: 1 }]}>
                  要不要走进《{invite.seed?.title || "这一幕"}》，把话说出来？
                </Text>
              </View>
              <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textSecondary }]}>
                {building
                  ? "正在搭场景，大概要一会儿，别走开…"
                  : inviteError
                    ? "场景没搭起来，待会儿再试试。"
                    : `${petName}陪你在一个小场景里试着说一遍，随时可以离开。`}
              </Text>
              <View style={{ flexDirection: "row", gap: theme.spacing[3] }}>
                <Button size="compact" loading={building} onPress={acceptInvite}>进去说说看</Button>
                <Button size="compact" variant="ghost" disabled={building} onPress={declineInvite}>先不用</Button>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {pending.length || imageHint ? (
          <View style={{ marginBottom: theme.spacing[2], gap: theme.spacing[2] }}>
            {pending.length ? (
              <View style={{ flexDirection: "row", gap: theme.spacing[2] }}>
                {pending.map((image, i) => (
                  <View key={`${image.uri}-${i}`}>
                    <Image
                      accessibilityLabel="待发送的图片"
                      resizeMode="cover"
                      source={{ uri: image.uri }}
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    />
                    <Pressable
                      accessibilityLabel="不发这张"
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => setPending((current) => current.filter((_, j) => j !== i))}
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: theme.colors.textPrimary,
                      }}
                    >
                      <X color={theme.colors.surface} size={13} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={[theme.typography.textStyles.caption, { color: imageHint ? theme.colors.error : theme.colors.textMuted }]}>
              {imageHint ?? `图片只用来这次聊天，${petName}不会把它记下来。`}
            </Text>
          </View>
        ) : null}

        <GlassSurface style={{
          marginBottom: Platform.OS === "ios" ? theme.spacing[5] : theme.spacing[4],
          borderRadius: theme.radii.card,
        }}>
          <View
            style={{
              minHeight: 52,
              maxHeight: 120,
              flexDirection: "row",
              alignItems: "flex-end",
              gap: theme.spacing[1],
              paddingLeft: theme.spacing[1],
              paddingRight: theme.spacing[1],
              paddingVertical: theme.spacing[1],
              borderRadius: theme.radii.card,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <IconButton
              accessibilityLabel="发图片"
              disabled={picking || sending || blocked || pending.length >= MAX_IMAGES_PER_MESSAGE}
              icon={
                picking
                  ? <ActivityIndicator color={theme.colors.accent} size="small" />
                  : <ImagePlus color={theme.colors.textSecondary} size={19} />
              }
              onPress={() => addImages("library")}
            />
            <IconButton
              accessibilityLabel="拍照"
              disabled={picking || sending || blocked || pending.length >= MAX_IMAGES_PER_MESSAGE}
              icon={<Camera color={theme.colors.textSecondary} size={19} />}
              onPress={() => addImages("camera")}
            />
            <TextInput
              accessibilityLabel="聊天内容"
              multiline
              onChangeText={setInput}
              onSubmitEditing={send}
              placeholder="说点什么…"
              placeholderTextColor={theme.colors.placeholder}
              selectionColor={theme.colors.accent}
              style={[
                theme.typography.textStyles.body,
                {
                  flex: 1,
                  maxHeight: 104,
                  minHeight: 44,
                  paddingVertical: 10,
                  color: theme.colors.textPrimary,
                  outlineWidth: 0,
                } as any,
              ]}
              value={input}
            />
            {input.trim() || pending.length ? (
              <IconButton
                accessibilityLabel="发送"
                disabled={!canSend}
                icon={<Send color={theme.colors.accent} size={18} />}
                onPress={send}
                selected
              />
            ) : (
              <IconButton
                accessibilityLabel={voice.isRecording ? "停止录音" : "语音输入"}
                disabled={voice.transcribing}
                selected={voice.isRecording}
                icon={
                  voice.transcribing ? (
                    <ActivityIndicator color={theme.colors.accent} size="small" />
                  ) : voice.isRecording ? (
                    <Square
                      color={theme.colors.accent}
                      fill={theme.colors.accent}
                      size={15}
                    />
                  ) : (
                    <Mic color={theme.colors.accent} size={18} />
                  )
                }
                onPress={voice.isRecording ? voice.stop : voice.start}
              />
            )}
          </View>
        </GlassSurface>
      </View>
    </KeyboardAvoidingView>
  );
}
