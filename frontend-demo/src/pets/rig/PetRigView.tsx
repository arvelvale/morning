import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { PET_RIG_SOURCE } from "./petRigSource.generated";
import type { PetRigProps } from "./types";

/** 音量变化很密（每个音频块一次），桥接只按这个间隔发。 */
const LEVEL_INTERVAL_MS = 66;

function buildHtml(init: object): string {
  // 运行时里没有 </script>，这里仍然转义一次，防止以后改动把内嵌脚本截断
  const source = PET_RIG_SOURCE.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}#r{position:fixed;inset:0}</style>
</head><body><div id="r"></div><script>${source}</script><script>
(function(){
  var post=function(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(m);};
  try{window.__rig=PetRig.mountPet(document.getElementById('r'),${JSON.stringify(init)});post('ready');}
  catch(e){post('error:'+(e&&e.message));}
})();
</script></body></html>`;
}

/**
 * 原生端：WebView 里跑同一份 pet-rig.js（与网页端、官网、鸿蒙共用）。
 * 状态变化通过 injectJavaScript 下发，WebView 只在换角色时重建。
 */
export function PetRigView({
  pet,
  mood = "idle",
  night = false,
  level = 0,
  reduceMotion = false,
  paused = false,
  pokeKey,
  onReady,
  onError,
  style,
}: PetRigProps) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const lastLevelAt = useRef(0);
  // 初始参数只在换角色时使用；之后的变化走 set()
  const html = useMemo(
    () => buildHtml({ pet, mood, night, reduceMotion }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pet],
  );

  const send = (js: string) => ref.current?.injectJavaScript(`try{${js}}catch(e){}true;`);

  useEffect(() => {
    if (ready) send(`__rig.set(${JSON.stringify({ mood, night, reduceMotion })})`);
  }, [ready, mood, night, reduceMotion]);

  useEffect(() => {
    if (!ready) return;
    const now = Date.now();
    if (now - lastLevelAt.current < LEVEL_INTERVAL_MS && level !== 0) return;
    lastLevelAt.current = now;
    send(`__rig.set({level:${level.toFixed(2)}})`);
  }, [ready, level]);

  useEffect(() => {
    if (ready) send(paused ? "__rig.pause()" : "__rig.resume()");
  }, [ready, paused]);

  useEffect(() => {
    if (ready && pokeKey) send("__rig.poke()");
  }, [ready, pokeKey]);

  const onMessage = (event: WebViewMessageEvent) => {
    const data = event.nativeEvent.data;
    if (data === "ready") {
      setReady(true);
      onReady?.();
    } else if (data.startsWith("error")) {
      onError?.();
    }
  };

  return (
    <View pointerEvents="none" style={style}>
      <WebView
        androidLayerType="hardware"
        automaticallyAdjustContentInsets={false}
        bounces={false}
        containerStyle={{ backgroundColor: "transparent" }}
        javaScriptEnabled
        onError={() => onError?.()}
        onMessage={onMessage}
        originWhitelist={["*"]}
        overScrollMode="never"
        ref={ref}
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        source={{ html, baseUrl: "" }}
        // 加载完成前保持透明，避免安卓 WebView 首帧闪白
        style={{ flex: 1, backgroundColor: "transparent", opacity: ready ? 1 : 0 }}
      />
    </View>
  );
}
