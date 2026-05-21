export interface CodexTaskRequest {
  role: string;
  prompt: string;
  artifacts: string[];
}

export interface CodexTaskResult {
  summary: string;
  changedArtifacts: string[];
}

export interface CodexAdapter {
  runTask(request: CodexTaskRequest): Promise<CodexTaskResult>;
}
