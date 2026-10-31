import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useAgent, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Platform, Text, View } from "react-native";
import type { z } from "zod";
import { codeFileTarget, fileLinkTarget, type FileLocation } from "../shared/file-link";
import { messageTypography } from "../shared/layout";
import {
  type InlineNode,
  type MarkdownBlock,
  type TableAlign,
} from "../shared/markdown";
import type { ratexMessageSchema } from "../shared/ratex";
import { CODE_FONT_FAMILY } from "./code-font";
import { RatexFormula } from "./formula-view";
import { openWorkspaceFile } from "./open-file";
import { sourceMarkdown, type SourceDocument } from "../shared/source-markdown";
import { installMarkdownCopy } from "./selection";

/** Tied to the schema the renderer is registered with, so the two cannot drift. */
type RatexMessageData = z.infer<typeof ratexMessageSchema>;

type Layout = PluginTimelineItemProps["layout"];

type FileLinks = { cwd: string | null; open(location: FileLocation, node: unknown): void };

/** Cleared inside link text, so code within a link does not become a nested link. */
const FileLinkContext = createContext<FileLinks | null>(null);
const SourceContext = createContext<SourceDocument | null>(null);

function SourceLeaf({ node, children, block = false }: { node: object; children: ReactNode; block?: boolean }) {
  const doc = useContext(SourceContext);
  const props = { "data-ratex-source": doc?.ids.get(node) };
  if (Platform.OS !== "web") return <>{children}</>;
  return block ? <div {...props} style={{ minWidth: 0 }}>{children}</div> : <span {...props}>{children}</span>;
}

function messageStyles(theme: PluginTheme, compact: boolean, platform: Layout["platform"]) {
  const type = messageTypography(platform);
  const bodySize = type.fontSize;
  const body = {
    color: theme.colors.foreground,
    fontSize: bodySize,
    lineHeight: type.lineHeight,
    overflow: "visible" as const,
    userSelect: "text" as const,
  };
  return {
    column: {
      minWidth: 0,
      gap: compact ? 8 : 10,
      userSelect: "text" as const,
    },
    paragraph: body,
    bodySize,
    headingSize: (level: number) => type.heading(level).fontSize,
    heading: (level: number) => ({
      ...type.heading(level),
      color: level >= 6 ? theme.colors.foregroundMuted : theme.colors.foreground,
      fontWeight: "700" as const,
      marginTop: compact ? 6 : 8,
      userSelect: "text" as const,
    }),
    list: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: 8,
      userSelect: "text" as const,
    },
    marker: {
      color: theme.colors.foregroundMuted,
      fontSize: bodySize,
      lineHeight: type.lineHeight,
      userSelect: "text" as const,
    },
    quote: {
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.border,
      paddingLeft: 12,
      gap: compact ? 6 : 8,
    },
    table: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      overflow: "hidden" as const,
    },
    tableRow: {
      flexDirection: "row" as const,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    tableLastRow: {
      flexDirection: "row" as const,
    },
    tableCell: {
      flex: 1,
      paddingVertical: compact ? 6 : 8,
      paddingHorizontal: compact ? 8 : 10,
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
    },
    tableHeadRow: {
      backgroundColor: theme.colors.surface2,
    },
    tableHeadText: { ...body, fontWeight: "700" as const },
    code: {
      color: theme.colors.foreground,
      fontFamily: CODE_FONT_FAMILY,
      fontSize: type.codeSize(bodySize),
      lineHeight: type.lineHeight,
      backgroundColor: theme.colors.surface2,
      padding: 12,
      borderRadius: 8,
      userSelect: "text" as const,
    },
    // Matches Paseo's own code_inline span; native ignores padding and radius on nested text.
    inlineCode: (fontSize: number) => ({
      fontFamily: CODE_FONT_FAMILY,
      fontSize: type.codeSize(fontSize),
      backgroundColor: theme.colors.surface2,
      color: theme.colors.foreground,
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 6,
      userSelect: "text" as const,
    }),
    codeLink: { color: theme.colors.accent },
    strong: { fontWeight: "700" as const, userSelect: "text" as const },
    em: { fontStyle: "italic" as const, userSelect: "text" as const },
    strike: { textDecorationLine: "line-through" as const, userSelect: "text" as const },
    link: {
      color: theme.colors.accent,
      textDecorationLine: "underline" as const,
      userSelect: "text" as const,
    },
    imageLabel: { color: theme.colors.foregroundMuted, userSelect: "text" as const },
    hr: { height: 1, backgroundColor: theme.colors.border, marginVertical: 8 },
  };
}

