/** Size limits enforced by the API and the store, and shown by the web forms. */
export const LIMITS = {
  workspaceName: 80,
  chatTitle: 120,
  instructions: 8000,
  folderPath: 1024,
  filePreviewBytes: 200_000,
  modelName: 80,
  modelId: 200,
  modelUrl: 500,
  apiKey: 1000,
} as const;
