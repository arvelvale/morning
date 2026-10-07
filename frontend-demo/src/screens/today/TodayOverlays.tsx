/**
 * 首页的两个抽屉（倒出来 / 今天接住的）和飞行中的纸条。
 * 它们要盖住底栏，所以挂在 App 根部，状态来自 TodayContext。
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, Text, TextInput, View, type TextStyle } from "react-native";
import { Bell, Check, Mic, Plus, Square, X } from "lucide-react-native";

import { Button, IconButton, useReducedMotion, useTheme } from "../../design-system";
import { useGuide } from "../../guide/Guide";
import { measureTarget, useTarget, type Rect } from "../../guide/targets";
import { useVoiceInput } from "../../useVoiceInput";
import { KIND_LABEL, KIND_WHERE, isTomorrow, type CaughtItem, type CaughtKind } from "./caught";
import { useToday, type Flight } from "./TodayContext";
import { kindColors } from "./TodayScreen";

/** 引导时给的几句示范：各落进一类，让第一次的回执就能看到分类。 */
const GUIDE_SAMPLES: { text: string; kind: CaughtKind }[] = [
  { text: "明天要交实训材料", kind: "todo" },
  { text: "今天有点累", kind: "mood" },
  { text: "想做个小游戏", kind: "idea" },
];

export function TodayOverlays({ visible }: { visible: boolean }) {
  const today = useToday();
  const guide = useGuide();
  if (!visible) return null;
  const anyOpen = today.dumpOpen || today.caughtOpen;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 50, elevation: 50 }}>
      <Scrim
        onPress={() => {
          if (guide.active) return;
          today.closeDump();
          today.closeCaught();
        }}
        visible={anyOpen}
      />
      <DumpSheet />
      <CaughtSheet />
      {today.flights.map((f) => <FlyingNote flight={f} key={f.id} onDone={() => today.landed(f.id)} />)}
    </View>
  );
}

function Scrim({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const theme = useTheme();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: visible ? 1 : 0, duration: 260, useNativeDriver: true }).start();
  }, [visible, a]);
  return (
    <Animated.View pointerEvents={visible ? "auto" : "none"} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: a }}>
      <Pressable accessibilityLabel="收起" onPress={onPress} style={{ flex: 1, backgroundColor: theme.colors.scrim }} />
    </Animated.View>
  );
}

/** 从底部滑上来的抽屉。 */
function Sheet({ open, children, targetRef }: {
  open: boolean;
  children: React.ReactNode;
  targetRef?: (v: View | null) => void;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const y = useRef(new Animated.Value(1)).current;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(y, {
      toValue: open ? 0 : 1,
      duration: reduced ? 0 : open ? 380 : 260,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished && !open) setMounted(false); });
  }, [open, reduced, y]);
  if (!mounted) return null;
  return (
    <Animated.View
      collapsable={false}
      pointerEvents={open ? "auto" : "none"}
      ref={targetRef as any}
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        maxWidth: 640, alignSelf: "center", width: "100%",
        paddingHorizontal: 18, paddingTop: 10, paddingBottom: 22,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        backgroundColor: theme.colors.surface,
        ...theme.shadows.floating,
        transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, 520] }) }],
      }}
    >
      <View style={{ width: 38, height: 4.5, borderRadius: 3, backgroundColor: theme.colors.border, alignSelf: "center", marginBottom: 10 }} />
      {children}
    </Animated.View>
  );
}

function SheetHeader({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={[theme.typography.textStyles.sectionTitle, { fontSize: 22, lineHeight: 30, color: theme.colors.textPrimary }]}>
        {title}
        {sub ? <Text style={[theme.typography.textStyles.caption, { fontFamily: undefined, color: theme.colors.textMuted }]}>{`  ${sub}`}</Text> : null}
      </Text>
      <IconButton accessibilityLabel="收起" icon={<X color={theme.colors.textSecondary} size={20} />} onPress={onClose} />
    </View>
  );
}

