export const ruleKeywords: readonly string[];
export interface CorpusNode { readonly value: unknown; readonly step: { readonly pointer: string; readonly kind: string; readonly key: string; readonly label: string; readonly keyword?: string; readonly index?: number }; readonly children: readonly CorpusNode[]; }
export interface CorpusCoverage { readonly locations: number; readonly carriers: number; readonly keywords: number; readonly canonicalReferences: number; readonly legacyReferences: number; readonly relationships: number; readonly visitedCarriers: readonly string[]; }
export function corpusNavigationPlan(document: unknown): readonly CorpusNode[];
export function driveMountedCorpus(root: HTMLElement, roots: readonly CorpusNode[], manifestCarriers: Readonly<Record<string, readonly string[]>>, options?: {delay?:number;compact?:boolean;requireLayout?:boolean}): Promise<CorpusCoverage>;
