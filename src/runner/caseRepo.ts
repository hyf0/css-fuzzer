import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  parserNames,
  type CssSyntax,
  type ParserAdapter,
  type ParserName,
  type ParserStatus,
  type ParseResult,
} from "../core/types.js";
import {
  classifyFinding,
  findingFingerprint,
  preservesFindingIdentity,
  runDifferentialCase,
} from "./differential.js";
import { collectCssFiles, replayCssFiles, type ReplayRow } from "./replay.js";
import { minimizeText } from "./shrink.js";

export const casePriorities = ["High Priority", "Medium Priority", "Low Priority"] as const;

export type CasePriority = (typeof casePriorities)[number];

const casePriorityPathPrefixes = {
  "High Priority": "cases/high/",
  "Medium Priority": "cases/medium/",
  "Low Priority": "cases/low/",
} as const satisfies Record<CasePriority, string>;

export interface CaseRepoVerificationOptions {
  readonly dir: string;
  readonly readme: string;
  readonly syntax: CssSyntax;
  readonly timeoutMs: number;
  readonly adapters: readonly ParserAdapter[];
  readonly checkMinimized?: boolean;
  readonly minimizeAttempts?: number;
  readonly byteMinimize?: boolean;
}

export interface CaseCoverageDiff {
  readonly missingFromReadme: readonly string[];
  readonly missingOnDisk: readonly string[];
}

export interface CaseNoteCoverageDiff {
  readonly missingCaseNotes: readonly string[];
  readonly orphanCaseNotes: readonly string[];
}

export interface UninterestingCase {
  readonly file: string;
  readonly reason: string;
  readonly fingerprint: string;
  readonly results: readonly ParseResult[];
}

export interface ReadmeParserExpectation {
  readonly status: ParserStatus;
  readonly messageSnippet?: string;
}

export interface ReadmeCaseExpectation {
  readonly file: string;
  readonly parsers: ReadonlyMap<ParserName, ReadmeParserExpectation>;
}

export interface SidecarCaseExpectation {
  readonly file: string;
  readonly noteFile: string;
  readonly parsers: ReadonlyMap<ParserName, ReadmeParserExpectation>;
}

export interface ReadmeCasePriority {
  readonly file: string;
  readonly priority?: CasePriority;
}

export interface ReadmePriorityPathMismatch {
  readonly file: string;
  readonly priority: CasePriority;
  readonly expectedPrefix: string;
}

export interface ReadmeMatrixMismatch {
  readonly file: string;
  readonly parser: ParserName;
  readonly expected: string;
  readonly actual: string;
}

export interface SidecarMatrixMismatch {
  readonly file: string;
  readonly noteFile: string;
  readonly parser: ParserName;
  readonly expected: string;
  readonly actual: string;
}

export interface ReadmeMissingParserExpectation {
  readonly file: string;
  readonly parser: ParserName;
}

export interface SidecarMissingParserExpectation {
  readonly file: string;
  readonly noteFile: string;
  readonly parser: ParserName;
}

export interface ReadmeMissingParserMessage {
  readonly file: string;
  readonly parser: ParserName;
  readonly status: ParserStatus;
}

export interface SidecarMissingParserMessage {
  readonly file: string;
  readonly noteFile: string;
  readonly parser: ParserName;
  readonly status: ParserStatus;
}

export interface ReadmeCaseId {
  readonly id: string;
  readonly file: string;
}

export interface ReadmeDuplicateCaseId {
  readonly id: string;
  readonly files: readonly string[];
}

export interface ReadmeCaseIdPathMismatch {
  readonly id: string;
  readonly file: string;
  readonly expectedBasenamePrefix: string;
  readonly actualBasename: string;
}

export interface SidecarSourceMismatch {
  readonly file: string;
  readonly noteFile: string;
  readonly reason: string;
}

export interface SidecarHeadingMismatch {
  readonly noteFile: string;
  readonly missingHeadings: readonly string[];
}

export interface SidecarContextMismatch {
  readonly noteFile: string;
  readonly reason: string;
}

export interface SidecarTitleIdMismatch {
  readonly file: string;
  readonly noteFile: string;
  readonly expectedId?: string;
  readonly actualId?: string;
  readonly reason: string;
}

export interface ReducibleCase {
  readonly file: string;
  readonly originalBytes: number;
  readonly reducedBytes: number;
  readonly attempts: number;
  readonly reducedSource: string;
}

export interface CaseRepoVerificationResult extends CaseCoverageDiff {
  readonly caseFiles: readonly string[];
  readonly caseNoteFiles: readonly string[];
  readonly readmeLinks: readonly string[];
  readonly readmeDuplicateLinks: readonly string[];
  readonly readmeDuplicateCaseIds: readonly ReadmeDuplicateCaseId[];
  readonly readmeCaseIdPathMismatches: readonly ReadmeCaseIdPathMismatch[];
  readonly missingCaseNotes: readonly string[];
  readonly orphanCaseNotes: readonly string[];
  readonly sidecarSourceMismatches: readonly SidecarSourceMismatch[];
  readonly sidecarHeadingMismatches: readonly SidecarHeadingMismatch[];
  readonly sidecarContextMismatches: readonly SidecarContextMismatch[];
  readonly sidecarTitleIdMismatches: readonly SidecarTitleIdMismatch[];
  readonly sidecarRowsMissingParserExpectations: readonly SidecarMissingParserExpectation[];
  readonly sidecarRowsMissingParserMessages: readonly SidecarMissingParserMessage[];
  readonly sidecarMatrixMismatches: readonly SidecarMatrixMismatch[];
  readonly uninterestingCases: readonly UninterestingCase[];
  readonly readmeLinksWithoutPriority: readonly string[];
  readonly readmePriorityPathMismatches: readonly ReadmePriorityPathMismatch[];
  readonly readmeLinksWithoutMatrix: readonly string[];
  readonly readmeRowsMissingParserExpectations: readonly ReadmeMissingParserExpectation[];
  readonly readmeRowsMissingParserMessages: readonly ReadmeMissingParserMessage[];
  readonly matrixMismatches: readonly ReadmeMatrixMismatch[];
  readonly minimizationChecked: boolean;
  readonly reducibleCases: readonly ReducibleCase[];
}

