import { BOARD_STATE_VERSION, type Assignee, type Card, type Column, type ColumnRole, isAssignee } from './types';

export const BOARD_FILE_VERSION = BOARD_STATE_VERSION;

export type ColumnConfig = Pick<Column, 'id' | 'title' | 'role' | 'wipLimit' | 'reverseWip'>;

export interface ColumnsDocument {
  readonly version: typeof BOARD_FILE_VERSION;
  readonly columns: ColumnConfig[];
}

export interface CardDocument {
  readonly columnId: string;
  readonly position: number;
  readonly card: Card;
}

export function serializeCard(document: CardDocument): string {
  const lines = [
    '---',
    `id: ${serializeScalar(document.card.id)}`,
    `title: ${serializeScalar(document.card.title)}`,
    `column: ${serializeScalar(document.columnId)}`,
    `position: ${document.position}`,
    ...(document.card.assignee ? [`assignee: ${serializeAssignee(document.card.assignee)}`] : []),
    `createdAt: ${document.card.createdAt}`,
    ...(document.card.updatedAt !== undefined ? [`updatedAt: ${document.card.updatedAt}`] : []),
    ...(document.card.dependsOn && document.card.dependsOn.length > 0
      ? [`dependsOn: ${serializeStringArray(document.card.dependsOn)}`]
      : []),
    '---',
    '',
    '## Description',
    ...serializeSection(document.card.description),
    '',
    '## Acceptance criteria',
    ...serializeSection(document.card.acceptanceCriteria),
    '',
    '## Activity',
    ...serializeSection(document.card.activity),
    '',
  ];

  return lines.join('\n');
}

export function parseCard(text: string): CardDocument {
  const normalized = normalizeNewlines(text);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Card markdown is missing frontmatter.');
  }

  const frontmatterText = match[1] ?? '';
  const bodyText = match[2] ?? '';
  const frontmatter = parseFrontmatter(frontmatterText);
  const body = parseBodySections(bodyText);

  const id = requireString(frontmatter, 'id');
  const title = requireString(frontmatter, 'title');
  const columnId = requireString(frontmatter, 'column');
  const position = requireNumber(frontmatter, 'position');
  const createdAt = requireNumber(frontmatter, 'createdAt');
  const updatedAt = optionalNumber(frontmatter, 'updatedAt');
  const assignee = optionalAssignee(frontmatter, 'assignee');
  const dependsOn = optionalStringArray(frontmatter, 'dependsOn');

  const card: Card = { id, title, createdAt };
  if (updatedAt !== undefined) {
    card.updatedAt = updatedAt;
  }
  if (body.description !== undefined) {
    card.description = body.description;
  }
  if (body.acceptanceCriteria !== undefined) {
    card.acceptanceCriteria = body.acceptanceCriteria;
  }
  if (body.activity !== undefined) {
    card.activity = body.activity;
  }
  if (assignee !== undefined) {
    card.assignee = assignee;
  }
  if (dependsOn !== undefined) {
    card.dependsOn = dependsOn;
  }

  return { columnId, position, card };
}

export function serializeColumns(document: ColumnsDocument): string {
  return `${JSON.stringify(
    {
      version: document.version,
      columns: document.columns.map((column) => serializeColumnConfig(column)),
    },
    null,
    2,
  )}\n`;
}

export function parseColumns(text: string): ColumnsDocument {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || parsed['version'] !== BOARD_FILE_VERSION || !Array.isArray(parsed['columns'])) {
    throw new Error('Invalid columns document.');
  }

  const columns = parsed['columns'].map(parseColumnConfig);
  return {
    version: BOARD_FILE_VERSION,
    columns,
  };
}

function parseFrontmatter(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const rawLine of normalizeNewlines(text).split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }
  return entries;
}

function parseBodySections(body: string): {
  readonly description?: string;
  readonly acceptanceCriteria?: string;
  readonly activity?: string;
} {
  const sections = splitSections(body);
  const parsedSections: {
    description?: string;
    acceptanceCriteria?: string;
    activity?: string;
  } = {};

  const description = normalizeSection(sections['Description']);
  if (description !== undefined) {
    parsedSections.description = description;
  }

  const acceptanceCriteria = normalizeSection(sections['Acceptance criteria']);
  if (acceptanceCriteria !== undefined) {
    parsedSections.acceptanceCriteria = acceptanceCriteria;
  }

  const activity = normalizeSection(sections['Activity']);
  if (activity !== undefined) {
    parsedSections.activity = activity;
  }

  return parsedSections;
}

function splitSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = normalizeNewlines(body).split('\n');
  let currentHeading: string | undefined;
  let currentLines: string[] = [];

  const flush = (): void => {
    if (currentHeading !== undefined) {
      sections[currentHeading] = currentLines.join('\n');
    }
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1];
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return sections;
}

function serializeSection(content: string | undefined): string[] {
  return normalizeSection(content)?.split('\n') ?? [];
}

function normalizeSection(content: string | undefined): string | undefined {
  if (content === undefined) {
    return undefined;
  }

  const trimmed = normalizeNewlines(content).replace(/^\s*\n+|\n+\s*$/g, '').trimEnd();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireString(frontmatter: Record<string, string>, key: string): string {
  const value = frontmatter[key];
  if (value === undefined) {
    throw new Error(`Missing required frontmatter key: ${key}`);
  }

  return parseScalar(value);
}

function requireNumber(frontmatter: Record<string, string>, key: string): number {
  const value = frontmatter[key];
  if (value === undefined) {
    throw new Error(`Missing required frontmatter key: ${key}`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric frontmatter value for ${key}.`);
  }
  return parsed;
}

function optionalNumber(frontmatter: Record<string, string>, key: string): number | undefined {
  const value = frontmatter[key];
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric frontmatter value for ${key}.`);
  }
  return parsed;
}

function optionalAssignee(frontmatter: Record<string, string>, key: string): Assignee | undefined {
  const value = frontmatter[key];
  if (value === undefined) {
    return undefined;
  }

  const match = value.match(/^\{\s*kind:\s*([^,}]+)(?:,\s*name:\s*(.+))?\s*\}$/);
  if (!match) {
    throw new Error('Invalid assignee frontmatter.');
  }

  const rawKind = match[1];
  if (rawKind === undefined) {
    throw new Error('Invalid assignee kind.');
  }

  const kind = parseScalar(rawKind);
  const name = match[2] ? parseScalar(match[2]) : undefined;
  const assignee = name ? { kind, name } : { kind };
  if (!isAssignee(assignee)) {
    throw new Error('Invalid assignee value.');
  }
  return assignee;
}

function optionalStringArray(frontmatter: Record<string, string>, key: string): string[] | undefined {
  const value = frontmatter[key];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new Error(`Invalid array frontmatter for ${key}.`);
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return undefined;
  }

  return inner.split(',').map((part) => parseScalar(part));
}

function serializeStringArray(values: readonly string[]): string {
  return `[${values.map((value) => serializeInlineScalar(value)).join(', ')}]`;
}

function serializeAssignee(assignee: Assignee): string {
  return assignee.name
    ? `{ kind: ${serializeInlineScalar(assignee.kind)}, name: ${serializeInlineScalar(assignee.name)} }`
    : `{ kind: ${serializeInlineScalar(assignee.kind)} }`;
}

function serializeColumnConfig(column: ColumnConfig): ColumnConfig {
  const serialized: ColumnConfig = { id: column.id, title: column.title };
  if (column.role !== undefined) {
    serialized.role = column.role;
  }
  if (column.wipLimit !== undefined) {
    serialized.wipLimit = column.wipLimit;
  }
  if (column.reverseWip !== undefined) {
    serialized.reverseWip = column.reverseWip;
  }
  return serialized;
}

function parseColumnConfig(value: unknown): ColumnConfig {
  if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['title'] !== 'string') {
    throw new Error('Invalid column entry.');
  }

  const column: ColumnConfig = {
    id: value['id'],
    title: value['title'],
  };

  if (value['role'] !== undefined) {
    if (!isColumnRole(value['role'])) {
      throw new Error('Invalid column role.');
    }
    column.role = value['role'];
  }
  if (value['wipLimit'] !== undefined) {
    if (!isLimit(value['wipLimit'])) {
      throw new Error('Invalid WIP limit.');
    }
    column.wipLimit = value['wipLimit'];
  }
  if (value['reverseWip'] !== undefined) {
    if (!isLimit(value['reverseWip'])) {
      throw new Error('Invalid reverse WIP limit.');
    }
    column.reverseWip = value['reverseWip'];
  }

  return column;
}

function serializeScalar(value: string): string {
  return needsQuotes(value) ? JSON.stringify(value) : value;
}

function serializeInlineScalar(value: string): string {
  return needsQuotes(value) ? JSON.stringify(value) : value;
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed) as string;
  }
  return trimmed;
}

function needsQuotes(value: string): boolean {
  return value.length === 0 || /[:{}[\]",#]|^\s|\s$/.test(value);
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function isColumnRole(value: unknown): value is ColumnRole {
  return (
    value === 'backlog' ||
    value === 'ready' ||
    value === 'in-progress' ||
    value === 'done' ||
    value === 'custom'
  );
}

function isLimit(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
