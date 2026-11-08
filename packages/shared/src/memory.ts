export interface Memory {
  id: string;
  fact: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MemoryRemoval {
  removed: number;
  memories: Memory[];
}
