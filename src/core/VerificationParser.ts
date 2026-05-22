import type { ShellRunResult } from "../adapters/ShellAdapter.js";

export interface VerificationParseInput extends ShellRunResult {
  command: string;
  operation: string;
}

export interface ParsedVerificationOutput {
  failureCount: number;
  errorSignature?: string;
  summary: string;
}

function combinedOutput(input: VerificationParseInput): string {
  return `${input.stderr}\n${input.stdout}`;
}

function nonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeSignaturePart(value: string): string {
  return normalizeErrorSignature(value).slice(0, 160);
}

export function normalizeErrorSignature(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .replaceAll("\\", "/")
    .replace(/file:\/\/\/?/giu, "")
    .replace(/\((\d+),(\d+)\)/gu, "(<loc>)")
    .replace(/:(\d+):(\d+)(?=[:\s)]|$)/gu, ":<loc>")
    .replace(/\bline\s+\d+\b/giu, "line <n>")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s)\b/giu, "<duration>")
    .replace(/\b0x[0-9a-f]+\b/giu, "<hex>")
    .replace(/\b[0-9a-f]{12,}\b/giu, "<id>")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function parseSummaryFailureCount(output: string): number | undefined {
  const summaryPatterns = [
    /(?:Tests?|Suites?):\s+(\d+)\s+failed/i,
    /(?:Test Files?):\s+(\d+)\s+failed/i,
    /(?:Tests?|Test Files?)\s+(\d+)\s+failed/i,
    /(\d+)\s+failed(?:,|\s)/i,
    /failures?[:=]\s*(\d+)/i,
    /(\d+)\s+errors?(?:,|\s|$)/i
  ];

  for (const pattern of summaryPatterns) {
    const match = output.match(pattern);

    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }

  return undefined;
}

function parsed(input: {
  failureCount: number;
  operation: string;
  signature: string;
  summary: string;
}): ParsedVerificationOutput {
  return {
    failureCount: input.failureCount,
    errorSignature: `${input.operation}:${normalizeSignaturePart(input.signature)}`,
    summary: input.summary
  };
}

function firstMatchingLine(lines: string[], patterns: RegExp[]): string | undefined {
  return lines.find((line) => patterns.some((pattern) => pattern.test(line)));
}

function parseTypeScript(input: VerificationParseInput, lines: string[]): ParsedVerificationOutput | undefined {
  const diagnosticPattern = /error\s+(TS\d+):/i;
  const diagnostics = lines.filter((line) => diagnosticPattern.test(line));

  if (diagnostics.length === 0) {
    return undefined;
  }

  const first = diagnostics[0] ?? "";
  const code = first.match(diagnosticPattern)?.[1] ?? "TS";

  return {
    failureCount: diagnostics.length,
    errorSignature: `${input.operation}:${code}:${normalizeSignaturePart(first.replace(/^.*\((\d+,\d+)\):\s*/u, ""))}`,
    summary: `${diagnostics.length} TypeScript diagnostic(s) found.`
  };
}

function parseJestVitest(
  input: VerificationParseInput,
  output: string,
  lines: string[]
): ParsedVerificationOutput | undefined {
  const looksLikeJestVitest =
    /\b(jest|vitest)\b/iu.test(input.command) ||
    lines.some((line) => /^(FAIL|Test Files|Tests:|⎯{2,}|❯)\b/iu.test(line));
  const failureLine = firstMatchingLine(lines, [
    /^FAIL\s+\S+/iu,
    /^❯\s+\S+/iu,
    /^FAIL\s+\S+\s+>\s+/iu,
    /^×\s+/u,
    /^●\s+/u
  ]);
  const failedTests = output.match(/(?:^|\n)\s*Tests:?\s+(\d+)\s+failed/imu)?.[1];
  const failureCount = failedTests ? Number.parseInt(failedTests, 10) : parseSummaryFailureCount(output);

  if (!looksLikeJestVitest || (failureCount === undefined && !failureLine)) {
    return undefined;
  }

  return parsed({
    failureCount: failureCount ?? 1,
    operation: input.operation,
    signature: `jest-vitest:${failureLine ?? `exit-${input.exitCode}`}`,
    summary: `${failureCount ?? 1} Jest/Vitest failure(s) found.`
  });
}

