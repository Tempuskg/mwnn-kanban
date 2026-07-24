export type BoardPanelPlacement<TColumn> =
  | { readonly kind: 'create'; readonly column: TColumn }
  | { readonly kind: 'reveal' };

/**
 * Keep an existing board in its current editor group. Only choose a target
 * column when the singleton does not yet have a panel to reveal.
 */
export function resolveBoardPanelPlacement<TColumn>(
  hasCurrentPanel: boolean,
  activeGroupColumn: TColumn,
): BoardPanelPlacement<TColumn> {
  return hasCurrentPanel ? { kind: 'reveal' } : { kind: 'create', column: activeGroupColumn };
}
