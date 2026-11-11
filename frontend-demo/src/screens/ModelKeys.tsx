/**
 * 「模型与密钥」：用户填自己的模型密钥（BYOK）。
 *
 * - 密钥只存在这台手机的安全存储里；使用时经加密连接带给喵灵后端转交给模型服务商，后端不保存。
 * - 保存前先让后端各探一次，能用才存（免得存下一把错的 key，之后所有功能都悄悄失败）。
 * - 连接没加密时整页只读并说明原因：明文连接上不发密钥。
 */
import React, { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { ArrowLeft, KeyRound, LockKeyhole, ShieldAlert } from "lucide-react-native";

import { Button, Card, IconButton, PageContainer, TextField, useTheme } from "../design-system";
import { API_BASE, getKeyPolicy, setOwnKeyFlag, testModelKeys, type KeyPolicy } from "../api";
import {
  clearModelKeys, currentModelKeys, keysAllowedOn, loadModelKeys, modelKeysSupported, saveModelKeys,
} from "../modelKeys";
import {
  allProvidedOk, hasAnyKey, keyProblem, maskKey, normalizeKey, testMessage,
  type KeyTestResult, type ModelKeys,
} from "../modelKeysPolicy";

type TestState = { stepfun?: KeyTestResult; deepseek?: KeyTestResult };

export function ModelKeysScreen({ onBack, onToast, onChanged }: {
  onBack: () => void;
  onToast: (text: string) => void;
  /** 密钥存好 / 清掉之后通知外层（刷新「我的」里的状态、让常驻服务开始替它触发定时内容）。 */
  onChanged?: (active: boolean) => void;
}) {
  const theme = useTheme();
  const allowed = modelKeysSupported && keysAllowedOn(API_BASE);
  const [saved, setSaved] = useState<ModelKeys>(currentModelKeys());
  const [stepfun, setStepfun] = useState("");
  const [deepseek, setDeepseek] = useState("");
  const [policy, setPolicy] = useState<KeyPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<TestState>({});

  useEffect(() => {
    let alive = true;
    loadModelKeys().then((k) => { if (alive) setSaved({ ...k }); });
    getKeyPolicy().then((p) => { if (alive) setPolicy(p); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // 没改的那一把沿用已保存的；输入框只在用户要换 key 时才填
  const next: ModelKeys = {
    stepfun: normalizeKey(stepfun) || saved.stepfun,
    deepseek: normalizeKey(deepseek) || saved.deepseek,
  };
  const stepfunError = keyProblem(stepfun) ?? undefined;
  const deepseekError = keyProblem(deepseek) ?? undefined;
  const dirty = Boolean(normalizeKey(stepfun) || normalizeKey(deepseek));
  const canSave = allowed && dirty && !stepfunError && !deepseekError && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setTested({});
    try {
      const result = await testModelKeys(next);
      setTested(result);
      if (!allProvidedOk(result)) {
        onToast("有密钥没通过测试，先看看下面的提示");
        return;
      }
      await saveModelKeys(next);
      setSaved({ ...next });
      setStepfun("");
      setDeepseek("");
      // 告诉后端这台手机用自己的密钥；没告诉成也没关系，手机来触发时后端会自己补上
      await setOwnKeyFlag(true).catch(() => undefined);
      onChanged?.(true);
      onToast("密钥存好了，之后用你自己的额度");
    } catch (error: any) {
      onToast(error?.message || "这次没存上，待会儿再试试");
    } finally {
      setBusy(false);
    }
  };

  const clear = () => Alert.alert(
    "清除密钥？",
    policy?.byok_required
      ? "清除后，需要模型的功能（聊天、来信、语音）会用不了，直到你重新填上。"
      : "清除后恢复使用喵灵提供的额度。",
    [
      { text: "先留着", style: "cancel" },
      {
        text: "清除", style: "destructive", onPress: async () => {
          setBusy(true);
          try {
            await clearModelKeys();
            setSaved({ stepfun: "", deepseek: "" });
            setTested({});
            await setOwnKeyFlag(false).catch(() => undefined);
            onChanged?.(false);
            onToast("密钥已从这台手机清除");
          } catch {
            onToast("没清成，待会儿再试试");
          } finally {
            setBusy(false);
          }
        },
      },
    ],
  );

  const caption = [theme.typography.textStyles.caption, { color: theme.colors.textSecondary }];
  const strong = [theme.typography.textStyles.bodyStrong, { color: theme.colors.textPrimary }];

  const status = (name: string, savedKey: string, result?: KeyTestResult) => {
    const message = testMessage(name, result);
    if (message) {
      return <Text style={[theme.typography.textStyles.caption, { color: result?.ok ? theme.colors.success : theme.colors.error }]}>{message}</Text>;
    }
    return <Text style={caption}>{savedKey ? `已保存：${maskKey(savedKey)}` : "还没有填"}</Text>;
  };

  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
      <PageContainer maxWidth={720}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3], marginBottom: theme.spacing[6] }}>
          <IconButton accessibilityLabel="返回" onPress={onBack} icon={<ArrowLeft size={20} color={theme.colors.textSecondary} />} />
          <View style={{ flex: 1, minWidth: 0, paddingTop: theme.spacing[1] }}>
            <Text style={[theme.typography.textStyles.label, { color: theme.colors.accent }]}>只存在这台手机上</Text>
            <Text accessibilityRole="header" style={[theme.typography.textStyles.pageTitle, { marginTop: theme.spacing[2], color: theme.colors.textPrimary }]}>模型与密钥</Text>
            <Text style={[theme.typography.textStyles.body, { marginTop: theme.spacing[3], color: theme.colors.textSecondary }]}>
              填上你自己的模型密钥，喵灵就用你的额度工作。密钥只保存在这台手机里，用的时候经加密连接转交给模型服务商，喵灵的服务器不保存它。
            </Text>
          </View>
        </View>

        {!allowed ? (
          <Card variant="emphasized" style={{ marginBottom: theme.spacing[5] }}>
            <View style={{ flexDirection: "row", gap: theme.spacing[4] }}>
              <ShieldAlert size={22} color={theme.colors.warning} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={strong}>{modelKeysSupported ? "现在还不能填" : "这个平台暂不支持"}</Text>
                <Text style={caption}>
                  {modelKeysSupported
                    ? "这台手机和喵灵服务器之间还不是加密连接，密钥这样传不安全，所以先不开放。等加密连接上线后，这里就能填了。"
                    : "自带密钥需要系统的安全存储，目前只在 Android 版里提供。"}
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        {policy?.byok_required && !hasAnyKey(saved) ? (
          <Card variant="emphasized" style={{ marginBottom: theme.spacing[5] }}>
            <Text style={strong}>需要先填一把密钥</Text>
            <Text style={[...caption, { marginTop: 4 }]}>现在喵灵不再提供公共额度，聊天、来信和语音都要用你自己的密钥。</Text>
          </Card>
        ) : null}

        <Card style={{ gap: theme.spacing[4], marginBottom: theme.spacing[5] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
            <KeyRound size={20} color={theme.colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={strong}>阶跃星辰</Text>
              <Text style={caption}>聊天、看图、语音和通话都用它{policy ? `（${policy.text_model}）` : ""}。</Text>
            </View>
          </View>
          <TextField
            accessibilityLabel="阶跃星辰密钥"
            autoCapitalize="none" autoCorrect={false} secureTextEntry editable={allowed && !busy}
            placeholder={saved.stepfun ? "粘贴新的密钥来替换" : "粘贴阶跃星辰的 API Key"}
            value={stepfun} onChangeText={(t) => { setStepfun(t); setTested({}); }} error={stepfunError}
          />
          {status("阶跃星辰", saved.stepfun, tested.stepfun)}
        </Card>

        <Card style={{ gap: theme.spacing[4], marginBottom: theme.spacing[5] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
            <KeyRound size={20} color={theme.colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={strong}>DeepSeek（选填，备用）</Text>
              <Text style={caption}>只在阶跃暂时不可用时接手文字回复。它看不了图片，也不管语音。</Text>
            </View>
          </View>
          <TextField
            accessibilityLabel="DeepSeek 密钥"
            autoCapitalize="none" autoCorrect={false} secureTextEntry editable={allowed && !busy}
            placeholder={saved.deepseek ? "粘贴新的密钥来替换" : "粘贴 DeepSeek 的 API Key"}
            value={deepseek} onChangeText={(t) => { setDeepseek(t); setTested({}); }} error={deepseekError}
          />
          {status("DeepSeek", saved.deepseek, tested.deepseek)}
        </Card>

        <View style={{ flexDirection: "row", gap: theme.spacing[3], marginBottom: theme.spacing[6] }}>
          <Button loading={busy} disabled={!canSave} onPress={save}>测试并保存</Button>
          {hasAnyKey(saved) ? <Button variant="ghost" disabled={busy} onPress={clear}>清除密钥</Button> : null}
        </View>

        <Card style={{ gap: theme.spacing[3] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
            <LockKeyhole size={18} color={theme.colors.textSecondary} />
            <Text style={strong}>填了密钥以后</Text>
          </View>
          <Text style={caption}>· 聊天、倾倒、语音、场景都用你的额度，不再用喵灵的。</Text>
          <Text style={caption}>· 晚间来信、睡前提醒、周报改由这台手机到点去触发。请保持「常驻陪伴」开着；手机长时间断网时，信会晚一些到。</Text>
          <Text style={caption}>· 换手机或重装后需要重新填一次：密钥不会跟着账号走。</Text>
        </Card>
      </PageContainer>
    </ScrollView>
  );
}