function DumpSheet() {
  const theme = useTheme();
  const today = useToday();
  const guide = useGuide();
  const input = useRef<TextInput>(null);
  const sheetRef = useTarget("dump-sheet");
  const inputRef = useTarget("dump-input");
  const voice = useVoiceInput((text) => today.setDraft(today.draft.trim() ? `${today.draft.trim()}，${text}` : text));

  useEffect(() => {
    if (!today.dumpOpen) {
      input.current?.blur();
      return;
    }
    const t = setTimeout(() => input.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [today.dumpOpen]);

  const addSample = (text: string) => {
    if (today.draft.includes(text)) return;
    today.setDraft(today.draft.trim() ? `${today.draft.replace(/[，,\s]*$/, "")}，${text}` : text);
    today.typingPulse();
  };
  const canSend = !!today.draft.trim() && !today.dumping;

  return (
    <Sheet open={today.dumpOpen} targetRef={sheetRef}>
      <SheetHeader onClose={today.closeDump} sub="想到哪说到哪" title="倒出来" />
      <View collapsable={false} ref={inputRef} style={{ marginTop: 6, borderRadius: 18, backgroundColor: theme.colors.backgroundSubtle }}>
        <TextInput
          accessibilityLabel="想说的话"
          multiline
          onChangeText={(t) => { today.setDraft(t); today.typingPulse(); }}
          placeholder="比如：明天要交实训材料，好累，还想做个小游戏…"
          placeholderTextColor={theme.colors.placeholder}
          ref={input}
          selectionColor={theme.colors.accent}
          style={[theme.typography.textStyles.body, {
            minHeight: 104, maxHeight: 200, paddingHorizontal: 14, paddingVertical: 12,
            fontSize: 16, lineHeight: 24, color: theme.colors.textPrimary, textAlignVertical: "top", outlineWidth: 0,
          } as TextStyle]}
          value={today.draft}
        />
      </View>
      {guide.active ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
          {GUIDE_SAMPLES.map((s) => {
            const used = today.draft.includes(s.text);
            const c = kindColors(theme, s.kind);
            return (
              <Pressable
                accessibilityLabel={`加上：${s.text}`}
                accessibilityRole="button"
                key={s.text}
                onPress={() => addSample(s.text)}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 8, paddingRight: 11, paddingVertical: 5,
                  borderRadius: 999, backgroundColor: c.bg, opacity: used ? 0.4 : 1, transform: [{ scale: pressed ? 0.95 : 1 }],
                })}
              >
                <Plus color={c.fg} size={14} />
                <Text style={[theme.typography.textStyles.caption, { color: c.fg }]}>{s.text}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <Pressable
          accessibilityLabel={voice.isRecording ? "停止录音" : "说给它听"}
          accessibilityRole="button"
          disabled={voice.transcribing}
          onPress={voice.isRecording ? voice.stop : voice.start}
          style={({ pressed }) => ({
            width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center",
            backgroundColor: voice.isRecording ? theme.colors.accentSurface : theme.colors.backgroundSubtle,
            transform: [{ scale: pressed ? 0.95 : 1 }],
          })}
        >
          {voice.isRecording
            ? <Square color={theme.colors.accent} fill={theme.colors.accent} size={15} />
            : <Mic color={theme.colors.textPrimary} size={20} />}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Button disabled={!canSend} fullWidth onPress={() => void today.submitDump()} size="large">
            {`倒给${today.petName}`}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

function CaughtSheet() {
  const theme = useTheme();
  const today = useToday();
  const firstTodoId = today.items.find((x) => x.kind === "todo")?.id;
  return (
    <Sheet open={today.caughtOpen}>
      <SheetHeader onClose={today.closeCaught} sub={`${today.items.length} 件`} title="今天接住的" />
      <ScrollView style={{ maxHeight: 360, marginTop: 6 }} contentContainerStyle={{ gap: 8 }}>
        {today.items.map((item) => (
          <CaughtRow first={item.id === firstTodoId} item={item} key={item.id} />
        ))}
      </ScrollView>
      <Text style={[theme.typography.textStyles.label, { color: theme.colors.textMuted, fontWeight: "400", textAlign: "center", marginTop: 12 }]}>
        全部思绪都在信箱的「思绪」里
      </Text>
    </Sheet>
  );
}

function CaughtRow({ item, first }: { item: CaughtItem; first: boolean }) {
  const theme = useTheme();
  const today = useToday();
  const remindRef = useTarget("remind-first");
  const c = kindColors(theme, item.kind);
  const on = !!item.remindAt;
  return (
    <View style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: 18, backgroundColor: theme.colors.backgroundSubtle }}>
      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: c.bg, alignSelf: "flex-start", marginTop: 1 }}>
        <Text style={[theme.typography.textStyles.label, { color: c.fg, fontWeight: "600" }]}>{KIND_LABEL[item.kind]}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={[theme.typography.textStyles.body, { color: theme.colors.textPrimary }]}>{item.text}</Text>
        {item.kind === "todo" ? (
          <View collapsable={false} ref={first ? remindRef : undefined} style={{ alignSelf: "flex-start" }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ checked: on }}
              disabled={on}
              onPress={() => void today.remind(item)}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 9, paddingRight: 12, paddingVertical: 5,
                borderRadius: 999, borderWidth: on ? 0 : 1.5, borderColor: c.fg,
                backgroundColor: on ? c.fg : "transparent", transform: [{ scale: pressed ? 0.95 : 1 }],
              })}
            >
              {on ? <Check color={theme.colors.surface} size={14} /> : <Bell color={c.fg} size={14} />}
              <Text style={[theme.typography.textStyles.label, { color: on ? theme.colors.surface : c.fg, fontWeight: "600" }]}>
                {on ? (isTomorrow(item.remindAt) ? "明早 8:00 叫你" : "已设提醒") : "明早提醒我"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Text style={[theme.typography.textStyles.label, { color: theme.colors.textMuted, fontWeight: "400" }]}>{KIND_WHERE[item.kind]}</Text>
        )}
      </View>
    </View>
  );
}

