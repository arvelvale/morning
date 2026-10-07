import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from "react-native";

import { useTheme } from "../theme";
import { controlHeights, iconSizes, spacing, touchTarget } from "../tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "compact" | "default" | "large";

type ButtonProps = {
  children: React.ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  loading?: boolean;
  onPress?: () => void;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function Button({
  children,
  disabled = false,
  fullWidth = false,
  loading = false,
  onPress,
  size = "default",
  variant = "primary",
}: ButtonProps) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const inactive = disabled || loading;

  const backgroundColor = (() => {
    if (inactive) return theme.colors.disabledSurface;
    if (variant === "primary") {
      // 主按钮必须是实心 accent：半透明 accentSurface + 浅色字会像禁用态。
      if (hovered) return theme.colors.accentHover;
      return theme.colors.accent;
    }
    if (variant === "danger") return theme.colors.error;
    if (variant === "secondary") {
      return hovered ? theme.colors.surfaceHover : theme.colors.surface;
    }
    return hovered ? theme.colors.surfaceHover : "transparent";
  })();

  const foregroundColor = inactive
    ? theme.colors.disabledText
    : variant === "danger"
      ? theme.colors.textOnDanger
      : variant === "primary"
        ? theme.colors.textOnAccent
        : theme.colors.textPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={({ pressed }) => ({
        width: fullWidth ? "100%" : undefined,
        minHeight: controlHeights[size],
        paddingHorizontal:
          size === "compact" ? spacing[3] : size === "large" ? spacing[6] : spacing[5],
        borderRadius: theme.radii.control,
        borderWidth: variant === "secondary" ? 1 : 0,
        borderColor: theme.colors.border,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing[2],
        backgroundColor:
          pressed && variant === "primary"
            ? theme.colors.accentPressed
            : backgroundColor,
        opacity: inactive ? 0.82 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {loading ? <ActivityIndicator size="small" color={foregroundColor} /> : null}
      <Text
        style={[
          theme.typography.textStyles.bodyStrong,
          { color: foregroundColor },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

type IconButtonProps = {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
};

export function IconButton({
  accessibilityLabel,
  disabled = false,
  icon,
  onPress,
  selected = false,
}: IconButtonProps) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={({ pressed }) => ({
        width: touchTarget.minimum,
        height: touchTarget.minimum,
        borderRadius: theme.radii.control,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: selected
          ? theme.colors.accentSoft
          : hovered
            ? theme.colors.surfaceHover
            : "transparent",
        opacity: disabled ? 0.5 : pressed ? 0.78 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {icon}
    </Pressable>
  );
}

type FieldProps = TextInputProps & {
  error?: string;
  label?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
};

function Field({
  error,
  label,
  leading,
  multiline,
  style,
  trailing,
  ...props
}: FieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ width: "100%", gap: spacing[2] }}>
      {label ? (
        <Text
          style={[
            theme.typography.textStyles.label,
            { color: theme.colors.textSecondary },
          ]}
        >
          {label}
        </Text>
      ) : null}
      <View
        style={{
          minHeight: multiline ? 112 : controlHeights.default,
          paddingLeft: leading ? spacing[3] : spacing[4],
          paddingRight: trailing ? spacing[1] : spacing[4],
          borderRadius: theme.radii.control,
          borderWidth: focused ? 2 : 1,
          borderColor: error
            ? theme.colors.error
            : focused
              ? theme.colors.focus
              : theme.colors.border,
          backgroundColor: theme.colors.surface,
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          gap: spacing[2],
        }}
      >
        {leading ? (
          <View style={{ paddingTop: multiline ? spacing[3] : 0 }}>{leading}</View>
        ) : null}
        <TextInput
          {...props}
          multiline={multiline}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          placeholderTextColor={theme.colors.placeholder}
          selectionColor={theme.colors.accent}
          style={[
            theme.typography.textStyles.body,
            {
              flex: 1,
              minHeight: multiline ? 110 : controlHeights.default - 2,
              paddingHorizontal: 0,
              paddingVertical: multiline ? spacing[3] : spacing[2],
              color: theme.colors.textPrimary,
              textAlignVertical: multiline ? "top" : "center",
              outlineWidth: 0,
              outlineStyle: "none",
            } as unknown as TextStyle,
            style,
          ]}
        />
        {trailing}
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[theme.typography.textStyles.caption, { color: theme.colors.error }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function TextField(props: FieldProps) {
  return <Field {...props} multiline={false} />;
}

export function TextArea(props: FieldProps) {
  return <Field {...props} multiline />;
}

export const defaultIconSize = iconSizes.default;
