/**
 * Shared classes for the floating map toolbar and the instruction strip under a map
 * (Figma: .map-drawing-toolbar, .map-instruction). Used by the land map and the add-land map.
 */
export const MAP_TOOLBAR_CLASS =
  'absolute top-3 right-3 z-1000 flex flex-col gap-0.5 rounded-sm border bg-card/96 p-1 shadow-lift';

export const MAP_TOOL_CLASS =
  'flex min-h-10 cursor-pointer items-center gap-2 rounded-[6px] border border-transparent px-3 py-2 text-left text-[11px] font-bold text-foreground ' +
  'transition-colors hover:bg-background aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-sage-text ' +
  'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55';

export const MAP_HINT_CLASS =
  'flex min-h-9 items-center gap-2 border-t bg-background px-3 py-2 text-[11px] text-muted-foreground';