type MessageStyles = ReturnType<typeof messageStyles>;

export function RatexMessage({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<RatexMessageData>) {
  const document = useMemo(() => sourceMarkdown(item.data.text), [item.data.text]);
  const blocks = document.blocks;
  const root = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || layout.platform !== "web") return;
    const node: unknown = root.current;
    if (node instanceof HTMLElement) return installMarkdownCopy(node, document);
  }, [document, layout.platform]);
  const { compact, platform } = layout;
  const styles = useMemo(
    () => messageStyles(theme, compact, platform),
    [compact, platform, theme],
  );
  // Paseo resolves an agent's relative file links against its cwd.
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const toast = useToast();
  const fileLinks = useMemo<FileLinks>(
    () => ({
      cwd,
      open(location, node) {
        if (!openWorkspaceFile(node, location)) {
          toast.error(`Couldn't open ${location.path} from this message.`);
        }
      },
    }),
    [cwd, toast],
  );

  return (
    <FileLinkContext.Provider value={fileLinks}>
      <SourceContext.Provider value={document}>
      <View ref={root} collapsable={false} style={styles.column}>
        {blocks.map((block, index) => (
          <MarkdownBlockView
            key={index}
            block={block}
            theme={theme}
            layout={layout}
            styles={styles}
          />
        ))}
      </View>
      </SourceContext.Provider>
    </FileLinkContext.Provider>
  );
}

function MarkdownBlockView({
  block,
  theme,
  layout,
  styles,
}: {
  block: MarkdownBlock;
  theme: PluginTheme;
  layout: Layout;
  styles: MessageStyles;
}) {
  switch (block.type) {
    case "heading":
      return (
        <Text selectable style={styles.heading(block.level)}>
          {renderInlines(block.inlines, theme, layout, styles, styles.headingSize(block.level))}
        </Text>
      );
    case "paragraph":
      return (
        <Text selectable style={styles.paragraph}>
          {renderInlines(block.inlines, theme, layout, styles)}
        </Text>
      );
    case "list-item":
      return (
        <View style={[styles.list, { marginLeft: block.indent * 16 }]}>
          <SourceLeaf node={block}><Text selectable style={styles.marker}>
            {block.marker}
          </Text></SourceLeaf>
          <Text selectable style={[styles.paragraph, { flex: 1 }]}>
            {renderInlines(block.inlines, theme, layout, styles)}
          </Text>
        </View>
      );
    case "quote":
      return (
        <View style={styles.quote}>
          {block.blocks.map((child, index) => (
            <MarkdownBlockView
              key={index}
              block={child}
              theme={theme}
              layout={layout}
              styles={styles}
            />
          ))}
        </View>
      );
    case "table":
      return <TableView block={block} theme={theme} layout={layout} styles={styles} />;
    case "code":
      return (
        <SourceLeaf node={block} block><Text selectable style={styles.code}>
          {block.text}
        </Text></SourceLeaf>
      );
    case "display-math":
      return (
        <SourceLeaf node={block} block><RatexFormula
          latex={block.latex}
          source={block.source}
          displayMode
          colors={theme.colors}
          platform={layout.platform}
          fontSize={styles.bodySize}
        /></SourceLeaf>
      );
    case "hr":
      return <View style={styles.hr} />;
  }
}

