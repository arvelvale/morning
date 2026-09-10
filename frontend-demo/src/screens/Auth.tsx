/**
 * 登录与注册。
 * 保留用户名、密码校验和认证 API，仅统一跨端布局与表单状态。
 */
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  Eye,
  EyeOff,
  HeartHandshake,
  Lock,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react-native";

import { login as apiLogin, register as apiRegister, type Tokens } from "../api";
import {
  Button,
  Card,
  IconButton,
  TextField,
  useResponsive,
  useTheme,
} from "../design-system";

type Mode = "login" | "register";

// Edge 会在 password 输入框里渲染原生“显示密码”按钮，隐藏它以免和应用按钮重叠。
if (Platform.OS === "web" && typeof document !== "undefined") {
  const styleId = "morning-hide-native-reveal";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent =
      "input::-ms-reveal,input::-ms-clear{display:none!important;}";
    document.head.appendChild(style);
  }
}

type AuthScreenProps = {
  onAuthed: (tokens: Tokens, mode: Mode) => void;
};

const authBenefits = [
  {
    description: "随时说说话，不催促，也不评判。",
    icon: HeartHandshake,
    title: "有人安静地听",
  },
  {
    description: "重要的念头会被妥善整理和保存。",
    icon: Sparkles,
    title: "让思绪有地方放",
  },
  {
    description: "你始终可以查看、调整或删除自己的内容。",
    icon: ShieldCheck,
    title: "主动权一直在你",
  },
];

