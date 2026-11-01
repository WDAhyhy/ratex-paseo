import type { PluginTheme } from '@getpaseo/plugin';
import { useRpc } from '@getpaseo/plugin/client';
import { Modal } from '@getpaseo/plugin/client/ui';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { Image, PixelRatio, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type TextProps } from 'react-native';
import { renderNativeLatexRpc } from '../shared/ratex';
import { FormulaSource } from './formula-source';
import { CODE_FONT_FAMILY } from './code-font';

const FormulaWidth = createContext<number | undefined>(undefined);
/** Measure the actual paragraph/table-cell width, not just the phone's viewport. */
export function FormulaText(props: TextProps) {
  const [width, setWidth] = useState<number>();
  if (Platform.OS === 'web') return <Text {...props} />;
  return <FormulaWidth.Provider value={width}><Text {...props} onLayout={event => {
    const next = event.nativeEvent.layout.width;
    if (next > 0) setWidth(previous => previous !== undefined && Math.abs(previous - next) < 1 ? previous : next);
    props.onLayout?.(event);
  }} /></FormulaWidth.Provider>;
}

/** RN Image decodes PNG on Android/iOS; no DOM, webfonts or extra native module. */
export function NativeFormula({ latex, source, displayMode, colors, fontSize }: {
  latex: string; source: string; displayMode: boolean; colors: PluginTheme['colors']; fontSize: number;
}) {
  const render = useRpc(renderNativeLatexRpc);
  const paragraphWidth = useContext(FormulaWidth);
  const viewport = useWindowDimensions();
  const availableWidth = Math.max(1, paragraphWidth ?? viewport.width - 64);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const density = Math.min(4, Math.max(2, Math.ceil(PixelRatio.get())));
  const query = useQuery({
    queryKey: ['ratex.render-native', latex, displayMode, colors.foreground, fontSize, density],
    queryFn: () => render({ latex, displayMode, color: colors.foreground, fontSize, density }),
    staleTime: Infinity, gcTime: 5 * 60 * 1000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === latex && previousQuery.queryKey[2] === displayMode ? previous : undefined,
  });
  useEffect(() => { setSourceOpen(false); setImageFailed(false); }, [source]);
  const result = query.data;
  if (!result?.ok || imageFailed) return <Text selectable style={{ color: colors.foregroundMuted,
    fontFamily: CODE_FONT_FAMILY, fontSize }}>{source}</Text>;
  const imageProps = { resizeMode: 'contain' as const, onError: () => setImageFailed(true) };
  const image = result.tiles ? <View testID="native-formula-tiles" style={{ width: result.width, height: result.height }}>
    {result.tiles.map((tile, index) => <Image key={index} testID="native-formula-image" {...imageProps}
      source={{ uri: `data:image/png;base64,${tile.png}` }}
      style={{ position: 'absolute', left: tile.x, top: tile.y, width: tile.width, height: tile.height }} />)}
  </View> : <Image testID="native-formula-image" accessibilityLabel={source} {...imageProps}
    source={{ uri: `data:image/png;base64,${result.png}` }}
    style={{ width: result.width, height: result.height }} />;
  // The host sheet portals outside Text attachments, including formulas in table cells.
  const modal = sourceOpen && <Modal title="Formula source" open onOpenChange={setSourceOpen}>
    <Modal.Content>
      <FormulaSource source={source} colors={colors} displayMode onClose={() => setSourceOpen(false)} />
    </Modal.Content>
  </Modal>;
  if (!displayMode) {
    // Android Text attachments are atomic: oversized images cannot wrap or scroll by themselves.
    if (result.tiles || result.width > availableWidth) return <>{'\n'}
      <View style={{ width: Math.min(result.width, availableWidth), height: result.height }}>
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={{ flex: 1 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="View formula source"
            onPress={() => setSourceOpen(true)}>{image}</Pressable>
        </ScrollView>
      </View>{'\n'}{modal}
    </>;
    return <Text onPress={() => setSourceOpen(true)} accessibilityRole="button"
      accessibilityLabel="View formula source">{image}{modal}</Text>;
  }
  return <View style={{ minWidth: 0, maxWidth: '100%', width: '100%', paddingVertical: 8 }}>
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator
      style={{ height: result.height, flexGrow: 0 }}
      contentContainerStyle={{ alignItems: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="View formula source"
        onPress={() => setSourceOpen(true)}>{image}</Pressable>
    </ScrollView>
    {modal}
  </View>;
}
