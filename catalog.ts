import type { Model } from "@earendil-works/pi-ai";

export type AbliterationModel = Model<"openai-completions">;

export const PROVIDER_ID = "abliteration";

/**
 * Request behavior checked against the live API:
 * - accepts the `developer` role and `max_completion_tokens`
 * - streams usage when `stream_options.include_usage` is set
 * - `reasoning_effort` takes none/minimal/low/medium/high/xhigh/max; "none" turns reasoning off
 */
const COMPAT: AbliterationModel["compat"] = {
	supportsDeveloperRole: true,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	maxTokensField: "max_completion_tokens",
	thinkingFormat: "openai",
};

type ThinkingLevelMap = NonNullable<AbliterationModel["thinkingLevelMap"]>;

/**
 * pi thinking level -> `reasoning_effort`, for models whose levels are all distinct.
 * Levels without a value are sent under their own name.
 */
const ALL_LEVELS: ThinkingLevelMap = { off: "none", xhigh: "xhigh", max: "max" };

/**
 * Models with fewer distinct levels, from https://docs.abliteration.ai/capabilities/thinking.md
 * (the model list does not report them). The API accepts every level name, but runs the
 * missing ones as one of these, so they are marked null: pi hides them and moves a
 * requested one up to the next real level.
 */
const LIMITED_LEVELS: Record<string, ThinkingLevelMap> = {
	"abliterated-model-large-flash": { off: "none", minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
	"abliterated-model-large": { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" },
	// Cannot turn reasoning off: "none" still reasons at low and only hides the trace.
	"abliterated-model-large-v2": { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
};

/** Turn a `GET /models` response into pi models. Entries that cannot serve chat are skipped. */
export function parseCatalog(body: unknown, baseUrl: string): AbliterationModel[] {
	const data = isRecord(body) ? body.data : undefined;
	if (!Array.isArray(data)) throw new Error("abliteration.ai model list has no `data` array");
	return data.flatMap((entry) => {
		const model = parseModel(entry, baseUrl);
		return model ? [model] : [];
	});
}

function parseModel(entry: unknown, baseUrl: string): AbliterationModel | undefined {
	if (!isRecord(entry)) return undefined;
	const id = text(entry.id);
	const contextWindow = count(entry.context_length);
	if (!id || !contextWindow) return undefined;
	if (isRecord(entry.access) && entry.access.available === false) return undefined;
	if (!list(entry.output_modalities).includes("text")) return undefined;

	const reasoning = list(entry.supported_features).includes("reasoning");
	const pricing = isRecord(entry.pricing) ? entry.pricing : {};
	return {
		id,
		name: text(entry.display_name) ?? text(entry.name) ?? id,
		api: "openai-completions",
		provider: PROVIDER_ID,
		baseUrl,
		reasoning,
		...(reasoning ? { thinkingLevelMap: LIMITED_LEVELS[id] ?? ALL_LEVELS } : {}),
		input: list(entry.input_modalities).includes("image") ? ["text", "image"] : ["text"],
		cost: {
			input: perMillion(pricing.prompt),
			output: perMillion(pricing.completion),
			cacheRead: perMillion(pricing.input_cache_read),
			cacheWrite: 0,
		},
		contextWindow,
		maxTokens: Math.min(count(entry.max_output_length) ?? contextWindow, contextWindow),
		compat: COMPAT,
	};
}

/** The API prices in USD per token as decimal strings; pi wants USD per million tokens. */
function perMillion(value: unknown): number {
	const perToken = Number(value);
	return Number.isFinite(perToken) && perToken > 0 ? Math.round(perToken * 1e12) / 1e6 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