export function AuthScreen({ onAuthed }: AuthScreenProps) {
  const theme = useTheme();
  const { isCompact, isExpanded } = useResponsive();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(false);
  const isLogin = mode === "login";

  const switchMode = () => {
    setMode(isLogin ? "register" : "login");
    setHint("");
    setPassword("");
    setShowPassword(false);
  };

  const submit = async () => {
    if (loading) return;
    if (username.trim().length < 3) {
      setHint("用户名至少 3 个字符");
      return;
    }
    if (password.length < 6) {
      setHint("密码至少 6 位");
      return;
    }

    setHint("");
    setLoading(true);
    try {
      const authenticate = isLogin ? apiLogin : apiRegister;
      const tokens = await authenticate(username.trim(), password);
      onAuthed(tokens, mode);
    } catch (error: any) {
      setHint(error?.message || "出了点问题，待会儿再试试");
    } finally {
      setLoading(false);
    }
  };

  const brand = (
    <View style={{ maxWidth: 460 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[3],
        }}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: theme.radii.card,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.accentSoft,
          }}
        >
          <Sparkles color={theme.colors.accent} size={24} />
        </View>
        <View>
          <Text
            style={[
              theme.typography.textStyles.sectionTitle,
              { color: theme.colors.textPrimary },
            ]}
          >
            喵灵
          </Text>
          <Text
            style={[
              theme.typography.textStyles.caption,
              { color: theme.colors.textSecondary },
            ]}
          >
            陪你把心里的事，轻轻放下
          </Text>
        </View>
      </View>

      {isExpanded ? (
        <View style={{ gap: theme.spacing[5], marginTop: theme.spacing[10] }}>
          <Text
            style={[
              theme.typography.textStyles.display,
              { color: theme.colors.textPrimary },
            ]}
          >
            给纷乱的思绪，{"\n"}留一块安静的地方
          </Text>
          <View style={{ gap: theme.spacing[4] }}>
            {authBenefits.map((benefit) => {
              const BenefitIcon = benefit.icon;
              return (
                <View
                  key={benefit.title}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: theme.spacing[3],
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: theme.radii.control,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <BenefitIcon color={theme.colors.support} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        theme.typography.textStyles.bodyStrong,
                        { color: theme.colors.textPrimary },
                      ]}
                    >
                      {benefit.title}
                    </Text>
                    <Text
                      style={[
                        theme.typography.textStyles.caption,
                        { color: theme.colors.textSecondary },
                      ]}
                    >
                      {benefit.description}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={{
          minHeight: "100%",
          paddingHorizontal: isCompact ? theme.spacing[5] : theme.spacing[8],
          paddingVertical: isCompact ? theme.spacing[6] : theme.spacing[10],
          alignItems: "center",
          justifyContent: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            width: "100%",
            maxWidth: 1040,
            flexDirection: isExpanded ? "row" : "column",
            alignItems: isExpanded ? "center" : "stretch",
            justifyContent: "space-between",
            gap: isExpanded ? theme.spacing[16] : theme.spacing[8],
          }}
        >
          {brand}

          <Card
            style={{
              width: isExpanded ? 440 : "100%",
              maxWidth: 520,
              alignSelf: isExpanded ? undefined : "center",
              padding: isCompact ? theme.spacing[5] : theme.spacing[8],
              ...theme.shadows.floating,
            }}
          >
            <Text
              accessibilityRole="header"
              style={[
                theme.typography.textStyles.pageTitle,
                { color: theme.colors.textPrimary },
              ]}
            >
              {isLogin ? "欢迎回来" : "第一次见面"}
            </Text>
            <Text
              style={[
                theme.typography.textStyles.body,
                {
                  marginTop: theme.spacing[2],
                  marginBottom: theme.spacing[6],
                  color: theme.colors.textSecondary,
                },
              ]}
            >
              {isLogin
                ? "它一直在这儿，等你回来说说话。"
                : "给自己起个名字，我们慢慢认识。"}
            </Text>

            <View style={{ gap: theme.spacing[4] }}>
              <TextField
                accessibilityLabel="用户名"
                autoCapitalize="none"
                autoCorrect={false}
                label="用户名"
                leading={<User color={theme.colors.textMuted} size={18} />}
                onChangeText={(value) => {
                  setUsername(value);
                  setHint("");
                }}
                placeholder={isLogin ? "你的名字" : "想让我怎么称呼你"}
                returnKeyType="next"
                value={username}
              />
              <TextField
                accessibilityLabel="密码"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                importantForAutofill="no"
                label="密码"
                leading={<Lock color={theme.colors.textMuted} size={18} />}
                onChangeText={(value) => {
                  setPassword(value);
                  setHint("");
                }}
                onSubmitEditing={submit}
                placeholder="悄悄话，只有你知道"
                returnKeyType="done"
                secureTextEntry={!showPassword}
                textContentType="none"
                trailing={
                  <IconButton
                    accessibilityLabel={showPassword ? "隐藏密码" : "显示密码"}
                    icon={
                      showPassword ? (
                        <EyeOff color={theme.colors.textMuted} size={18} />
                      ) : (
                        <Eye color={theme.colors.textMuted} size={18} />
                      )
                    }
                    onPress={() => setShowPassword((current) => !current)}
                  />
                }
                value={password}
              />
            </View>

            <View
              accessibilityLiveRegion="polite"
              style={{
                minHeight: 24,
                justifyContent: "center",
                marginVertical: theme.spacing[3],
              }}
            >
              {hint ? (
                <Text
                  accessibilityRole="alert"
                  style={[
                    theme.typography.textStyles.caption,
                    { color: theme.colors.warning },
                  ]}
                >
                  {hint}
                </Text>
              ) : null}
            </View>

            <Button
              fullWidth
              loading={loading}
              onPress={submit}
              size="large"
            >
              {loading
                ? isLogin
                  ? "登录中…"
                  : "创建中…"
                : isLogin
                  ? "进来坐坐"
                  : "开始吧"}
            </Button>

            <View
              style={{
                flexDirection: "row",
                justifyContent: "center",
                alignItems: "center",
                marginTop: theme.spacing[4],
              }}
            >
              <Text
                style={[
                  theme.typography.textStyles.caption,
                  { color: theme.colors.textSecondary },
                ]}
              >
                {isLogin ? "还没有账号？" : "已经有账号了？"}
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={switchMode}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Text
                  style={[
                    theme.typography.textStyles.caption,
                    {
                      marginLeft: theme.spacing[2],
                      color: theme.colors.accent,
                      fontWeight: "500",
                    },
                  ]}
                >
                  {isLogin ? "创建一个" : "回来登录"}
                </Text>
              </Pressable>
            </View>

            {!isLogin ? (
              <Text
                style={[
                  theme.typography.textStyles.label,
                  {
                    marginTop: theme.spacing[3],
                    textAlign: "center",
                    color: theme.colors.textMuted,
                  },
                ]}
              >
                demo 版只需用户名与密码，无需验证码
              </Text>
            ) : null}
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
