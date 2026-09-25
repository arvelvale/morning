/**
 * 登录与注册。
 * 保留密码登录/注册，增加 SMTP 邮箱验证码登录及原账号首次绑定。
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Image,
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
} from "lucide-react-native";

import { login as apiLogin, register as apiRegister, loginWithEmail, sendEmailCode, type Tokens } from "../api";
import {
  Button,
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
    title: "有人安静地听",
  },
  {
    description: "重要的念头会被妥善整理和保存。",
    title: "让思绪有地方放",
  },
  {
    description: "你始终可以查看、调整或删除自己的内容。",
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
  const [emailMode, setEmailMode] = useState(false);
  const [binding, setBinding] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    if (!retryAt) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const isLogin = mode === "login";

  const switchMode = () => {
    if (busy.current) return;
    setEmailMode(false);
    setBinding(false);
    setMode(isLogin ? "register" : "login");
    setHint("");
    setPassword("");
    setShowPassword(false);
  };

  const submit = async () => {
    if (busy.current) return;
    if (emailMode) {
      if (!email.trim() || !/^\d{6}$/.test(code)) {
        setHint("请输入邮箱和 6 位验证码");
        return;
      }
      if (binding && (username.trim().length < 3 || password.length < 6)) {
        setHint("首次绑定需要填写原账号用户名和密码");
        return;
      }
      busy.current = true;
      setLoading(true);
      setHint("");
      try {
        const tokens = await loginWithEmail(email.trim(), code, binding ? { username: username.trim(), password } : undefined);
        onAuthed(tokens, "login");
      } catch (error: any) {
        setHint(error?.message || "登录失败，请稍后重试");
      } finally {
        busy.current = false;
        setLoading(false);
      }
      return;
    }
    if (username.trim().length < 3) {
      setHint("用户名至少 3 个字符");
      return;
    }
    if (password.length < 6) {
      setHint("密码至少 6 位");
      return;
    }

    setHint("");
    busy.current = true;
    setLoading(true);
    try {
      const authenticate = isLogin ? apiLogin : apiRegister;
      const tokens = await authenticate(username.trim(), password);
      onAuthed(tokens, mode);
    } catch (error: any) {
      setHint(error?.message || "出了点问题，待会儿再试试");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const requestCode = async () => {
    if (busy.current || remaining > 0) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setHint("请输入有效的邮箱地址");
      return;
    }
    busy.current = true;
    setSending(true);
    setHint("");
    setCode("");
    // 网络超时不等于发送失败；先留出冷却时间，防止误触重复发送。
    setRetryAt(Date.now() + 60000);
    try {
      const result = await sendEmailCode(email.trim(), binding ? "bind" : "login");
      setRetryAt(Date.now() + result.retry_after * 1000);
      setHint(result.message);
    } catch (error: any) {
      setHint(error?.message || "邮件暂时没能发出，请稍后重试");
    } finally {
      busy.current = false;
      setSending(false);
    }
  };

  const brand = (
    <View style={{ flex: isExpanded ? 1 : undefined, maxWidth: isExpanded ? 420 : 440, width: "100%", alignSelf: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
        <Image accessibilityLabel="喵灵" source={require("../../assets/icon.png")}
          style={{ width: 40, height: 40, borderRadius: theme.radii.control }} />
        <Text style={[theme.typography.textStyles.sectionTitle, { color: theme.colors.textPrimary }]}>喵灵</Text>
      </View>
      <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textSecondary, marginTop: theme.spacing[4] }]}>
        陪你把心里的事，轻轻放下
      </Text>
      {isExpanded ? (
        <View style={{ marginTop: theme.spacing[12] }}>
          <Text style={[theme.typography.textStyles.display, theme.typography.textStyles.emotionalTitle, { color: theme.colors.textPrimary, lineHeight: 50 }]}>
            给纷乱的思绪，{"\n"}留一块安静的地方
          </Text>
          <View style={{ marginTop: theme.spacing[10], gap: theme.spacing[5] }}>
            {authBenefits.map(benefit => (
              <View key={benefit.title} style={{ borderLeftWidth: 1, borderLeftColor: theme.colors.divider, paddingLeft: theme.spacing[4] }}>
                <Text style={[theme.typography.textStyles.bodyStrong, { color: theme.colors.textPrimary }]}>{benefit.title}</Text>
                <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textSecondary, marginTop: theme.spacing[1] }]}>{benefit.description}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <ScrollView
        contentContainerStyle={{
          minHeight: "100%",
          paddingHorizontal: isCompact ? theme.spacing[5] : theme.spacing[8],
          paddingVertical: isCompact ? theme.spacing[6] : theme.spacing[10],
          alignItems: "center",
          justifyContent: isExpanded ? "center" : "flex-start",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            width: "100%",
            maxWidth: isExpanded ? 1040 : 440,
            flexDirection: isExpanded ? "row" : "column",
            alignItems: isExpanded ? "center" : "stretch",
            justifyContent: "space-between",
            gap: isExpanded ? theme.spacing[16] : theme.spacing[12],
          }}
        >
          {brand}

          <View
            style={{
              width: isExpanded ? 400 : "100%",
              maxWidth: 440,
              alignSelf: isExpanded ? undefined : "center",
              paddingVertical: theme.spacing[6],
              paddingLeft: isExpanded ? theme.spacing[8] : 0,
              borderLeftWidth: isExpanded ? 1 : 0,
              borderLeftColor: theme.colors.divider,
            }}
          >
            <Text
              accessibilityRole="header"
              style={[
                theme.typography.textStyles.pageTitle,
                theme.typography.textStyles.emotionalTitle,
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

            {isLogin ? (
              <View style={{ flexDirection: "row", gap: theme.spacing[5], marginBottom: theme.spacing[5] }}>
                {[false, true].map(useEmail => (
                  <Pressable key={String(useEmail)} accessibilityRole="button" accessibilityState={{ selected: emailMode === useEmail }}
                    disabled={loading || sending}
                    onPress={() => { setEmailMode(useEmail); setBinding(false); setHint(""); setCode(""); setPassword(""); }}
                    style={{ minHeight: 44, justifyContent: "center", borderBottomWidth: emailMode === useEmail ? 2 : 0, borderBottomColor: theme.colors.accent }}>
                    <Text style={[theme.typography.textStyles.body, { color: emailMode === useEmail ? theme.colors.textPrimary : theme.colors.textMuted }]}>
                      {useEmail ? "邮箱验证码" : "密码登录"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={{ gap: theme.spacing[4] }}>
              {emailMode ? (
                <>
                  <TextField label="邮箱" accessibilityLabel="邮箱" keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                    editable={!loading && !sending} value={email} placeholder="你的邮箱地址"
                    onChangeText={value => { setEmail(value); setCode(""); setHint(""); }} />
                  <TextField label="验证码" accessibilityLabel="邮箱验证码" keyboardType="number-pad" autoComplete="one-time-code"
                    editable={!loading && !sending} maxLength={6} value={code} placeholder="6 位数字"
                    onChangeText={value => setCode(value.replace(/\D/g, ""))} onSubmitEditing={submit} />
                  <Button onPress={requestCode} loading={sending} disabled={loading || sending || remaining > 0}>
                    {remaining > 0 ? `${remaining} 秒后可重发` : "发送验证码"}
                  </Button>
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: binding }} disabled={loading || sending}
                    onPress={() => { setBinding(!binding); setCode(""); setPassword(""); setHint(""); }}
                    style={{ minHeight: 44, justifyContent: "center" }}>
                    <Text style={[theme.typography.textStyles.caption, { color: theme.colors.accent }]}>
                      {binding ? "已经绑定过？直接用邮箱登录" : "首次使用？绑定已有账号"}
                    </Text>
                  </Pressable>
                  {binding ? <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textSecondary }]}>
                    填写原账号和密码，并重新获取绑定验证码。绑定后仍保留原来的思绪与片场记录；没有账号请先注册。
                  </Text> : null}
                </>
              ) : null}
              {!emailMode || binding ? <>
              <TextField
                accessibilityLabel="用户名"
                editable={!loading && !sending}
                autoCapitalize="none"
                autoCorrect={false}
                label="用户名"
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
                editable={!loading && !sending}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                importantForAutofill="no"
                label="密码"
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
              </> : null}
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
              disabled={sending}
              onPress={submit}
              size="large"
            >
              {emailMode ? (loading ? "登录中…" : binding ? "绑定并登录" : "验证码登录") : loading
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
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