export async function verifyCaseRepo(
  options: CaseRepoVerificationOptions,
): Promise<CaseRepoVerificationResult> {
  const readmeRoot = path.dirname(options.readme);
  const [readme, absoluteCaseFiles, absoluteCaseNoteFiles] = await Promise.all([
    readFile(options.readme, "utf8"),
    collectCssFiles(options.dir),
    collectCaseNoteFiles(options.dir),
  ]);
  const caseFiles = absoluteCaseFiles.map((file) => toPosixPath(path.relative(readmeRoot, file)));
  const caseNoteFiles = absoluteCaseNoteFiles.map((file) =>
    toPosixPath(path.relative(readmeRoot, file)),
  );
  const readmeLinks = extractReadmeCaseLinks(readme);
  const readmeDuplicateLinks = findDuplicateReadmeCaseLinks(readme);
  const readmeCaseIds = extractReadmeCaseIds(readme);
  const readmeDuplicateCaseIds = findDuplicateReadmeCaseIds(readme);
  const readmeCasePriorities = extractReadmeCasePriorities(readme);
  const readmeExpectations = extractReadmeCaseExpectations(readme);
  const coverage = diffCaseCoverage(caseFiles, readmeLinks);
  const noteCoverage = diffCaseNoteCoverage(caseFiles, caseNoteFiles);
  const absoluteCaseNoteSet = new Set(absoluteCaseNoteFiles);
  const sidecarSourceMismatches = await findSidecarSourceMismatches(
    absoluteCaseFiles.filter((file) => absoluteCaseNoteSet.has(caseNotePathForCaseFile(file))),
    readmeRoot,
  );
  const sidecarHeadingMismatches = await findSidecarHeadingMismatches(
    absoluteCaseNoteFiles,
    readmeRoot,
  );
  const sidecarContextMismatches = await findSidecarContextMismatches(
    absoluteCaseNoteFiles,
    readmeRoot,
  );
  const sidecarTitleIdMismatches = await findSidecarTitleIdMismatches(
    absoluteCaseNoteFiles,
    readmeRoot,
    readmeCaseIds,
  );
  const sidecarExpectations = await extractSidecarCaseExpectations(
    absoluteCaseNoteFiles,
    readmeRoot,
  );
  const rows = await replayCssFiles(absoluteCaseFiles, options.adapters, {
    syntax: options.syntax,
    timeoutMs: options.timeoutMs,
  });
  const relativeRows = rows.map((row) => ({
    ...row,
    file: toPosixPath(path.relative(readmeRoot, row.file)),
  }));
  const reducibleCases =
    options.checkMinimized === true
      ? await findReducibleReplayRows(relativeRows, {
          adapters: options.adapters,
          syntax: options.syntax,
          timeoutMs: options.timeoutMs,
          maxAttempts: options.minimizeAttempts ?? 80,
          allowByteLevel: options.byteMinimize === true,
        })
      : [];
  return {
    caseFiles,
    caseNoteFiles,
    readmeLinks,
    readmeDuplicateLinks,
    readmeDuplicateCaseIds,
    readmeCaseIdPathMismatches: findReadmeCaseIdPathMismatches(readmeCaseIds),
    ...coverage,
    ...noteCoverage,
    sidecarSourceMismatches,
    sidecarHeadingMismatches,
    sidecarContextMismatches,
    sidecarTitleIdMismatches,
    sidecarRowsMissingParserExpectations:
      findSidecarRowsMissingParserExpectations(sidecarExpectations),
    sidecarRowsMissingParserMessages: findSidecarRowsMissingParserMessages(sidecarExpectations),
    sidecarMatrixMismatches: findSidecarMatrixMismatches(sidecarExpectations, relativeRows),
    uninterestingCases: findUninterestingReplayRows(relativeRows, options.syntax),
    readmeLinksWithoutPriority: findReadmeLinksWithoutPriority(readmeCasePriorities),
    readmePriorityPathMismatches: findReadmePriorityPathMismatches(readmeCasePriorities),
    readmeLinksWithoutMatrix: findReadmeLinksWithoutMatrix(readmeLinks, readmeExpectations),
    readmeRowsMissingParserExpectations:
      findReadmeRowsMissingParserExpectations(readmeExpectations),
    readmeRowsMissingParserMessages: findReadmeRowsMissingParserMessages(readmeExpectations),
    matrixMismatches: findReadmeMatrixMismatches(readmeExpectations, relativeRows),
    minimizationChecked: options.checkMinimized === true,
    reducibleCases,
  };
}