function TableView({
  block,
  theme,
  layout,
  styles,
}: {
  block: Extract<MarkdownBlock, { type: "table" }>;
  theme: PluginTheme;
  layout: Layout;
  styles: MessageStyles;
}) {
  const rows = [block.header, ...block.rows];
  return (
    <View style={styles.table}>
      {rows.map((cells, rowIndex) => (
        <View
          key={rowIndex}
          style={[
            rowIndex === rows.length - 1 ? styles.tableLastRow : styles.tableRow,
            rowIndex === 0 ? styles.tableHeadRow : null,
          ]}
        >
          {cells.map((cell, cellIndex) => (
            <View key={cellIndex} style={styles.tableCell}>
              <Text
                selectable
                style={[
                  rowIndex === 0 ? styles.tableHeadText : styles.paragraph,
                  { textAlign: cellAlign(block.align, cellIndex) },
                ]}
              >
                {renderInlines(cell, theme, layout, styles)}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function cellAlign(align: TableAlign[], index: number): TableAlign {
  return align[index] ?? "left";
}

function renderInlines(
  nodes: InlineNode[],
  theme: PluginTheme,
  layout: Layout,
  styles: MessageStyles,
  fontSize: number = styles.bodySize,
): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <SourceLeaf key={index} node={node}>{node.text}</SourceLeaf>;
      case "strong":
        return (
          <Text key={index} selectable style={styles.strong}>
            {renderInlines(node.children, theme, layout, styles, fontSize)}
          </Text>
        );
      case "em":
        return (
          <Text key={index} selectable style={styles.em}>
            {renderInlines(node.children, theme, layout, styles, fontSize)}
          </Text>
        );
      case "strike":
        return (
          <Text key={index} selectable style={styles.strike}>
            {renderInlines(node.children, theme, layout, styles, fontSize)}
          </Text>
        );
      case "link":
        // Images are not fetched: the label plus its target stays readable and copyable.
        if (node.image) {
          return (
            <SourceLeaf key={index} node={node}><Text selectable style={styles.imageLabel}>
              {renderInlines(node.children, theme, layout, styles, fontSize)}
              {` (${node.href})`}
            </Text></SourceLeaf>
          );
        }
        return (
          <LinkText key={index} href={node.href} style={styles.link}>
            {renderInlines(node.children, theme, layout, styles, fontSize)}
          </LinkText>
        );
      case "code":
        return (
          <SourceLeaf key={index} node={node}><InlineCode
            text={node.text}
            style={styles.inlineCode(fontSize)}
            linkStyle={styles.codeLink}
          /></SourceLeaf>
        );
      case "math":
        // No wrapping View: react-native-web renders one as an inline-flex box inside the
        // paragraph, and browsers put a line break at such a boundary when copying.
        return (
          <SourceLeaf key={index} node={node}><RatexFormula
            latex={node.latex}
            source={node.source}
            displayMode={false}
            colors={theme.colors}
            platform={layout.platform}
            fontSize={fontSize}
          /></SourceLeaf>
        );
    }
  });
}

function LinkText({
  href,
  style,
  children,
}: {
  href: string;
  style: MessageStyles["link"];
  children: ReactNode;
}) {
  const links = useContext(FileLinkContext);
  const target = links && fileLinkTarget(href, links.cwd);
  return (
    <Text
      selectable
      style={style}
      accessibilityRole="link"
      onPress={(event) => {
        if (links && target) links.open(target, event.currentTarget);
        else void openExternalUrl(href).catch(() => {});
      }}
    >
      <FileLinkContext.Provider value={null}>{children}</FileLinkContext.Provider>
    </Text>
  );
}

/** Code naming a workspace file opens it, like Paseo's own inline code paths. */
function InlineCode({
  text,
  style,
  linkStyle,
}: {
  text: string;
  style: ReturnType<MessageStyles["inlineCode"]>;
  linkStyle: MessageStyles["codeLink"];
}) {
  const links = useContext(FileLinkContext);
  const target = links && codeFileTarget(text, links.cwd);
  if (!links || !target) {
    return (
      <Text selectable style={style}>
        {text}
      </Text>
    );
  }
  return (
    <Text
      selectable
      style={[style, linkStyle]}
      accessibilityRole="link"
      onPress={(event) => links.open(target, event.currentTarget)}
    >
      {text}
    </Text>
  );
}
