export interface KinAnalysisResult {
  jobId?: string;
  reportMarkdown?: string;
  findingCount?: number;
}

export interface KinAnalysisProgress {
  jobId?: string;
  phase?: string;
  message?: string;
}

export interface ChatExportRequest {
  fromDate?: string;
  toDate?: string;
}

export interface ChatExportResult {
  ok?: boolean;
  canceled?: boolean;
  filePath?: string;
  exportedCount?: number;
  totalCount?: number;
  jobId?: string;
}

export interface ChatExportProgress {
  jobId?: string;
  phase?: string;
  processed?: number;
  total?: number;
  message?: string;
}

export interface KinagentApi {
  analyzeKin(input: { kinId: string }): Promise<KinAnalysisResult>;
  exportKinChat(input: ChatExportRequest & { kinId: string }): Promise<ChatExportResult>;
  exportGroupChat(input: ChatExportRequest & { groupId: string }): Promise<ChatExportResult>;
}

export interface PanelState {
  selectedKinId: string | null;
  selectedGroupId: string | null;
  kinAnalysisRunning: boolean;
  kinAnalysisJobId: string | null;
  kinAnalysisReport: string;
  chatExportSaving: boolean;
  chatExportJobId: string | null;
}

export interface AnalysisPanelElements {
  kinAnalyzeProgress: HTMLProgressElement;
  kinAnalyzeStatusLine: HTMLElement;
  kinAnalyzeReport: HTMLElement;
}

export interface ChatExportPanelElements {
  chatExportFromInput: HTMLInputElement;
  chatExportToInput: HTMLInputElement;
  chatExportProgress: HTMLProgressElement;
  chatExportStatusLine: HTMLElement;
}

export interface PanelContext<TElements> {
  state: PanelState;
  elements: TElements;
  api: KinagentApi;
  renderActivity: () => void;
}
