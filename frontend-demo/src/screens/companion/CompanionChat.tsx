/**
 * 聊天页：文字对话（含往日会话续聊、回信上下文）+ 逐 token 流式回复 + 语音输入。
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { ChevronLeft, Mic, Send, Square } from "lucide-react-native";

import {
  PetAvatar,
  GlassSurface,
  IconButton,
  MessageBubble,
  StatusDot,
  useResponsive,
  useTheme,
} from "../../design-system";
import {
  createConversation,
  getActivePet,
  getConversation,
  streamChatReply,
} from "../../api";
import { useVoiceInput } from "../../useVoiceInput";

type CompanionChatProps = {
  initialText?: string;
  letterContext?: string;
  mode?: string;
  onBack: () => void;
  petPresetId?: string | null;
  petName: string;
  seedConversationId?: number | null;
};

/** 聊天页组件（文字对话 + 流式回复）。 */
export function CompanionChat({
  initialText = "",
  letterContext = "",
  mode = "free_chat",
  onBack,
  petPresetId = null,
  petName,
  seedConversationId = null,
}: CompanionChatProps) {
  const theme = useTheme();
  const { isCompact } = useResponsive();
  const [input, setInput] = useState(initialText);
  const [messages, setMessages] = useState(
    seedConversationId != null
      ? ([] as { role: string; text: string }[])   // 往日会话：先加载历史，见下方 effect
      : letterContext
        ? [{ role: "agent", text: letterContext }]   // 回信场景：先把这封信作为它刚说的话显示
        : [{ role: "agent", text: "嗯，我在。今天有什么想聊的吗？" }]
  );
  const [historyLoading, setHistoryLoading] = useState(seedConversationId != null);
  // 回信场景：首条用户消息需把这封信作为上下文带给后端（只带一次）
  const letterRepliedRef = useRef(false);
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const convIdRef = useRef<number | null>(seedConversationId);
  const voice = useVoiceInput((text) =>
    setInput((previous) => (previous ? `${previous} ${text}` : text)),
  );

  // 往日会话：进入时用 getConversation 把历史消息铺满，之后在同一会话里继续聊。
  useEffect(() => {
    if (seedConversationId == null) return;
    let alive = true;
    getConversation(seedConversationId)
      .then((detail) => {
        if (!alive) return;
        const history = (detail?.messages ?? []).map((m: any) => ({
          role: m.role === "user" ? "user" : "agent",
          text: m.content ?? "",
        }));
        setMessages(
          history.length
            ? history
            : [{ role: "agent", text: "嗯，我在。今天有什么想聊的吗？" }]
        );
      })
      .catch(() => {
        if (!alive) return;
        setMessages([{ role: "agent", text: "刚刚走神了，能再说一次吗？" }]);
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [seedConversationId]);

  const send = async () => {
    if (!input.trim() || thinking) return;
    const text = input.trim();
    setInput("");
    setMessages((current) => [...current, { role: "user", text }]);
    setThinking(true);
    // 回信场景：首条用户消息把这封信作为上下文带给后端，让宠物基于信回应（信只带一次、不显示在气泡里）。
    let sendText = text;
    if (letterContext && !letterRepliedRef.current) {
      letterRepliedRef.current = true;
      sendText = `（我在回复你刚写给我的信：「${letterContext}」）\n${text}`;
    }
    // 首个 token 到达前只显示"•••"占位泡；到达后再追加 assistant 泡逐 token 填充，
    // 避免出现「空泡 + 思考泡」两个气泡（DAY-201）。
    let started = false;

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
        setThinking(false);
        setMessages((current) => {
          if (!started) {
            started = true;
            return [...current, { role: "agent", text: delta }];
          }
          const next = [...current];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, text: last.text + delta };
          return next;
        });
      });
    } catch (error: any) {
      const message = error?.message || "刚刚走神了，能再说一次吗？";
      setMessages((current) => {
        if (!started) return [...current, { role: "agent", text: message }];
        const next = [...current];
        next[next.length - 1] = { role: "agent", text: message };
        return next;
      });
    } finally {
      setThinking(false);
    }
  };

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
            <MessageBubble
              petPresetId={petPresetId}
              key={`${message.role}-${index}`}
              text={message.text}
              variant={message.role === "agent" ? "agent" : "user"}
            />
          ))}
          {thinking ? (
            <MessageBubble
              petPresetId={petPresetId}
              pending
              text="•••"
              variant="agent"
            />
          ) : null}
        </ScrollView>

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
              gap: theme.spacing[2],
              paddingLeft: theme.spacing[4],
              paddingRight: theme.spacing[1],
              paddingVertical: theme.spacing[1],
              borderRadius: theme.radii.card,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
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
            {input.trim() ? (
              <IconButton
                accessibilityLabel="发送"
                disabled={thinking}
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
