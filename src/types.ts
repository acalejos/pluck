import type { ZodType } from 'zod';

export interface FetchOptions { render?: boolean; timeoutMs?: number; }
export interface FetchResult { url: string; finalUrl?: string; status: number; html: string; markdown?: string; }
export interface Fetcher { fetch(url: string, opts?: FetchOptions): Promise<FetchResult>; }
export interface RouterRequest { content: string; jsonSchema: Record<string, unknown>; instruction?: string; requiresFeatures?: string[]; }
export interface Router { extract(req: RouterRequest): Promise<unknown>; }
export interface FieldProvenance { value: unknown; found: boolean; sourceSpan?: string; confidence: number; }
export interface Provenance { fields: Record<string, FieldProvenance>; verifiedRatio: number; }
export type ExtractSource = 'jsonld' | 'llm';
export interface CachedExtraction { data: unknown; provenance: Provenance; contentHash: string; schemaHash: string; source: ExtractSource; at: string; }
export interface Cache { get(key: string): Promise<CachedExtraction | undefined>; set(key: string, value: CachedExtraction): Promise<void>; }
export type ExtractResult<T> = { ok: true; data: T; provenance: Provenance; cached: boolean; source: ExtractSource } | { ok: false; reason: string; partial?: Partial<T> };
export interface VerifyConfig { minRatio?: number; }
export interface PluckConfig { fetcher?: Fetcher; router?: Router; cache?: Cache; verify?: boolean | VerifyConfig; jsonLdFirst?: boolean; }
export interface ExtractOptions { instruction?: string; render?: boolean; }
