/**
 * WebGL 可用性守卫（仅 Web 生效）。
 *
 * 背景：expo-gl 的 web 实现在四连尝试（webgl2/webgl/experimental）都拿不到
 * 上下文时会直接 invariant 抛错；没有边界时表现为整页白屏。
 * 典型诱因是浏览器侧问题：关闭了"使用图形加速"、显卡驱动崩溃后未恢复、
 * 快捷方式带 --disable-gpu、企业策略禁用 WebGL——先看 about://gpu 的 WebGL 行。
 */
import React from "react";
import { Platform, Pressable, Text, View } from "react-native";

/** 探测当前浏览器能否创建 WebGL 上下文（非 web 平台恒 true）。 */
export function isWebGLAvailable(): boolean {
  if (Platform.OS !== "web") return true;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** 无 WebGL 时的说明卡（替代白屏）。 */
export function WebGLUnavailable() {
  return (
    <View style={{ flex: 1, backgroundColor: "#12100e", alignItems: "center", justifyContent: "center", padding: 28 }}>
      <Text style={{ color: "#f0ead8", fontSize: 15, lineHeight: 22, textAlign: "center" }}>
        这个浏览器的 WebGL 当前不可用，3D 片场渲染不了。
      </Text>
      <Text style={{ color: "rgba(240,234,216,0.65)", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 10 }}>
        打开浏览器设置确认「使用图形加速」已开启{"\n"}
        （地址栏进 about://gpu 看 WebGL 是否为 Hardware accelerated），{"\n"}
        重启浏览器或换 Chrome / Edge 再试；不影响手机端。
      </Text>
    </View>
  );
}

interface BoundaryState { err: Error | null }

/** 3D 场景专用错误边界：任何渲染期异常给出文案+重试，不再白屏。 */
export class SceneErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { err: null };

  static getDerivedStateFromError(err: Error): BoundaryState {
    return { err };
  }

  render() {
    const { err } = this.state;
    if (err) {
      return (
        <View style={{ flex: 1, backgroundColor: "#12100e", alignItems: "center", justifyContent: "center", padding: 28 }}>
          <Text style={{ color: "#f0ead8", fontSize: 14, lineHeight: 21, textAlign: "center" }}>
            3D 场景渲染出错：{String(err?.message ?? err)}
          </Text>
          <Pressable
            onPress={() => this.setState({ err: null })}
            style={{ marginTop: 16, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(246,231,168,0.9)" }}
          >
            <Text style={{ color: "#463f3c", fontSize: 13, fontWeight: "600" }}>重试</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
