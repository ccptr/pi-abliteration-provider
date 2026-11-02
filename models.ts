import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export const PROVIDER_ID = "abliteration";
export const BASE_URL = "https://api.abliteration.ai/v1";
export const API_KEY_ENV = "ABLITERATION_API_KEY";

/**
 * Output cap pi requests by default. The API advertises output limits close to the
 * full context window, which would let one runaway reply use the whole window.
 * pi still clamps this to the context left over after the prompt.
 */
export const DEFAULT_MAX_TOKENS = 65536;

type ChatModelConfig = Extract<ProviderModelConfig, { reasoning: boolean }>;

/**
 * Request differences checked against the live API (vLLM behind an OpenAI-style gateway):
 * - accepts the `developer` role, `max_completion_tokens` and `store`
 * - streams usage when `stream_options.include_usage` is set, and streams reasoning in `delta.reasoning`
 * - `reasoning_effort` accepts none/minimal/low/medium/high/xhigh/max and rejects anything else;
 *   "none" turns reasoning off, which otherwise runs by default
 */
export const COMPAT = {
	supportsDeveloperRole: true,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	maxTokensField: "max_completion_tokens",
	thinkingFormat: "openai",
} as const satisfies ChatModelConfig["compat"];

/** pi thinking level -> `reasoning_effort`. Unlisted levels are sent under their own name. */
export const THINKING_LEVEL_MAP = { off: "none", xhigh: "xhigh", max: "max" } as const;

/** Used before the first successful catalog fetch, or when the API cannot be reached. */
export const FALLBACK_MODELS: ChatModelConfig[] = [
	chatModel("abliterated-model", "Abliterated Model", ["text", "image"], 262144, 262134, 1, 3, 0.1),
	chatModel("abliterated-model-large", "Abliterated Large", ["text"], 1000000, 999990, 3, 5, 0.3),
	chatModel("abliterated-model-large-v2", "Abliterated Large v2", ["text"], 1000000, 999990, 3, 5, 0.3),
	chatModel("abliterated-model-large-flash", "Abliterated Large Flash", ["text", "image"], 1048576, 262144, 1, 2, 0.1),
];

function chatModel(
	id: string,
	name: string,
	input: ("text" | "image")[],
	contextWindow: number,
	maxOutput: number,
	inputCost: number,
	outputCost: number,
	cacheReadCost: number,
	reasoning = true,
): ChatModelConfig {
	return {
		id,
		name,
		reasoning,
		...(reasoning ? { thinkingLevelMap: { ...THINKING_LEVEL_MAP } } : {}),
		input,
		cost: { input: inputCost, output: outputCost, cacheRead: cacheReadCost, cacheWrite: 0 },
		contextWindow,
		maxTokens: Math.min(maxOutput, contextWindow, DEFAULT_MAX_TOKENS),
		compat: { ...COMPAT },
	};
}

/** One entry of `GET /v1/models`, limited to the fields used here. */
export interface ApiModel {
	id?: unknown;
	name?: unknown;
	display_name?: unknown;
	input_modalities?: unknown;
	output_modalities?: unknown;
	pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown } | null;
	supported_features?: unknown;
	context_length?: unknown;
	max_output_length?: unknown;
	access?: { available?: unknown } | null;
}

/** Map the `GET /v1/models` response to pi models, skipping entries that cannot be chatted with. */
export function parseCatalog(body: unknown): ChatModelConfig[] {
	const data = (body as { data?: unknown } | null)?.data;
	if (!Array.isArray(data)) throw new Error("abliteration.ai /models response has no data array");
	const models: ChatModelConfig[] = [];
	for (const entry of data as ApiModel[]) {
		const model = parseModel(entry);
		if (model) models.push(model);
	}
	return models;
}

export function parseModel(entry: ApiModel): ChatModelConfig | undefined {
	if (!entry || typeof entry.id !== "string" || entry.id === "") return undefined;
	if (entry.access?.available === false) return undefined;
	const outputs = strings(entry.output_modalities);
	if (outputs && !outputs.includes("text")) return undefined;

	const fallback = FALLBACK_MODELS.find((model) => model.id === entry.id);
	const inputs = strings(entry.input_modalities);
	const input: ("text" | "image")[] = inputs
		? ["text", ...(inputs.includes("image") ? (["image"] as const) : [])]
		: (fallback?.input ?? ["text"]);
	const features = strings(entry.supported_features);
	const contextWindow = positive(entry.context_length) ?? fallback?.contextWindow ?? 131072;
	const maxOutput = positive(entry.max_output_length) ?? contextWindow;
	const name = text(entry.display_name) ?? text(entry.name) ?? fallback?.name ?? entry.id;

	return chatModel(
		entry.id,
		name,
		input,
		contextWindow,
		maxOutput,
		perMillion(entry.pricing?.prompt) ?? fallback?.cost.input ?? 0,
		perMillion(entry.pricing?.completion) ?? fallback?.cost.output ?? 0,
		perMillion(entry.pricing?.input_cache_read) ?? fallback?.cost.cacheRead ?? 0,
		features ? features.includes("reasoning") : (fallback?.reasoning ?? true),
	);
}

/** Pricing comes as USD per token in a decimal string; pi wants USD per million tokens. */
function perMillion(value: unknown): number | undefined {
	const perToken = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
	if (!Number.isFinite(perToken) || perToken < 0) return undefined;
	return Math.round(perToken * 1e12) / 1e6;
}

function positive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function strings(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

/**
 * Rebuild models persisted by an earlier refresh. Only catalog data is taken from storage;
 * compat flags, thinking levels and the output cap always come from this file, so a
 * provider update takes effect without waiting for the next catalog fetch.
 */
export function restoreModels(stored: readonly unknown[] | undefined): ChatModelConfig[] | undefined {
	if (!stored || stored.length === 0) return undefined;
	const models: ChatModelConfig[] = [];
	for (const item of stored) {
		const model = item as Partial<ChatModelConfig> & { provider?: unknown; type?: unknown };
		if (model?.provider !== PROVIDER_ID || (model.type !== undefined && model.type !== "chat")) continue;
		if (typeof model.id !== "string" || typeof model.name !== "string" || !model.cost) continue;
		const contextWindow = positive(model.contextWindow);
		const maxTokens = positive(model.maxTokens);
		if (!contextWindow || !maxTokens) continue;
		const input = strings(model.input)?.includes("image") ? (["text", "image"] as const) : (["text"] as const);
		const { input: inCost, output, cacheRead } = model.cost;
		models.push(
			chatModel(model.id, model.name, [...input], contextWindow, maxTokens, inCost, output, cacheRead, model.reasoning !== false),
		);
	}
	return models.length > 0 ? models : undefined;
}

/** Shape written to pi's models store, which expects complete model records. */
export function toStoredModels(models: ChatModelConfig[], baseUrl: string) {
	return models.map((model) => ({
		...model,
		type: "chat" as const,
		provider: PROVIDER_ID,
		api: "openai-completions" as const,
		baseUrl,
	}));
}
