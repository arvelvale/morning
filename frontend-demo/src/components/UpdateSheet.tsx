/**
 * UpdateSheet —— 版本更新提示（方案 C 底部抽屉）。
 *
 * 纯展示组件：由 App.tsx 在检测到新版本时挂载。展示版本号、更新要点、下载按钮；
 * 「立即更新」「以后再说」的具体行为由父组件通过回调决定；后者只关闭当前提示。
 * 视觉全部走 design-system token，夜间模式自适应；升起动画 260ms，尊重 reduced motion。
 */
import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Image, Pressable, ScrollView, Text, View } from "react-native";

import { paperColors, useTheme } from "../design-system";
import type { ApkUpdateState } from "../apkUpdater";
import { CURRENT_VERSION, type AvailableUpdateInfo } from "../updateCheck";

interface UpdateSheetProps {
  info: AvailableUpdateInfo;
  updateState: ApkUpdateState;
  /** 点击「立即更新」：父组件负责应用内下载、校验并交给系统安装器。 */
  onUpdate: () => void;
  /** 点击「以后再说」或点遮罩：只关闭当前提示，下次进入 App 仍可再次展示。 */
  onLater: () => void;
}

export function UpdateSheet({ info, updateState, onUpdate, onLater }: UpdateSheetProps) {
  const theme = useTheme();
  const slide = useRef(new Animated.Value(1)).current; // 1=完全在屏外，0=就位

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!mounted) return;
      if (reduced) {
        slide.setValue(0);
      } else {
        Animated.timing(slide, {
          toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }).start();
      }
    });
    return () => { mounted = false; };
  }, [slide]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 460] });
  const sizeText = info.size_mb ? ` · ${info.size_mb} MB` : "";
  const busy = updateState.phase === "downloading" || updateState.phase === "verifying";
  // DownloadManager 不依赖当前页面；可选更新在下载时也允许收起抽屉。
  const canDismiss = !info.required && updateState.phase !== "verifying";
  const progressPercent = Math.round(updateState.progress * 100);
  const actionLabel =
    updateState.phase === "downloading" ? `正在下载 ${progressPercent}%`
      : updateState.phase === "downloaded" ? "安装更新"
      : updateState.phase === "verifying" ? "正在校验安装包…"
        : updateState.phase === "permission_required" ? "授权后继续安装"
          : updateState.phase === "installer_opened" ? "重新打开安装器"
            : updateState.phase === "error" ? "重新下载"
              : "立即更新";
  const statusText =
    updateState.phase === "downloading" && updateState.downloadStatus === "paused"
      ? "网络暂不可用，Android 会在条件恢复后继续下载。"
      : updateState.phase === "downloaded"
        ? "安装包已经下载完成，点击安装后会先校验完整性与签名。"
        : updateState.phase === "permission_required"
      ? "Android 需要你允许「安装未知应用」，授权后回到这里继续。"
      : updateState.phase === "installer_opened"
        ? "系统安装界面已打开；如果刚才取消了，可以再次打开。"
        : updateState.error;

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end", zIndex: 60 }}>
      {/* 遮罩：点击 = 以后再说 */}
      <Pressable
        accessibilityLabel={canDismiss ? "以后再说" : "更新提示"}
        onPress={canDismiss ? onLater : undefined}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.overlay }}
      />

      <Animated.View
        style={{
          transform: [{ translateY }],
          backgroundColor: theme.colors.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingHorizontal: theme.spacing[6],
          paddingTop: theme.spacing[3],
          paddingBottom: theme.spacing[8],
          ...theme.shadows.floating,
        }}
      >
        {/* 抓手条 */}
        <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: "center", marginBottom: theme.spacing[5] }} />

        {/* 标题行：徽标 + 版本 */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], marginBottom: theme.spacing[4] }}>
          <View style={{ width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" }}>
            <Image
              accessibilityLabel="喵灵"
              source={require("../../assets/icon.png")}
              style={{ width: 34, height: 34 }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: "600", color: theme.colors.textPrimary }}>
              {info.required ? "需要更新" : "新版本"} v{info.latest}
            </Text>
            <Text style={{ fontSize: 12.5, marginTop: 2, color: theme.colors.textMuted }}>
              当前 v{CURRENT_VERSION} · 建议更新{sizeText}
            </Text>
          </View>
        </View>

        {/* 更新要点卡 */}
        {info.changelog.length > 0 && (
          <View style={{ backgroundColor: theme.colors.backgroundSubtle, borderRadius: theme.radii.card, padding: theme.spacing[4], marginBottom: theme.spacing[5] }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.textSecondary, marginBottom: theme.spacing[3] }}>
              这次更新
            </Text>
            <ScrollView style={{ maxHeight: 168 }} showsVerticalScrollIndicator={false}>
              {info.changelog.map((line, i) => (
                <View key={i} style={{ flexDirection: "row", gap: theme.spacing[2], marginBottom: i === info.changelog.length - 1 ? 0 : theme.spacing[2] }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.focus, marginTop: 7 }} />
                  <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 20, color: paperColors.body }}>{line}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {updateState.phase === "downloading" && (
          <View style={{ marginBottom: theme.spacing[4] }}>
            <View style={{ height: 7, borderRadius: 999, overflow: "hidden", backgroundColor: theme.colors.backgroundSubtle }}>
              <View style={{ width: `${progressPercent}%`, height: "100%", borderRadius: 999, backgroundColor: theme.colors.focus }} />
            </View>
            <Text style={{ marginTop: theme.spacing[2], fontSize: 12.5, color: theme.colors.textMuted }}>
              可切到后台或锁屏，Android 会继续下载并在完成后通知你
            </Text>
          </View>
        )}

        {statusText ? (
          <Text style={{ marginBottom: theme.spacing[4], fontSize: 12.5, lineHeight: 19, color: updateState.phase === "error" ? theme.colors.error : theme.colors.textSecondary }}>
            {statusText}
          </Text>
        ) : null}

        {/* 立即更新 */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={onUpdate}
          style={({ pressed }) => ({
            borderRadius: theme.radii.pill,
            paddingVertical: 14,
            alignItems: "center",
            backgroundColor: theme.colors.accent,
            transform: [{ scale: pressed ? 0.97 : 1 }],
            opacity: busy ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: theme.colors.textOnAccent }}>{actionLabel}</Text>
        </Pressable>

        {/* 以后再说 */}
        {!info.required && (
          <Pressable accessibilityRole="button" disabled={updateState.phase === "verifying"} onPress={onLater} style={{ paddingVertical: theme.spacing[2], alignItems: "center", marginTop: theme.spacing[1], opacity: updateState.phase === "verifying" ? 0.45 : 1 }}>
            <Text style={{ fontSize: 13, color: theme.colors.textMuted }}>以后再说</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}