function parsePytest(input: VerificationParseInput, output: string, lines: string[]): ParsedVerificationOutput | undefined {
  const failureLine = firstMatchingLine(lines, [
    /^FAILED\s+\S+::\S+/u,
    /^_{2,}\s+\S+\s+_{2,}$/u,
    /\b(E\s+)?AssertionError\b/u
  ]);
  const summary = output.match(/=+\s*(\d+)\s+failed(?:,|\s|=)/iu);
  const failureCount = summary?.[1] ? Number.parseInt(summary[1], 10) : undefined;
  const looksLikePytest =
    /\bpytest\b/iu.test(input.command) ||
    lines.some((line) => /^FAILED\s+\S+::\S+/u.test(line) || /=+\s*\d+\s+failed/u.test(line));

  if (!looksLikePytest || (failureCount === undefined && !failureLine)) {
    return undefined;
  }

  return parsed({
    failureCount: failureCount ?? 1,
    operation: input.operation,
    signature: `pytest:${failureLine ?? `exit-${input.exitCode}`}`,
    summary: `${failureCount ?? 1} pytest failure(s) found.`
  });
}

function parseEslint(input: VerificationParseInput, output: string, lines: string[]): ParsedVerificationOutput | undefined {
  const diagnosticLine = firstMatchingLine(lines, [
    /^\d+:\d+\s+error\s+/iu,
    /^\S+:\d+:\d+\s+error\s+/iu,
    /\berror\s{2,}\S+(?:-\S+)+\b/iu
  ]);
  const stylishSummary = output.match(/[✖x]\s*(\d+)\s+problems?\s*\((\d+)\s+errors?/iu);
  const failureCount =
    (stylishSummary?.[2] ? Number.parseInt(stylishSummary[2], 10) : undefined) ??
    (output.match(/(\d+)\s+errors?(?:,|\s|$)/iu)?.[1]
      ? Number.parseInt(output.match(/(\d+)\s+errors?(?:,|\s|$)/iu)?.[1] ?? "0", 10)
      : undefined);
  const looksLikeEslint =
    /\beslint\b/iu.test(input.command) ||
    /\bESLint\b/u.test(output) ||
    Boolean(stylishSummary);

  if (!looksLikeEslint || (failureCount === undefined && !diagnosticLine)) {
    return undefined;
  }

  return parsed({
    failureCount: failureCount ?? 1,
    operation: input.operation,
    signature: `eslint:${diagnosticLine ?? `exit-${input.exitCode}`}`,
    summary: `${failureCount ?? 1} ESLint error(s) found.`
  });
}

function parseBuildTool(input: VerificationParseInput, output: string, lines: string[]): ParsedVerificationOutput | undefined {
  const failureLine = firstMatchingLine(lines, [
    /^ERROR in\s+/iu,
    /^✘\s+\[ERROR\]\s+/u,
    /\berror during build\b/iu,
    /\bbuild failed\b/iu,
    /\bRollup failed to resolve import\b/iu,
    /\bModule not found\b/iu
  ]);
  const failureCount =
    output.match(/(\d+)\s+(?:build\s+)?errors?(?:\s+found)?/iu)?.[1] ??
    output.match(/with\s+(\d+)\s+errors?/iu)?.[1];
  const looksLikeBuild =
    /\b(build|webpack|rollup|vite build|esbuild|tsup|parcel)\b/iu.test(input.command) ||
    lines.some((line) => /\b(build failed|error during build|ERROR in)\b/iu.test(line));

  if (!looksLikeBuild || (!failureLine && !failureCount)) {
    return undefined;
  }

  const count = failureCount ? Number.parseInt(failureCount, 10) : 1;

  return parsed({
    failureCount: count,
    operation: input.operation,
    signature: `build:${failureLine ?? `exit-${input.exitCode}`}`,
    summary: `${count} build error(s) found.`
  });
}

function parseDataQuality(
  input: VerificationParseInput,
  output: string,
  lines: string[]
): ParsedVerificationOutput | undefined {
  const failureLine = firstMatchingLine(lines, [
    /\b(?:data\s+)?quality(?:\s+check)?\s+(?:failed|failure)\b/iu,
    /\bCHECK\s+(?:FAIL|FAILED)\b/iu,
    /\bexpectation(?:s)?\s+failed\b/iu,
    /\bmissing(?:[_\s-]?values?)?\s*(?:=|:)\s*[1-9]\d*\b/iu,
    /\bduplicates?\s*(?:=|:)\s*[1-9]\d*\b/iu
  ]);
  const countText =
    output.match(/(?:failed[_\s-]?checks?|failed[_\s-]?expectations?|quality failures?)\s*(?:=|:)\s*(\d+)/iu)?.[1] ??
    output.match(/(\d+)\s+(?:data\s+)?quality\s+(?:checks?\s+)?failed/iu)?.[1];
  const looksLikeDataQuality =
    input.operation === "shell:data-check" ||
    /\b(data-check|check-csv|data quality|great expectations|pandera)\b/iu.test(`${input.command}\n${output}`);

  if (!looksLikeDataQuality || (!failureLine && !countText)) {
    return undefined;
  }

  const count = countText ? Number.parseInt(countText, 10) : 1;

  return parsed({
    failureCount: count,
    operation: input.operation,
    signature: `data-quality:${failureLine ?? `exit-${input.exitCode}`}`,
    summary: `${count} data quality failure(s) found.`
  });
}

function parseModelMetrics(
  input: VerificationParseInput,
  output: string,
  lines: string[]
): ParsedVerificationOutput | undefined {
  const failureLine = firstMatchingLine(lines, [
    /\bmetric(?:\s+gate)?\s+(?:failed|failure)\b/iu,
    /\b(?:validation|test)\s+\w*(?:accuracy|f1|auc|loss)\b.*(?:below|above|threshold|failed)/iu,
    /\bexperiment\s+(?:failed|regressed)\b/iu,
    /\bmodel\s+(?:evaluation|metric)\s+(?:failed|regressed)\b/iu
  ]);
  const countText =
    output.match(/(?:metric failures?|failed metrics?|failed experiments?)\s*(?:=|:)\s*(\d+)/iu)?.[1] ??
    output.match(/(\d+)\s+(?:model\s+)?metrics?\s+failed/iu)?.[1];
  const looksLikeModelMetrics =
    /\b(evaluate|evaluation|experiment|model|metrics?|training|validation)\b/iu.test(input.command) ||
    /\b(metric gate|validation accuracy|experiment failed|model evaluation)\b/iu.test(output);

  if (!looksLikeModelMetrics || (!failureLine && !countText)) {
    return undefined;
  }

  const count = countText ? Number.parseInt(countText, 10) : 1;

  return parsed({
    failureCount: count,
    operation: input.operation,
    signature: `model-metrics:${failureLine ?? `exit-${input.exitCode}`}`,
    summary: `${count} model metric failure(s) found.`
  });
}

function parseTestRunner(input: VerificationParseInput, output: string, lines: string[]): ParsedVerificationOutput | undefined {
  const failureCount = parseSummaryFailureCount(output);
  const failedLine =
    lines.find((line) => /^(FAIL|FAILED)\s+/i.test(line)) ??
    lines.find((line) => /(^|\s)(AssertionError|Expected|Received|Error:)/i.test(line));

  if (failureCount === undefined && !failedLine) {
    return undefined;
  }

  return {
    failureCount: failureCount ?? 1,
    errorSignature: `${input.operation}:${normalizeSignaturePart(failedLine ?? `exit-${input.exitCode}`)}`,
    summary: `${failureCount ?? 1} test failure(s) found.`
  };
}

export class VerificationParser {
  parse(input: VerificationParseInput): ParsedVerificationOutput {
    if (input.exitCode === 0) {
      return {
        failureCount: 0,
        summary: "Command passed."
      };
    }

    const output = combinedOutput(input);
    const lines = nonEmptyLines(output);
    const specialized = [
      parseTypeScript(input, lines),
      parseJestVitest(input, output, lines),
      parsePytest(input, output, lines),
      parseEslint(input, output, lines),
      parseBuildTool(input, output, lines),
      parseDataQuality(input, output, lines),
      parseModelMetrics(input, output, lines),
      parseTestRunner(input, output, lines)
    ].find((result) => Boolean(result));

    if (specialized) {
      return specialized;
    }

    return {
      failureCount: 1,
      errorSignature: `${input.operation}:${input.command}:exit-${input.exitCode}`,
      summary: `Command exited with ${input.exitCode}.`
    };
  }
}