/** 一张纸条：沿弧线从输入框飞进米露抱着的星星。 */
function FlyingNote({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  const [path, setPath] = useState<{ xs: number[]; ys: number[] } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!size) return;
    let alive = true;
    void measureTarget("hero-star").then((star: Rect | null) => {
      if (!alive) return;
      const end = star ? { x: star.x + star.w / 2, y: star.y + star.h / 2 } : { x: flight.from.x + 120, y: flight.from.y - 300 };
      const sx = flight.from.x + size.w / 2, sy = flight.from.y;
      const cx = (sx + end.x) / 2 - 50, cy = Math.min(sy, end.y) - 120;
      const xs: number[] = [], ys: number[] = [];
      for (let q = 0; q <= 12; q++) {
        const p = q / 12, u = 1 - p;
        xs.push(u * u * sx + 2 * u * p * cx + p * p * end.x - size.w / 2);
        ys.push(u * u * sy + 2 * u * p * cy + p * p * end.y - size.h / 2);
      }
      setPath({ xs, ys });
      Animated.timing(t, {
        toValue: 1,
        duration: reduced ? 1 : 1000,
        delay: reduced ? 0 : flight.delay,
        easing: Easing.bezier(0.45, 0, 0.25, 1),
        useNativeDriver: true,
      }).start(() => onDone());
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const input = Array.from({ length: 13 }, (_, i) => i / 12);
  return (
    <Animated.View
      onLayout={(e) => { if (!size) setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }); }}
      pointerEvents="none"
      style={{
        position: "absolute", left: 0, top: 0,
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingLeft: 9, paddingRight: 11, paddingVertical: 6, borderRadius: 11,
        backgroundColor: theme.colors.surface, ...theme.shadows.floating,
        opacity: path ? t.interpolate({ inputRange: [0, 0.88, 1], outputRange: [1, 1, 0] }) : 0,
        transform: path ? [
          { translateX: t.interpolate({ inputRange: input, outputRange: path.xs }) },
          { translateY: t.interpolate({ inputRange: input, outputRange: path.ys }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: [flight.id % 2 ? "7deg" : "-7deg", "0deg"] }) },
          { scale: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.85, 0.2] }) },
        ] : [],
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.star }} />
      <Text style={[theme.typography.textStyles.caption, { color: theme.colors.textPrimary }]}>{flight.text}</Text>
    </Animated.View>
  );
}
