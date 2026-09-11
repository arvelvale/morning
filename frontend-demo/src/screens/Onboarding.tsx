/**
 * 四步新手引导。
 * 手机使用单列流程，桌面在相同信息层级下使用横向空间。
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { BellOff, Check, ChevronLeft, HeartHandshake, Lock } from "lucide-react-native";

import {
  Button,
  Card,
  CompanionAvatar,
  IconButton,
  PageContainer,
  useResponsive,
  useTheme,
} from "../design-system";
import { getPetAvatar } from "../pets/assets";

type OnboardingShellProps = {
  children: React.ReactNode;
  footer: React.ReactNode;
  onBack?: () => void;
  step: number;
};

function StepIndicator({ step }: { step: number }) {
  const theme = useTheme();

  return (
    <View
      accessibilityLabel={`引导步骤 ${step}，共 4 步`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing[3],
      }}
    >
      <Text
        style={[
          theme.typography.textStyles.label,
          { color: theme.colors.textMuted },
        ]}
      >
        {step} / 4
      </Text>
      <View style={{ flexDirection: "row", gap: theme.spacing[1] }}>
        {[1, 2, 3, 4].map((item) => (
          <View
            key={item}
            style={{
              width: item === step ? 20 : 7,
              height: 7,
              borderRadius: 4,
              backgroundColor:
                item <= step ? theme.colors.accentSurface : theme.colors.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function OnboardingShell({
  children,
  footer,
  onBack,
  step,
}: OnboardingShellProps) {
  const theme = useTheme();
  const { isCompact } = useResponsive();

  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer
        maxWidth={960}
        style={{
          flex: 1,
          paddingBottom: isCompact ? theme.spacing[6] : theme.spacing[8],
          paddingTop: isCompact ? theme.spacing[3] : theme.spacing[6],
        }}
      >
        <View
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: isCompact ? theme.spacing[4] : theme.spacing[6],
          }}
        >
          {onBack ? (
            <IconButton
              accessibilityLabel="返回上一步"
              icon={
                <ChevronLeft color={theme.colors.textSecondary} size={22} />
              }
              onPress={onBack}
            />
          ) : (
            <View style={{ width: 44 }} />
          )}
          <StepIndicator step={step} />
        </View>
        <View style={{ flex: 1 }}>{children}</View>
        <View
          style={{
            width: "100%",
            maxWidth: 640,
            alignSelf: "center",
            marginTop: theme.spacing[8],
          }}
        >
          {footer}
        </View>
      </PageContainer>
    </ScrollView>
  );
}

function OnboardingHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  const theme = useTheme();

  return (
    <View style={{ maxWidth: 660, marginBottom: theme.spacing[6] }}>
      <Text
        accessibilityRole="header"
        style={[
          theme.typography.textStyles.pageTitle,
          { color: theme.colors.textPrimary },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          theme.typography.textStyles.body,
          { marginTop: theme.spacing[2], color: theme.colors.textSecondary },
        ]}
      >
        {description}
      </Text>
    </View>
  );
}

type OnboardWelcomeProps = {
  onNext: () => void;
  onSkip?: () => void;
};

export function OnboardWelcome({
  onNext,
  onSkip,
}: OnboardWelcomeProps) {
  const theme = useTheme();
  const { isCompact, isExpanded } = useResponsive();

  return (
    <OnboardingShell
      footer={
        <View
          style={{
            flexDirection: isCompact ? "column" : "row",
            gap: theme.spacing[3],
          }}
        >
          <View style={{ flex: 1 }}>
            <Button fullWidth onPress={onNext} size="large">
              认识一下
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              fullWidth
              onPress={onSkip ?? onNext}
              size="large"
              variant="ghost"
            >
              已经了解，直接开始
            </Button>
          </View>
        </View>
      }
      step={1}
    >
      <Card
        style={{
          flex: 1,
          minHeight: isCompact ? 470 : 440,
          flexDirection: isExpanded ? "row" : "column",
          alignItems: "center",
          justifyContent: "center",
          gap: isExpanded ? theme.spacing[12] : theme.spacing[8],
          padding: isCompact ? theme.spacing[6] : theme.spacing[10],
          ...theme.shadows.soft,
        }}
      >
        <View
          style={{
            width: isCompact ? 210 : 260,
            height: isCompact ? 210 : 260,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              position: "absolute",
              width: isCompact ? 190 : 230,
              height: isCompact ? 190 : 230,
              borderRadius: isCompact ? 95 : 115,
              backgroundColor: theme.colors.accentSoft,
              opacity: 0.7,
            }}
          />
          <CompanionAvatar
            size={isCompact ? 142 : 174}
            source={getPetAvatar("miro")}
          />
        </View>
        <View
          style={{
            flex: isExpanded ? 1 : undefined,
            maxWidth: 480,
            alignItems: isExpanded ? "flex-start" : "center",
          }}
        >
          <Text
            accessibilityRole="header"
            style={[
              isCompact
                ? theme.typography.textStyles.pageTitle
                : theme.typography.textStyles.display,
              {
                textAlign: isExpanded ? "left" : "center",
                color: theme.colors.textPrimary,
              },
            ]}
          >
            思绪纷乱时，{"\n"}有个地方接住你
          </Text>
          <Text
            style={[
              theme.typography.textStyles.body,
              {
                marginTop: theme.spacing[3],
                textAlign: isExpanded ? "left" : "center",
                color: theme.colors.textSecondary,
              },
            ]}
          >
            喵灵 是你的情感陪伴伙伴
          </Text>
        </View>
      </Card>
    </OnboardingShell>
  );
}

const companionWays = [
  {
    description: "随时找它说说话，它会静静地听，不催、不评判",
    icon: "💬",
    title: "自然聊天",
  },
  {
    description: "把今天所有的念头一股脑倒出来，整理是它的事",
    icon: "🌙",
    title: "睡前清空",
  },
  {
    description: "它会在合适的时候送来值得的东西",
    icon: "📬",
    title: "内容托管",
  },
];

type OnboardHowProps = {
  onBack: () => void;
  onNext: () => void;
};

export function OnboardHow({ onBack, onNext }: OnboardHowProps) {
  const theme = useTheme();
  const { isExpanded } = useResponsive();

  return (
    <OnboardingShell
      footer={
        <Button fullWidth onPress={onNext} size="large">
          选择你的伙伴
        </Button>
      }
      onBack={onBack}
      step={2}
    >
      <OnboardingHeading
        description="不是工具，更像一个会等你回来的朋友"
        title="陪伴的三种方式"
      />
      <View
        style={{
          flexDirection: isExpanded ? "row" : "column",
          gap: theme.spacing[3],
        }}
      >
        {companionWays.map((item) => (
          <Card
            key={item.title}
            style={{
              flex: 1,
              minHeight: isExpanded ? 220 : undefined,
              justifyContent: "space-between",
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: theme.radii.control,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.accentSoft,
              }}
            >
              <Text style={{ fontSize: 24 }}>{item.icon}</Text>
            </View>
            <View style={{ marginTop: theme.spacing[5] }}>
              <Text
                style={[
                  theme.typography.textStyles.sectionTitle,
                  { color: theme.colors.textPrimary },
                ]}
              >
                {item.title}
              </Text>
              <Text
                style={[
                  theme.typography.textStyles.body,
                  {
                    marginTop: theme.spacing[2],
                    color: theme.colors.textSecondary,
                  },
                ]}
              >
                {item.description}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    </OnboardingShell>
  );
}

type PetOption = {
  emoji?: string;
  id: number | string;
  name: string;
  presetId?: string | null;
  summary: string;
};

type OnboardPetProps = {
  onBack: () => void;
  onNext: () => void;
  onSelect: (id: number | string) => void;
  pets: PetOption[];
  selectedId: number | string | null;
};

export function OnboardPet({
  onBack,
  onNext,
  onSelect,
  pets,
  selectedId,
}: OnboardPetProps) {
  const theme = useTheme();
  const { isExpanded } = useResponsive();
  const hasSelection = pets.some((pet) => pet.id === selectedId);

  return (
    <OnboardingShell
      footer={
        <Button
          disabled={!hasSelection}
          fullWidth
          onPress={onNext}
          size="large"
        >
          就选它了
        </Button>
      }
      onBack={onBack}
      step={3}
    >
      <OnboardingHeading
        description="之后随时可以更换，记忆会妥善交接"
        title="选择你的伙伴"
      />
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing[3],
        }}
      >
        {pets.map((pet) => {
          const selected = pet.id === selectedId;
          return (
            <Pressable
              accessibilityLabel={`${pet.name}，${pet.summary}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={String(pet.id)}
              onPress={() => onSelect(pet.id)}
              style={({ pressed }) => ({
                width: isExpanded ? "48%" : "100%",
                flexGrow: 1,
                minWidth: isExpanded ? 360 : undefined,
                padding: theme.spacing[5],
                borderRadius: theme.radii.card,
                borderWidth: selected ? 2 : 1,
                borderColor: selected
                  ? theme.colors.accent
                  : theme.colors.border,
                backgroundColor: selected
                  ? theme.colors.accentSoft
                  : theme.colors.surface,
                opacity: pressed ? 0.88 : 1,
                transform: [{ scale: pressed ? 0.99 : 1 }],
              })}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: theme.spacing[4],
                }}
              >
                <CompanionAvatar
                  emoji={pet.emoji}
                  size={62}
                  source={getPetAvatar(pet.presetId ?? String(pet.id))}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: theme.spacing[2],
                    }}
                  >
                    <Text
                      style={[
                        theme.typography.textStyles.sectionTitle,
                        { color: theme.colors.textPrimary },
                      ]}
                    >
                      {pet.name}
                    </Text>
                    <View
                      style={{
                        paddingHorizontal: theme.spacing[2],
                        paddingVertical: theme.spacing[1],
                        borderRadius: theme.radii.pill,
                        backgroundColor: selected
                          ? theme.colors.surface
                          : theme.colors.accentSoft,
                      }}
                    >
                      <Text
                        style={[
                          theme.typography.textStyles.label,
                          { color: theme.colors.accent },
                        ]}
                      >
                        陪伴伙伴
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      theme.typography.textStyles.caption,
                      {
                        marginTop: theme.spacing[2],
                        color: theme.colors.textSecondary,
                      },
                    ]}
                  >
                    {pet.summary}
                  </Text>
                </View>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: selected
                      ? theme.colors.accent
                      : theme.colors.border,
                    backgroundColor: selected
                      ? theme.colors.accent
                      : "transparent",
                  }}
                >
                  {selected ? <Check color={theme.colors.textOnAccent} size={14} /> : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </OnboardingShell>
  );
}

const permissionItems = [
  {
    description: "它会在合适的时刻主动出现，随时可以关闭",
    icon: HeartHandshake,
    title: "主动陪伴",
  },
  {
    description: "对话内容存在你的设备，可以随时查看和删除",
    icon: Lock,
    title: "记忆授权",
  },
  {
    description: "不依赖通知、连续签到或任何情感绑架",
    icon: BellOff,
    title: "不会打扰你",
  },
];

type OnboardPermissionProps = {
  onBack: () => void;
  onNext: () => void;
};

export function OnboardPermission({
  onBack,
  onNext,
}: OnboardPermissionProps) {
  const theme = useTheme();
  const { isExpanded } = useResponsive();

  return (
    <OnboardingShell
      footer={
        <View style={{ alignItems: "center", gap: theme.spacing[3] }}>
          <Button fullWidth onPress={onNext} size="large">
            开始了
          </Button>
          <Text
            style={[
              theme.typography.textStyles.caption,
              { textAlign: "center", color: theme.colors.textMuted },
            ]}
          >
            可以在「我的」里随时修改这些设置
          </Text>
        </View>
      }
      onBack={onBack}
      step={4}
    >
      <OnboardingHeading
        description="你一直掌握主动权"
        title="在开始之前"
      />
      <View
        style={{
          flexDirection: isExpanded ? "row" : "column",
          gap: theme.spacing[3],
        }}
      >
        {permissionItems.map((item) => {
          const ItemIcon = item.icon;
          return (
            <Card
              key={item.title}
              style={{
                flex: 1,
                minHeight: isExpanded ? 190 : undefined,
              }}
            >
              <ItemIcon color={theme.colors.support} size={22} />
            <Text
              style={[
                theme.typography.textStyles.sectionTitle,
                {
                  marginTop: theme.spacing[4],
                  color: theme.colors.textPrimary,
                },
              ]}
            >
              {item.title}
            </Text>
            <Text
              style={[
                theme.typography.textStyles.body,
                {
                  marginTop: theme.spacing[2],
                  color: theme.colors.textSecondary,
                },
              ]}
            >
              {item.description}
            </Text>
          </Card>
          );
        })}
      </View>
    </OnboardingShell>
  );
}