export function extractReadmeCaseLinks(readme: string): readonly string[] {
  const links = new Set<string>();
  const pattern = /\]\(([^)\s]+\.css(?:#[^)\s]+)?)\)/g;
  for (const match of readme.matchAll(pattern)) {
    const target = match[1];
    if (target === undefined) {
      continue;
    }
    const normalized = normalizeReadmeCaseTarget(target);
    if (normalized !== undefined) {
      links.add(normalized);
    }
  }
  return [...links].sort((a, b) => a.localeCompare(b));
}

export function findDuplicateReadmeCaseLinks(readme: string): readonly string[] {
  const counts = new Map<string, number>();
  for (const rawLine of readme.split(/\r?\n/)) {
    for (const file of extractCaseLinksFromLine(rawLine.trim())) {
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([file]) => file)
    .sort((left, right) => left.localeCompare(right));
}

export function extractReadmeCaseIds(readme: string): readonly ReadmeCaseId[] {
  const ids: ReadmeCaseId[] = [];
  let idColumn: number | undefined;

  for (const rawLine of readme.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) {
      idColumn = undefined;
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    if (isSeparatorRow(cells)) {
      continue;
    }

    const headerIdColumn = cells.findIndex((cell) => stripMarkdown(cell).trim() === "ID");
    if (headerIdColumn !== -1) {
      idColumn = headerIdColumn;
      continue;
    }

    if (idColumn === undefined) {
      continue;
    }
    const file = extractCaseLinkFromCells(cells);
    const rawId = cells[idColumn];
    const id = rawId === undefined ? "" : stripMarkdown(rawId).trim();
    if (file !== undefined && id !== "") {
      ids.push({ id, file });
    }
  }

  return ids.sort(
    (left, right) => left.id.localeCompare(right.id) || left.file.localeCompare(right.file),
  );
}

export function findDuplicateReadmeCaseIds(readme: string): readonly ReadmeDuplicateCaseId[] {
  const filesById = new Map<string, string[]>();
  for (const item of extractReadmeCaseIds(readme)) {
    const files = filesById.get(item.id) ?? [];
    files.push(item.file);
    filesById.set(item.id, files);
  }
  return [...filesById]
    .filter(([, files]) => files.length > 1)
    .map(([id, files]) => ({
      id,
      files: files.sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function findReadmeCaseIdPathMismatches(
  ids: readonly ReadmeCaseId[],
): readonly ReadmeCaseIdPathMismatch[] {
  return ids
    .flatMap((item): readonly ReadmeCaseIdPathMismatch[] => {
      const expectedBasenamePrefix = normalizeCaseIdForPath(item.id);
      const actualBasename = path.basename(item.file, ".css");
      if (
        actualBasename === expectedBasenamePrefix ||
        actualBasename.startsWith(`${expectedBasenamePrefix}-`)
      ) {
        return [];
      }
      return [
        {
          id: item.id,
          file: item.file,
          expectedBasenamePrefix,
          actualBasename,
        },
      ];
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function extractReadmeCasePriorities(readme: string): readonly ReadmeCasePriority[] {
  const priorities = new Map<string, CasePriority | undefined>();
  let currentPriority: CasePriority | undefined;

  for (const rawLine of readme.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading !== undefined) {
      currentPriority = parseCasePriority(heading);
    }

    for (const file of extractCaseLinksFromLine(line)) {
      if (!priorities.has(file) || priorities.get(file) === undefined) {
        priorities.set(file, currentPriority);
      }
    }
  }

  return [...priorities]
    .map(([file, priority]) => ({
      file,
      ...(priority === undefined ? {} : { priority }),
    }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function diffCaseCoverage(
  caseFiles: readonly string[],
  readmeLinks: readonly string[],
): CaseCoverageDiff {
  const fileSet = new Set(caseFiles);
  const linkSet = new Set(readmeLinks);
  return {
    missingFromReadme: caseFiles
      .filter((file) => !linkSet.has(file))
      .sort((a, b) => a.localeCompare(b)),
    missingOnDisk: readmeLinks
      .filter((link) => !fileSet.has(link))
      .sort((a, b) => a.localeCompare(b)),
  };
}

export function diffCaseNoteCoverage(
  caseFiles: readonly string[],
  noteFiles: readonly string[],
): CaseNoteCoverageDiff {
  const noteSet = new Set(noteFiles);
  const expectedNoteSet = new Set(caseFiles.map(caseNotePathForCaseFile));
  return {
    missingCaseNotes: caseFiles
      .map(caseNotePathForCaseFile)
      .filter((note) => !noteSet.has(note))
      .sort((left, right) => left.localeCompare(right)),
    orphanCaseNotes: noteFiles
      .filter((note) => !expectedNoteSet.has(note))
      .sort((left, right) => left.localeCompare(right)),
  };
}

export function findReadmeLinksWithoutPriority(
  priorities: readonly ReadmeCasePriority[],
): readonly string[] {
  return priorities
    .filter((item) => item.priority === undefined)
    .map((item) => item.file)
    .sort((left, right) => left.localeCompare(right));
}

export function findReadmePriorityPathMismatches(
  priorities: readonly ReadmeCasePriority[],
): readonly ReadmePriorityPathMismatch[] {
  return priorities
    .flatMap((item): readonly ReadmePriorityPathMismatch[] => {
      if (item.priority === undefined) {
        return [];
      }
      const expectedPrefix = casePriorityPathPrefixes[item.priority];
      if (item.file.startsWith(expectedPrefix)) {
        return [];
      }
      return [{ file: item.file, priority: item.priority, expectedPrefix }];
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function extractReadmeCaseExpectations(readme: string): readonly ReadmeCaseExpectation[] {
  let parserColumns: ReadonlyMap<ParserName, number> | undefined;
  const expectations: ReadmeCaseExpectation[] = [];

  for (const rawLine of readme.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) {
      parserColumns = undefined;
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    if (isSeparatorRow(cells)) {
      continue;
    }

    const headerColumns = parserColumnsFromHeader(cells);
    if (headerColumns !== undefined) {
      parserColumns = headerColumns;
      continue;
    }

    if (parserColumns === undefined) {
      continue;
    }

    const file = extractCaseLinkFromCells(cells);
    if (file === undefined) {
      continue;
    }

    const parsers = new Map<ParserName, ReadmeParserExpectation>();
    for (const parser of parserNames) {
      const column = parserColumns.get(parser);
      const cell = column === undefined ? undefined : cells[column];
      if (cell !== undefined) {
        parsers.set(parser, parseReadmeParserExpectation(cell));
      }
    }
    expectations.push({ file, parsers });
  }

  return expectations.sort((a, b) => a.file.localeCompare(b.file));
}

export function findReadmeLinksWithoutMatrix(
  readmeLinks: readonly string[],
  expectations: readonly ReadmeCaseExpectation[],
): readonly string[] {
  const expectationFiles = new Set(expectations.map((item) => item.file));
  return readmeLinks
    .filter((file) => !expectationFiles.has(file))
    .sort((left, right) => left.localeCompare(right));
}

export function findReadmeRowsMissingParserExpectations(
  expectations: readonly ReadmeCaseExpectation[],
): readonly ReadmeMissingParserExpectation[] {
  return expectations
    .flatMap((expectation): readonly ReadmeMissingParserExpectation[] =>
      parserNames
        .filter((parser) => !expectation.parsers.has(parser))
        .map((parser) => ({ file: expectation.file, parser })),
    )
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        parserNames.indexOf(left.parser) - parserNames.indexOf(right.parser),
    );
}

export function findReadmeRowsMissingParserMessages(
  expectations: readonly ReadmeCaseExpectation[],
): readonly ReadmeMissingParserMessage[] {
  return expectations
    .flatMap((expectation): readonly ReadmeMissingParserMessage[] =>
      parserNames.flatMap((parser): readonly ReadmeMissingParserMessage[] => {
        const expected = expectation.parsers.get(parser);
        if (expected === undefined || !parserStatusRequiresMessage(expected)) {
          return [];
        }
        return [{ file: expectation.file, parser, status: expected.status }];
      }),
    )
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        parserNames.indexOf(left.parser) - parserNames.indexOf(right.parser),
    );
}

export function findReadmeMatrixMismatches(
  expectations: readonly ReadmeCaseExpectation[],
  rows: readonly ReplayRow[],
): readonly ReadmeMatrixMismatch[] {
  const rowsByFile = new Map(rows.map((row) => [row.file, row]));
  const mismatches: ReadmeMatrixMismatch[] = [];
  for (const expectation of expectations) {
    const row = rowsByFile.get(expectation.file);
    if (row === undefined) {
      continue;
    }
    const resultsByParser = new Map(row.results.map((result) => [result.parser, result]));
    for (const [parser, expected] of expectation.parsers) {
      const actual = resultsByParser.get(parser);
      if (actual === undefined) {
        mismatches.push({
          file: expectation.file,
          parser,
          expected: formatExpectedParserExpectation(expected),
          actual: "missing",
        });
        continue;
      }
      if (!parserExpectationMatches(expected, actual)) {
        mismatches.push({
          file: expectation.file,
          parser,
          expected: formatExpectedParserExpectation(expected),
          actual: formatActualParserResult(actual),
        });
      }
    }
  }
  return mismatches;
}

export async function extractSidecarCaseExpectations(
  absoluteCaseNoteFiles: readonly string[],
  readmeRoot: string,
): Promise<readonly SidecarCaseExpectation[]> {
  const expectations: SidecarCaseExpectation[] = [];
  for (const noteFile of absoluteCaseNoteFiles) {
    const noteSource = await readFile(noteFile, "utf8");
    expectations.push({
      file: toPosixPath(path.relative(readmeRoot, caseFilePathForCaseNoteFile(noteFile))),
      noteFile: toPosixPath(path.relative(readmeRoot, noteFile)),
      parsers: extractSidecarParserExpectationMap(noteSource),
    });
  }
  return expectations.sort((left, right) => left.file.localeCompare(right.file));
}

export function findSidecarRowsMissingParserExpectations(
  expectations: readonly SidecarCaseExpectation[],
): readonly SidecarMissingParserExpectation[] {
  return expectations
    .flatMap((expectation): readonly SidecarMissingParserExpectation[] =>
      parserNames
        .filter((parser) => !expectation.parsers.has(parser))
        .map((parser) => ({
          file: expectation.file,
          noteFile: expectation.noteFile,
          parser,
        })),
    )
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        parserNames.indexOf(left.parser) - parserNames.indexOf(right.parser),
    );
}

export function findSidecarRowsMissingParserMessages(
  expectations: readonly SidecarCaseExpectation[],
): readonly SidecarMissingParserMessage[] {
  return expectations
    .flatMap((expectation): readonly SidecarMissingParserMessage[] =>
      parserNames.flatMap((parser): readonly SidecarMissingParserMessage[] => {
        const expected = expectation.parsers.get(parser);
        if (expected === undefined || !parserStatusRequiresMessage(expected)) {
          return [];
        }
        return [
          {
            file: expectation.file,
            noteFile: expectation.noteFile,
            parser,
            status: expected.status,
          },
        ];
      }),
    )
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        parserNames.indexOf(left.parser) - parserNames.indexOf(right.parser),
    );
}

export function findSidecarMatrixMismatches(
  expectations: readonly SidecarCaseExpectation[],
  rows: readonly ReplayRow[],
): readonly SidecarMatrixMismatch[] {
  const rowsByFile = new Map(rows.map((row) => [row.file, row]));
  const mismatches: SidecarMatrixMismatch[] = [];
  for (const expectation of expectations) {
    const row = rowsByFile.get(expectation.file);
    if (row === undefined) {
      continue;
    }
    const resultsByParser = new Map(row.results.map((result) => [result.parser, result]));
    for (const [parser, expected] of expectation.parsers) {
      const actual = resultsByParser.get(parser);
      if (actual === undefined) {
        mismatches.push({
          file: expectation.file,
          noteFile: expectation.noteFile,
          parser,
          expected: formatExpectedParserExpectation(expected),
          actual: "missing",
        });
        continue;
      }
      if (!parserExpectationMatches(expected, actual)) {
        mismatches.push({
          file: expectation.file,
          noteFile: expectation.noteFile,
          parser,
          expected: formatExpectedParserExpectation(expected),
          actual: formatActualParserResult(actual),
        });
      }
    }
  }
  return mismatches;
}

export async function findSidecarSourceMismatches(
  absoluteCaseFiles: readonly string[],
  readmeRoot: string,
): Promise<readonly SidecarSourceMismatch[]> {
  const mismatches: SidecarSourceMismatch[] = [];
  for (const file of absoluteCaseFiles) {
    const noteFile = caseNotePathForCaseFile(file);
    const [caseSource, noteSource] = await Promise.all([
      readFile(file, "utf8"),
      readFile(noteFile, "utf8"),
    ]);
    const fencedSource = extractFirstCssFence(noteSource);
    const relativeFile = toPosixPath(path.relative(readmeRoot, file));
    const relativeNoteFile = toPosixPath(path.relative(readmeRoot, noteFile));
    if (fencedSource === undefined) {
      mismatches.push({
        file: relativeFile,
        noteFile: relativeNoteFile,
        reason: "missing css fenced block",
      });
      continue;
    }
    if (normalizeCaseSource(fencedSource) !== normalizeCaseSource(caseSource)) {
      mismatches.push({
        file: relativeFile,
        noteFile: relativeNoteFile,
        reason: "css fenced block does not match case source",
      });
    }
  }
  return mismatches.sort((left, right) => left.file.localeCompare(right.file));
}

export async function findSidecarHeadingMismatches(
  absoluteCaseNoteFiles: readonly string[],
  readmeRoot: string,
): Promise<readonly SidecarHeadingMismatch[]> {
  const mismatches: SidecarHeadingMismatch[] = [];
  for (const noteFile of absoluteCaseNoteFiles) {
    const noteSource = await readFile(noteFile, "utf8");
    const missingHeadings = missingRequiredSidecarHeadings(noteSource);
    if (missingHeadings.length === 0) {
      continue;
    }
    mismatches.push({
      noteFile: toPosixPath(path.relative(readmeRoot, noteFile)),
      missingHeadings,
    });
  }
  return mismatches.sort((left, right) => left.noteFile.localeCompare(right.noteFile));
}

export async function findSidecarContextMismatches(
  absoluteCaseNoteFiles: readonly string[],
  readmeRoot: string,
): Promise<readonly SidecarContextMismatch[]> {
  const mismatches: SidecarContextMismatch[] = [];
  for (const noteFile of absoluteCaseNoteFiles) {
    const noteSource = await readFile(noteFile, "utf8");
    const hasContextHeading = hasMarkdownHeading(noteSource, "Spec Context");
    const hasTriageHeading = hasMarkdownHeading(noteSource, "Triage Note");
    if (!hasContextHeading && !hasTriageHeading) {
      continue;
    }
    if (
      sectionHasNonEmptyBody(noteSource, "Spec Context") ||
      sectionHasNonEmptyBody(noteSource, "Triage Note")
    ) {
      continue;
    }
    mismatches.push({
      noteFile: toPosixPath(path.relative(readmeRoot, noteFile)),
      reason: "missing non-empty Spec Context or Triage Note body",
    });
  }
  return mismatches.sort((left, right) => left.noteFile.localeCompare(right.noteFile));
}

export async function findSidecarTitleIdMismatches(
  absoluteCaseNoteFiles: readonly string[],
  readmeRoot: string,
  readmeCaseIds: readonly ReadmeCaseId[],
): Promise<readonly SidecarTitleIdMismatch[]> {
  const readmeIdsByFile = new Map(readmeCaseIds.map((item) => [item.file, item.id]));
  const mismatches: SidecarTitleIdMismatch[] = [];
  for (const noteFile of absoluteCaseNoteFiles) {
    const noteSource = await readFile(noteFile, "utf8");
    const relativeNoteFile = toPosixPath(path.relative(readmeRoot, noteFile));
    const relativeCaseFile = toPosixPath(
      path.relative(readmeRoot, caseFilePathForCaseNoteFile(noteFile)),
    );
    const expectedId = readmeIdsByFile.get(relativeCaseFile);
    const actualId = extractSidecarTitleId(noteSource);

    if (expectedId === undefined) {
      mismatches.push({
        file: relativeCaseFile,
        noteFile: relativeNoteFile,
        ...(actualId === undefined ? {} : { actualId }),
        reason: "missing README case ID",
      });
      continue;
    }

    if (actualId === undefined) {
      mismatches.push({
        file: relativeCaseFile,
        noteFile: relativeNoteFile,
        expectedId,
        reason: "missing sidecar title ID",
      });
      continue;
    }

    if (actualId !== expectedId) {
      mismatches.push({
        file: relativeCaseFile,
        noteFile: relativeNoteFile,
        expectedId,
        actualId,
        reason: "sidecar title ID does not match README case ID",
      });
    }
  }
  return mismatches.sort((left, right) => left.noteFile.localeCompare(right.noteFile));
}

export function findUninterestingReplayRows(
  rows: readonly ReplayRow[],
  syntax: CssSyntax,
): readonly UninterestingCase[] {
  return rows.flatMap((row) => {
    const finding = classifyFinding(
      {
        id: path.basename(row.file, ".css"),
        seed: row.file,
        syntax,
        source: row.source,
        tags: ["case-repo"],
        specRefs: [],
      },
      row.results,
    );
    if (finding.interesting) {
      return [];
    }
    return [
      {
        file: row.file,
        reason: finding.reason,
        fingerprint: findingFingerprint(row.results),
        results: row.results,
      },
    ];
  });
}

export async function findReducibleReplayRows(
  rows: readonly ReplayRow[],
  options: {
    readonly adapters: readonly ParserAdapter[];
    readonly syntax: CssSyntax;
    readonly timeoutMs: number;
    readonly maxAttempts: number;
    readonly allowByteLevel: boolean;
  },
): Promise<readonly ReducibleCase[]> {
  const reducible: ReducibleCase[] = [];
  for (const row of rows) {
    const initialFinding = classifyFinding(
      {
        id: path.basename(row.file, ".css"),
        seed: row.file,
        syntax: options.syntax,
        source: row.source,
        tags: ["case-repo"],
        specRefs: [],
      },
      row.results,
    );
    if (!initialFinding.interesting) {
      continue;
    }

    const minimized = await minimizeText(
      row.source,
      async (candidate) => {
        const candidateFinding = await replayCandidate(row, candidate, options);
        return (
          candidateFinding.interesting &&
          preservesFindingIdentity(row.source, row.results, candidate, candidateFinding.results)
        );
      },
      {
        maxAttempts: options.maxAttempts,
        allowByteLevel: options.allowByteLevel,
      },
    );
    const originalSource = normalizeCaseSource(row.source);
    const reducedSource = normalizeCaseSource(minimized.source);
    if (reducedSource !== originalSource && reducedSource.length < originalSource.length) {
      reducible.push({
        file: row.file,
        originalBytes: Buffer.byteLength(originalSource, "utf8"),
        reducedBytes: Buffer.byteLength(reducedSource, "utf8"),
        attempts: minimized.attempts,
        reducedSource,
      });
    }
  }
  return reducible;
}

export function caseRepoVerificationPassed(result: CaseRepoVerificationResult): boolean {
  return (
    result.missingFromReadme.length === 0 &&
    result.missingOnDisk.length === 0 &&
    result.readmeDuplicateLinks.length === 0 &&
    result.readmeDuplicateCaseIds.length === 0 &&
    result.readmeCaseIdPathMismatches.length === 0 &&
    result.missingCaseNotes.length === 0 &&
    result.orphanCaseNotes.length === 0 &&
    result.sidecarSourceMismatches.length === 0 &&
    result.sidecarHeadingMismatches.length === 0 &&
    result.sidecarContextMismatches.length === 0 &&
    result.sidecarTitleIdMismatches.length === 0 &&
    result.sidecarRowsMissingParserExpectations.length === 0 &&
    result.sidecarRowsMissingParserMessages.length === 0 &&
    result.sidecarMatrixMismatches.length === 0 &&
    result.uninterestingCases.length === 0 &&
    result.readmeLinksWithoutPriority.length === 0 &&
    result.readmePriorityPathMismatches.length === 0 &&
    result.readmeLinksWithoutMatrix.length === 0 &&
    result.readmeRowsMissingParserExpectations.length === 0 &&
    result.readmeRowsMissingParserMessages.length === 0 &&
    result.matrixMismatches.length === 0 &&
    result.reducibleCases.length === 0
  );
}

export function formatCaseRepoVerification(result: CaseRepoVerificationResult): string {
  const lines = [
    `Checked ${result.caseFiles.length} CSS case files, ${result.caseNoteFiles.length} sidecar notes, and ${result.readmeLinks.length} README case links.`,
  ];

  if (caseRepoVerificationPassed(result)) {
    const minimizationClause = result.minimizationChecked
      ? ", and are reduction-stable under the configured minimizer"
      : "";
    lines.push(
      `All case files have sidecar notes with matching CSS reproduction blocks, required headings with explanatory text, README-matching title IDs, and complete parser result tables with error-message snippets, are covered by unique README links and IDs, use case filenames matching their README IDs, are listed under matching priority sections, have complete README parser matrix rows with error-message snippets, still replay as interesting, match the README and sidecar parser matrices${minimizationClause}.`,
    );
    return `${lines.join("\n")}\n`;
  }

  if (result.missingFromReadme.length > 0) {
    lines.push("", "Missing from README:");
    for (const file of result.missingFromReadme) {
      lines.push(`- ${file}`);
    }
  }

  if (result.missingOnDisk.length > 0) {
    lines.push("", "Linked in README but missing on disk:");
    for (const file of result.missingOnDisk) {
      lines.push(`- ${file}`);
    }
  }

  if (result.readmeDuplicateLinks.length > 0) {
    lines.push("", "Duplicate README case links:");
    for (const file of result.readmeDuplicateLinks) {
      lines.push(`- ${file}`);
    }
  }

  if (result.readmeDuplicateCaseIds.length > 0) {
    lines.push("", "Duplicate README case IDs:");
    for (const item of result.readmeDuplicateCaseIds) {
      lines.push(`- ${item.id}: ${item.files.join(", ")}`);
    }
  }

  if (result.readmeCaseIdPathMismatches.length > 0) {
    lines.push("", "README case IDs do not match case file names:");
    for (const item of result.readmeCaseIdPathMismatches) {
      lines.push(
        `- ${item.file}: ID ${item.id} expects basename ${item.expectedBasenamePrefix} or ${item.expectedBasenamePrefix}-*; actual ${item.actualBasename}`,
      );
    }
  }

  if (result.missingCaseNotes.length > 0) {
    lines.push("", "Case files missing sidecar notes:");
    for (const file of result.missingCaseNotes) {
      lines.push(`- ${file}`);
    }
  }

  if (result.orphanCaseNotes.length > 0) {
    lines.push("", "Sidecar notes without matching CSS cases:");
    for (const file of result.orphanCaseNotes) {
      lines.push(`- ${file}`);
    }
  }

  if (result.sidecarSourceMismatches.length > 0) {
    lines.push("", "Sidecar note CSS reproduction blocks do not match case files:");
    for (const item of result.sidecarSourceMismatches) {
      lines.push(`- ${item.noteFile}: ${item.reason} for ${item.file}`);
    }
  }

  if (result.sidecarHeadingMismatches.length > 0) {
    lines.push("", "Sidecar notes missing required headings:");
    for (const item of result.sidecarHeadingMismatches) {
      lines.push(`- ${item.noteFile}: ${item.missingHeadings.join(", ")}`);
    }
  }

  if (result.sidecarContextMismatches.length > 0) {
    lines.push("", "Sidecar notes missing explanatory context text:");
    for (const item of result.sidecarContextMismatches) {
      lines.push(`- ${item.noteFile}: ${item.reason}`);
    }
  }

  if (result.sidecarTitleIdMismatches.length > 0) {
    lines.push("", "Sidecar note title IDs do not match README case IDs:");
    for (const item of result.sidecarTitleIdMismatches) {
      const expected = item.expectedId ?? "missing";
      const actual = item.actualId ?? "missing";
      lines.push(
        `- ${item.noteFile} for ${item.file}: ${item.reason}; expected ${expected}; actual ${actual}`,
      );
    }
  }

  if (result.sidecarRowsMissingParserExpectations.length > 0) {
    lines.push("", "Sidecar parser result tables missing parser expectations:");
    for (const item of result.sidecarRowsMissingParserExpectations) {
      lines.push(`- ${item.noteFile} for ${item.file}: ${item.parser}`);
    }
  }

  if (result.sidecarRowsMissingParserMessages.length > 0) {
    lines.push("", "Sidecar parser result tables missing error-message snippets:");
    for (const item of result.sidecarRowsMissingParserMessages) {
      lines.push(`- ${item.noteFile} for ${item.file}: ${item.parser} ${item.status}`);
    }
  }

  if (result.sidecarMatrixMismatches.length > 0) {
    lines.push("", "Sidecar parser result table mismatches:");
    for (const item of result.sidecarMatrixMismatches) {
      lines.push(
        `- ${item.noteFile} for ${item.file} ${item.parser}: expected ${item.expected}; actual ${item.actual}`,
      );
    }
  }

  if (result.uninterestingCases.length > 0) {
    lines.push("", "No longer interesting under current parser versions:");
    for (const item of result.uninterestingCases) {
      lines.push(`- ${item.file}: ${item.reason}`);
      lines.push(`  fingerprint: ${item.fingerprint}`);
    }
  }

  if (result.readmeLinksWithoutPriority.length > 0) {
    lines.push("", "README case links outside High/Medium/Low priority sections:");
    for (const file of result.readmeLinksWithoutPriority) {
      lines.push(`- ${file}`);
    }
  }

  if (result.readmePriorityPathMismatches.length > 0) {
    lines.push("", "README priority sections do not match case file paths:");
    for (const item of result.readmePriorityPathMismatches) {
      lines.push(`- ${item.file}: ${item.priority} expects ${item.expectedPrefix}`);
    }
  }

  if (result.readmeLinksWithoutMatrix.length > 0) {
    lines.push("", "README case links without parser matrix rows:");
    for (const file of result.readmeLinksWithoutMatrix) {
      lines.push(`- ${file}`);
    }
  }

  if (result.readmeRowsMissingParserExpectations.length > 0) {
    lines.push("", "README parser matrix rows missing parser expectations:");
    for (const item of result.readmeRowsMissingParserExpectations) {
      lines.push(`- ${item.file}: ${item.parser}`);
    }
  }

  if (result.readmeRowsMissingParserMessages.length > 0) {
    lines.push("", "README parser matrix rows missing error-message snippets:");
    for (const item of result.readmeRowsMissingParserMessages) {
      lines.push(`- ${item.file}: ${item.parser} ${item.status}`);
    }
  }

  if (result.matrixMismatches.length > 0) {
    lines.push("", "README parser matrix mismatches:");
    for (const item of result.matrixMismatches) {
      lines.push(`- ${item.file} ${item.parser}: expected ${item.expected}; actual ${item.actual}`);
    }
  }

  if (result.reducibleCases.length > 0) {
    lines.push("", "Cases reducible by the configured minimizer:");
    for (const item of result.reducibleCases) {
      lines.push(
        `- ${item.file}: ${item.originalBytes} -> ${item.reducedBytes} bytes in ${item.attempts} attempts`,
      );
      lines.push(`  candidate: ${JSON.stringify(item.reducedSource)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function replayCandidate(
  row: ReplayRow,
  source: string,
  options: {
    readonly adapters: readonly ParserAdapter[];
    readonly syntax: CssSyntax;
    readonly timeoutMs: number;
  },
) {
  return await runDifferentialCase(
    options.adapters,
    {
      id: path.basename(row.file, ".css"),
      seed: row.file,
      syntax: options.syntax,
      source,
      tags: ["case-repo"],
      specRefs: [],
    },
    { syntax: options.syntax, timeoutMs: options.timeoutMs },
  );
}

function splitMarkdownTableRow(line: string): readonly string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let start = 0;
  let codeFence: string | undefined;
  for (let index = 0; index < trimmed.length; ) {
    const char = trimmed.charAt(index);
    if (char === "`") {
      const fence = readBacktickRun(trimmed, index);
      if (codeFence === undefined) {
        codeFence = fence;
      } else if (fence === codeFence) {
        codeFence = undefined;
      }
      index += fence.length;
      continue;
    }
    if (char === "|" && codeFence === undefined) {
      cells.push(trimmed.slice(start, index).trim());
      start = index + 1;
    }
    index += 1;
  }
  cells.push(trimmed.slice(start).trim());
  return cells;
}

function readBacktickRun(value: string, start: number): string {
  let end = start;
  while (value.charAt(end) === "`") {
    end += 1;
  }
  return value.slice(start, end);
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parserColumnsFromHeader(
  cells: readonly string[],
): ReadonlyMap<ParserName, number> | undefined {
  const columns = new Map<ParserName, number>();
  for (let index = 0; index < cells.length; index += 1) {
    const label = stripMarkdown(cells[index] ?? "").toLowerCase();
    if (label === "postcss") {
      columns.set("postcss", index);
    } else if (label === "prettier css parser") {
      columns.set("prettier-css", index);
    } else if (label === "lightningcss") {
      columns.set("lightningcss", index);
    } else if (label === "oxc-css-parser") {
      columns.set("oxc-css-parser", index);
    }
  }
  return columns.size === parserNames.length ? columns : undefined;
}

function sidecarParserTableColumnsFromHeader(
  cells: readonly string[],
): { readonly parserColumn: number; readonly resultColumn: number } | undefined {
  let parserColumn: number | undefined;
  let resultColumn: number | undefined;
  for (let index = 0; index < cells.length; index += 1) {
    const label = stripMarkdown(cells[index] ?? "")
      .trim()
      .toLowerCase();
    if (label === "parser") {
      parserColumn = index;
    } else if (label === "result") {
      resultColumn = index;
    }
  }
  return parserColumn === undefined || resultColumn === undefined
    ? undefined
    : { parserColumn, resultColumn };
}

function extractSidecarParserExpectationMap(
  markdown: string,
): ReadonlyMap<ParserName, ReadmeParserExpectation> {
  const parsers = new Map<ParserName, ReadmeParserExpectation>();
  let inParserResults = false;
  let parserColumn: number | undefined;
  let resultColumn: number | undefined;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading !== undefined) {
      inParserResults = heading === "Parser Results";
      parserColumn = undefined;
      resultColumn = undefined;
      continue;
    }

    if (!inParserResults) {
      continue;
    }

    if (!line.startsWith("|") || !line.endsWith("|")) {
      parserColumn = undefined;
      resultColumn = undefined;
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    if (isSeparatorRow(cells)) {
      continue;
    }

    const headerColumns = sidecarParserTableColumnsFromHeader(cells);
    if (headerColumns !== undefined) {
      parserColumn = headerColumns.parserColumn;
      resultColumn = headerColumns.resultColumn;
      continue;
    }

    if (parserColumn === undefined || resultColumn === undefined) {
      continue;
    }

    const parserCell = cells[parserColumn];
    const resultCell = cells[resultColumn];
    const parser = parserCell === undefined ? undefined : parseSidecarParserLabel(parserCell);
    if (parser === undefined || resultCell === undefined) {
      continue;
    }
    parsers.set(parser, parseReadmeParserExpectation(resultCell));
  }

  return parsers;
}

function parseSidecarParserLabel(cell: string): ParserName | undefined {
  const label = stripMarkdown(cell).trim().toLowerCase().replaceAll(/\s+/g, " ");
  if (label === "postcss" || label.startsWith("postcss ")) {
    return "postcss";
  }
  if (label === "prettier css parser" || label.startsWith("prettier css parser ")) {
    return "prettier-css";
  }
  if (label === "lightningcss" || label.startsWith("lightningcss ")) {
    return "lightningcss";
  }
  if (label === "oxc-css-parser" || label.startsWith("oxc-css-parser ")) {
    return "oxc-css-parser";
  }
  return undefined;
}

function extractCaseLinkFromCells(cells: readonly string[]): string | undefined {
  for (const cell of cells) {
    const match = /\]\(([^)\s]+\.css(?:#[^)\s]+)?)\)/.exec(cell);
    if (match?.[1] !== undefined) {
      return normalizeReadmeCaseTarget(match[1]);
    }
  }
  return undefined;
}

function extractCaseLinksFromLine(line: string): readonly string[] {
  const links: string[] = [];
  const pattern = /\]\(([^)\s]+\.css(?:#[^)\s]+)?)\)/g;
  for (const match of line.matchAll(pattern)) {
    const target = match[1];
    if (target === undefined) {
      continue;
    }
    const normalized = normalizeReadmeCaseTarget(target);
    if (normalized !== undefined) {
      links.push(normalized);
    }
  }
  return links;
}

function parseCasePriority(heading: string): CasePriority | undefined {
  return casePriorities.find((priority) => priority === heading);
}

function parseReadmeParserExpectation(cell: string): ReadmeParserExpectation {
  const normalized = stripMarkdown(cell).trim();
  const lower = normalized.toLowerCase();
  if (lower === "accepts") {
    return { status: "accepted" };
  }
  if (lower.startsWith("accepts with errors")) {
    return {
      status: "accepted_with_errors",
      ...messageSnippetFromCell(normalized, "accepts with errors"),
    };
  }
  if (lower === "unsupported") {
    return { status: "unsupported" };
  }
  if (lower.startsWith("rejects")) {
    return { status: "rejected", ...messageSnippetFromCell(normalized, "rejects") };
  }
  if (lower.startsWith("crashes")) {
    return { status: "crashed", ...messageSnippetFromCell(normalized, "crashes") };
  }
  if (lower.startsWith("times out")) {
    return { status: "timed_out", ...messageSnippetFromCell(normalized, "times out") };
  }
  throw new Error(`Unsupported README parser result cell "${cell}"`);
}

function messageSnippetFromCell(
  value: string,
  prefix: string,
): { readonly messageSnippet?: string } {
  const snippet = value.slice(prefix.length).replace(/^:\s*/, "").trim();
  return snippet === "" ? {} : { messageSnippet: snippet };
}

function parserExpectationMatches(expected: ReadmeParserExpectation, actual: ParseResult): boolean {
  if (expected.status !== actual.status) {
    return false;
  }
  if (expected.messageSnippet === undefined) {
    return true;
  }
  return messageMatches(expected.messageSnippet, actual.message ?? "");
}

function parserStatusRequiresMessage(expected: ReadmeParserExpectation): boolean {
  return (
    expected.messageSnippet === undefined &&
    (expected.status === "accepted_with_errors" ||
      expected.status === "rejected" ||
      expected.status === "crashed" ||
      expected.status === "timed_out")
  );
}

function messageMatches(expectedSnippet: string, actualMessage: string): boolean {
  const actual = normalizeComparableText(actualMessage);
  const parts = expectedSnippet
    .split("...")
    .map((part) => normalizeComparableText(part))
    .filter(Boolean);
  let offset = 0;
  for (const part of parts) {
    const index = actual.indexOf(part, offset);
    if (index === -1) {
      return false;
    }
    offset = index + part.length;
  }
  return true;
}

function formatExpectedParserExpectation(expectation: ReadmeParserExpectation): string {
  return expectation.messageSnippet === undefined
    ? expectation.status
    : `${expectation.status}: ${expectation.messageSnippet}`;
}

function formatActualParserResult(result: ParseResult): string {
  return result.message === undefined
    ? result.status
    : `${result.status}: ${firstLine(result.message)}`;
}

function stripMarkdown(value: string): string {
  return value.replaceAll("`", "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function normalizeComparableText(value: string): string {
  return stripMarkdown(firstLine(value)).replaceAll(/\s+/g, " ").trim();
}

function normalizeCaseSource(source: string): string {
  return source.replaceAll(/\r\n?/g, "\n").trimEnd();
}

function missingRequiredSidecarHeadings(markdown: string): readonly string[] {
  const missing: string[] = [];
  if (!hasMarkdownHeading(markdown, "Minimal Reproduction")) {
    missing.push("Minimal Reproduction");
  }
  if (!hasMarkdownHeading(markdown, "Parser Results")) {
    missing.push("Parser Results");
  }
  if (
    !hasMarkdownHeading(markdown, "Spec Context") &&
    !hasMarkdownHeading(markdown, "Triage Note")
  ) {
    missing.push("Spec Context or Triage Note");
  }
  return missing;
}

function extractSidecarTitleId(markdown: string): string | undefined {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = /^#\s+(.+?)\s*$/.exec(rawLine.trim())?.[1];
    if (heading === undefined) {
      continue;
    }
    return /^([A-Z0-9][A-Z0-9-]*)\s*:/.exec(heading)?.[1];
  }
  return undefined;
}

function hasMarkdownHeading(markdown: string, heading: string): boolean {
  return markdown.split(/\r?\n/).some((line) => line.trim() === `## ${heading}`);
}

function sectionHasNonEmptyBody(markdown: string, heading: string): boolean {
  let inSection = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch !== null) {
      const level = headingMatch[1]?.length ?? 0;
      const title = headingMatch[2];
      if (level === 2 && title === heading) {
        inSection = true;
        continue;
      }
      if (inSection && level <= 2) {
        return false;
      }
    }
    if (inSection && line !== "") {
      return true;
    }
  }
  return false;
}

export function extractFirstCssFence(markdown: string): string | undefined {
  const match = /```css\s*\r?\n([\s\S]*?)\r?\n```/i.exec(markdown);
  return match?.[1];
}

async function collectCaseNoteFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  await collectFilesWithExtension(root, ".md", files);
  return files.sort((left, right) => left.localeCompare(right));
}

async function collectFilesWithExtension(
  root: string,
  extension: string,
  files: string[],
): Promise<void> {
  const info = await stat(root);
  if (info.isFile()) {
    if (root.endsWith(extension)) {
      files.push(root);
    }
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectFilesWithExtension(fullPath, extension, files);
    } else if (entry.isFile() && fullPath.endsWith(extension)) {
      files.push(fullPath);
    }
  }
}

function caseNotePathForCaseFile(file: string): string {
  return file.replace(/\.css$/, ".md");
}

function caseFilePathForCaseNoteFile(file: string): string {
  return file.replace(/\.md$/, ".css");
}

function normalizeCaseIdForPath(id: string): string {
  return id
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeReadmeCaseTarget(target: string): string | undefined {
  const withoutFragment = target.split("#")[0] ?? "";
  const normalized = withoutFragment.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized.startsWith("cases/") || !normalized.endsWith(".css")) {
    return undefined;
  }
  return normalized;
}

function toPosixPath(file: string): string {
  return file.split(path.sep).join("/");
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? value;
}
