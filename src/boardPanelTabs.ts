/** Tab inputs use a prefixed view type on current VS Code versions. */
export function isBoardWebviewTab(viewType: string, boardViewType: string): boolean {
  return viewType === boardViewType || viewType === `mainThreadWebview-${boardViewType}`;
}

/**
 * Snapshot unowned restored tabs before creating a new panel. Inactive session
 * tabs may not have reached the serializer yet, so the panel singleton alone
 * cannot see them. Never include tabs reported after creation in this cleanup.
 */
export function unownedBoardTabs<TTab>(
  hasLivePanel: boolean,
  tabs: readonly TTab[],
  viewType: (tab: TTab) => string | undefined,
  boardViewType: string,
): TTab[] {
  return hasLivePanel ? [] : tabs.filter((tab) => {
    const type = viewType(tab);
    return type !== undefined && isBoardWebviewTab(type, boardViewType);
  });
}
