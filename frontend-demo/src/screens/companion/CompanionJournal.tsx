/**
 * 往日手帐：历史会话按日分组列表，点开某段进入续聊。
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { ChevronLeft, Trash2 } from "lucide-react-native";

import {
  Button,
  PetAvatar,
  IconButton,
  ResponsiveOverlay,
  useResponsive,
  useTheme,
} from "../../design-system";
import { deleteConversation, listConversations } from "../../api";
import { ConversationSummary, groupByDay, modeLabel, shortTitle, timeLabel } from "./shared";

type CompanionJournalProps = {
  onBack: () => void;
  onOpenConversation: (conversationId: number) => void;
  petPresetId?: string | null;
};

/** 往日手帐页：历史会话列表。 */
export function CompanionJournal({
  onBack,
  onOpenConversation,
  petPresetId = null,
}: CompanionJournalProps) {
  const theme = useTheme();
  const { isCompact } = useResponsive();
  const [convs, setConvs] = useState<ConversationSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listConversations()
      .then((list) => {
        if (alive) setConvs(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const groups = convs ? groupByDay(convs) : [];

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteConversation(pendingDelete.id);
      setConvs((current) => current?.filter((conv) => conv.id !== pendingDelete.id) ?? []);
      setPendingDelete(null);
    } catch (error: any) {
      setDeleteError(error?.message || "没删掉，待会儿再试试。");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          width: "100%",
          maxWidth: 760,
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
              往日
            </Text>
            <Text
              style={[
                theme.typography.textStyles.caption,
                { color: theme.colors.textMuted },
              ]}
            >
              {convs ? `你们一起度过的 ${convs.length} 段时光` : "一起度过的时光"}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: theme.spacing[6] }}
          style={{ flex: 1 }}
        >
          {convs === null && !failed ? (
            <ActivityIndicator
              color={theme.colors.accent}
              style={{ marginTop: theme.spacing[10] }}
            />
          ) : null}
          {failed ? (
            <Text
              style={[
                theme.typography.textStyles.body,
                {
                  color: theme.colors.textSecondary,
                  marginTop: theme.spacing[10],
                  textAlign: "center",
                },
              ]}
            >
              没翻出来，待会儿再试试。
            </Text>
          ) : null}
          {convs !== null && convs.length === 0 && !failed ? (
            <Text
              style={[
                theme.typography.textStyles.body,
                {
                  color: theme.colors.textSecondary,
                  lineHeight: 26,
                  marginTop: theme.spacing[10],
                  textAlign: "center",
                },
              ]}
            >
              还没有往日。{"\n"}和它聊过第一次之后，这里会留下你们一起度过的时光。
            </Text>
          ) : null}

          {groups.map((group) => (
            <View key={group.label}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: theme.spacing[2],
                  marginTop: theme.spacing[4],
                  marginBottom: theme.spacing[2],
                }}
              >
                <Text
                  style={[
                    theme.typography.textStyles.caption,
                    { color: theme.colors.textMuted },
                  ]}
                >
                  {group.label}
                </Text>
                <View
                  style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }}
                />
              </View>
              {group.items.map((conv) => (
                <View
                  key={conv.id}
                  style={{
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.card,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    marginBottom: theme.spacing[2],
                    overflow: "hidden",
                    flexDirection: "row",
                    alignItems: "center",
                    ...theme.shadows.soft,
                  }}
                >
                  <View
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 4,
                      backgroundColor:
                        conv.mode === "free_chat"
                          ? theme.colors.accentSurface
                          : theme.colors.support,
                    }}
                  />
                  <Pressable
                    accessibilityLabel={`打开聊天：${shortTitle(conv)}`}
                    accessibilityRole="button"
                    onPress={() => onOpenConversation(conv.id)}
                    style={({ pressed }) => ({
                      flex: 1,
                      paddingLeft: theme.spacing[5],
                      paddingRight: theme.spacing[2],
                      paddingVertical: theme.spacing[3],
                      opacity: pressed ? 0.82 : 1,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    })}
                  >
                    <Text
                      style={[
                        theme.typography.textStyles.bodyStrong,
                        { color: theme.colors.textPrimary },
                      ]}
                    >
                      {shortTitle(conv)}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: theme.spacing[2],
                        marginTop: theme.spacing[2],
                      }}
                    >
                      <Text
                        style={[
                          theme.typography.textStyles.label,
                          {
                            color: theme.colors.accent,
                            backgroundColor: theme.colors.accentSoft,
                            borderRadius: theme.radii.pill,
                            overflow: "hidden",
                            paddingHorizontal: theme.spacing[2],
                            paddingVertical: 1,
                          },
                        ]}
                      >
                        {modeLabel(conv.mode)}
                      </Text>
                      <Text
                        style={[
                          theme.typography.textStyles.caption,
                          { color: theme.colors.textMuted },
                        ]}
                      >
                        {timeLabel(conv.updated_at || conv.created_at)}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={{ paddingRight: theme.spacing[2] }}>
                    <IconButton
                      accessibilityLabel={`删除聊天：${shortTitle(conv)}`}
                      icon={<Trash2 color={theme.colors.error} size={19} />}
                      onPress={() => {
                        setDeleteError(null);
                        setPendingDelete(conv);
                      }}
                    />
                  </View>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
      <ResponsiveOverlay
        visible={pendingDelete !== null}
        title="删除这段往日？"
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
      >
        <View style={{ padding: theme.spacing[5], gap: theme.spacing[4] }}>
          <Text style={[theme.typography.textStyles.body, { color: theme.colors.textSecondary }]}>
            删除后，这段聊天和其中的消息都无法恢复。
          </Text>
          {deleteError ? (
            <Text accessibilityRole="alert" style={[theme.typography.textStyles.caption, { color: theme.colors.error }]}>
              {deleteError}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: theme.spacing[3] }}>
            <View style={{ flex: 1 }}>
              <Button fullWidth variant="secondary" disabled={deleting} onPress={() => setPendingDelete(null)}>
                先留着
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button fullWidth variant="danger" disabled={deleting} onPress={confirmDelete}>
                {deleting ? "正在删除…" : "删除"}
              </Button>
            </View>
          </View>
        </View>
      </ResponsiveOverlay>
    </View>
  );
}
