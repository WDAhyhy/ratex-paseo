import type { PluginTheme } from "@getpaseo/plugin";
import { copyText } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { CODE_FONT_FAMILY } from "./code-font";

export function FormulaSource({ source, colors, displayMode, onClose }: {
  source: string;
  colors: PluginTheme["colors"];
  displayMode: boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  // RNW accepts userSelect on containers, though native ViewStyle omits it.
  const frameStyle = {
    backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1,
    borderRadius: 8, padding: 12, marginVertical: 4, gap: 10,
    minWidth: 0, maxWidth: "100%", width: displayMode ? "100%" : undefined,
    flexShrink: 1, userSelect: "text",
  } as const;
  const toolbarStyle = {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 4, userSelect: "none",
  } as const;
  const actionStyle = { minHeight: 44, minWidth: 44, paddingHorizontal: 12,
    justifyContent: "center", alignItems: "center" } as const;
  return (
    <View testID="formula-source" style={frameStyle}>
      <View style={toolbarStyle}>
        <Pressable style={actionStyle} accessibilityRole="button" accessibilityLabel="Show formula"
          onPress={(event) => { event.stopPropagation(); onClose(); }}>
          <Text selectable={false} style={{ color: colors.foregroundMuted, fontSize: 12, userSelect: "none" }}>Show formula</Text>
        </Pressable>
        <Pressable
          style={actionStyle}
          accessibilityRole="button"
          accessibilityLabel="Copy formula source"
          onPress={async (event) => {
            event.stopPropagation();
            try {
              await copyText(source);
              setStatus("copied");
            } catch {
              setStatus("failed");
            }
          }}
        >
          <Text selectable={false} style={{ color: colors.foreground, fontSize: 12, userSelect: "none" }}>{status === "copied" ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>
      <Text
        accessibilityLabel="TeX source"
        selectable
        style={{ color: colors.foreground, fontFamily: CODE_FONT_FAMILY, fontSize: 14,
          lineHeight: 21, userSelect: "text",
          ...(Platform.OS === "web" ? { overflowWrap: "anywhere" as const } : {}) }}
      >
        {source}
      </Text>
        {status === "failed" && (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>
            Copy failed. Select the source above and copy it manually.
          </Text>
        )}
    </View>
  );
}
