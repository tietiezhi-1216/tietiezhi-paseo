import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Text, type StyleProp, type TextStyle } from "react-native";

/** Brightness moves through the glyphs themselves; no overlay or background paint. */
export function RunningSweep({ text, color, highlightColor, style }: {
  text: string; color: string; highlightColor: string; style?: StyleProp<TextStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  // Do not begin motion until the accessibility preference has been checked.
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => {
      changed = true;
      if (active) setReduceMotion(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active && !changed) setReduceMotion(value);
    }).catch(() => {});
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    progress.setValue(0);
    if (reduceMotion || !text) return;
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: 2500, easing: Easing.linear,
      useNativeDriver: Platform.OS !== "web", isInteraction: false,
    }));
    animation.start();
    return () => { animation.stop(); progress.stopAnimation(); };
  }, [progress, reduceMotion, text]);
  const glyphs = useMemo(() => {
    const segments = typeof Intl.Segmenter === "function"
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), part => part.segment)
      : Array.from(text);
    // Long tool arguments stay intact, but do not create unbounded animation nodes.
    const animated = segments.slice(0, 160);
    return { animated, remainder: segments.slice(160).join("") };
  }, [text]);
  const colors = useMemo(() => glyphs.animated.map((_, index) => {
    const start = 0.03 + index / Math.max(1, glyphs.animated.length - 1) * 0.55;
    return progress.interpolate({ inputRange: [0, start, start + 0.065, start + 0.13, 1],
      outputRange: [color, color, highlightColor, color, color] });
  }), [progress, glyphs, color, highlightColor]);
  return <Text testID="tietiezhi-running-sweep" numberOfLines={1} style={[style, { color }]}>
    {reduceMotion ? <Text testID="tietiezhi-running-static">{text}</Text> : <>
      {glyphs.animated.map((glyph, index) => <Animated.Text key={index} testID="tietiezhi-running-sweep-glyph" style={{ color: colors[index] }}>{glyph}</Animated.Text>)}
      {glyphs.remainder}
    </>}
  </Text>;
}
