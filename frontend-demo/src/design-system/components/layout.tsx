import React from "react";
import {
  Platform,
  SafeAreaView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useResponsive } from "../responsive";
import { useTheme } from "../theme";
import { spacing } from "../tokens";
import {
  BottomNavigation,
  SideNavigation,
  type AppTab,
} from "./navigation";

type AppShellProps = {
  activeTab: AppTab;
  background?: React.ReactNode;
  children: React.ReactNode;
  onTabChange: (tab: AppTab) => void;
  showNavigation: boolean;
  toast?: React.ReactNode;
};

export function AppShell({
  activeTab,
  background,
  children,
  onTabChange,
  showNavigation,
  toast,
}: AppShellProps) {
  const theme = useTheme();
  const { isExpanded } = useResponsive();
  const showSideNavigation = showNavigation && isExpanded;

  const content = (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
        backgroundColor: theme.colors.background,
      }}
    >
      {background}
      <View style={{ flex: 1 }}>{children}</View>
      {toast}
      {showNavigation && !showSideNavigation && (
        <BottomNavigation active={activeTab} onChange={onTabChange} />
      )}
    </View>
  );

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: theme.colors.backgroundSubtle,
      }}
    >
      {showSideNavigation ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <SideNavigation active={activeTab} onChange={onTabChange} />
          {content}
        </View>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

type PageContainerProps = {
  children: React.ReactNode;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
};

export function PageContainer({
  children,
  maxWidth = 1120,
  style,
}: PageContainerProps) {
  const { isCompact, isMedium } = useResponsive();
  const horizontalPadding = isCompact
    ? spacing[5]
    : isMedium
      ? spacing[8]
      : spacing[10];

  return (
    <View
      style={[
        {
          width: "100%",
          maxWidth,
          alignSelf: "center",
          paddingHorizontal: horizontalPadding,
          paddingTop: isCompact ? spacing[5] : spacing[8],
          paddingBottom: isCompact ? 96 : spacing[10],
        },
        Platform.OS === "web" ? ({ marginHorizontal: "auto" } as ViewStyle) : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

type PageHeaderProps = {
  action?: React.ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
};

export function PageHeader({
  action,
  description,
  eyebrow,
  title,
}: PageHeaderProps) {
  const theme = useTheme();
  const { isCompact } = useResponsive();

  return (
    <View
      style={{
        marginBottom: isCompact ? spacing[6] : spacing[8],
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: spacing[4],
      }}
    >
      <View style={{ flex: 1, maxWidth: 680 }}>
        {eyebrow ? (
          <Text
            style={[
              theme.typography.textStyles.ambient,
              {
                marginBottom: spacing[2],
                color: theme.colors.accent,
              },
            ]}
          >
            {eyebrow}
          </Text>
        ) : null}
        <Text
          accessibilityRole="header"
          style={[
            theme.typography.textStyles.pageTitle,
            {
              fontFamily: theme.typography.fontFamilies.sans,
              color: theme.colors.textPrimary,
            },
          ]}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={[
              theme.typography.textStyles.body,
              {
                marginTop: spacing[2],
                color: theme.colors.textSecondary,
              },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}
