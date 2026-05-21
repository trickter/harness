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
  return value.replaceAll("\\", "/").replace(/\s+/g, " ").slice(0, 160);
}

function parseSummaryFailureCount(output: string): number | undefined {
  const summaryPatterns = [
    /(?:Tests?|Suites?):\s+(\d+)\s+failed/i,
    /(\d+)\s+failed(?:,|\s)/i,
    /failures?[:=]\s*(\d+)/i
  ];

  for (const pattern of summaryPatterns) {
    const match = output.match(pattern);

    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }

  return undefined;
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
    const typeScript = parseTypeScript(input, lines);

    if (typeScript) {
      return typeScript;
    }

    const testRunner = parseTestRunner(input, output, lines);

    if (testRunner) {
      return testRunner;
    }

    return {
      failureCount: 1,
      errorSignature: `${input.operation}:${input.command}:exit-${input.exitCode}`,
      summary: `Command exited with ${input.exitCode}.`
    };
  }
}
