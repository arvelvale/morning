import React from "react";
import { View } from "react-native";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";

/** 米露的小头像：引导提示、轻提示里「它在说话」的标记。黑猫 + 发光眼，日夜同色。 */
export function CatHead({ size = 34 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#231D1A",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: "rgba(255,212,103,0.6)",
      }}
    >
      <Svg width={size * 0.86} height={size * 0.86} viewBox="0 0 40 40">
        <Path d="M7 17 8.6 4.5 18 11ZM33 17 31.4 4.5 22 11Z" fill="#231D1A" />
        <Path d="M9.6 8.6l.8 5 3.6-2.6Z" fill="#F2A5B3" />
        <Circle cx={20} cy={23} r={13.5} fill="#231D1A" />
        <Ellipse cx={14.6} cy={22.4} rx={2.7} ry={4.2} fill="#FFF6DF" />
        <Ellipse cx={25.4} cy={22.4} rx={2.7} ry={4.2} fill="#FFF6DF" />
        <Path d="M18 29.2q1 1 2 0q1 1 2 0" fill="none" stroke="#FFE6AE" strokeWidth={1.3} strokeLinecap="round" />
      </Svg>
    </View>
  );
}
