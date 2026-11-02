import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	clampThinkingLevel,
	getSupportedThinkingLevels,
	type ModelsPublication,
	type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { MAX_OUTPUT_TOKENS, PROVIDER_ID, parseCatalog } from "../catalog.ts";
import { abliterationProvider, BASE_URL } from "../index.ts";

// A real GET /v1/models response.
const response = JSON.parse(readFileSync(new URL("./models-response.json", import.meta.url), "utf8"));

test("maps every field the API reports", () => {
	const models = parseCatalog(response, BASE_URL);
	assert.equal(models.length, response.data.length);
	const flash = models.find((model) => model.id === "abliterated-model-large-flash");
	assert.deepEqual(flash, {
		id: "abliterated-model-large-flash",
		name: "Abliterated Large Flash",
		api: "openai-completions",
		provider: PROVIDER_ID,
		baseUrl: BASE_URL,
		reasoning: true,
		thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
		input: ["text", "image"],
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 1048576,
		maxTokens: MAX_OUTPUT_TOKENS,
		compat: {
			supportsDeveloperRole: true,
			supportsReasoningEffort: true,
			supportsUsageInStreaming: true,
			maxTokensField: "max_completion_tokens",
			thinkingFormat: "openai",
		},
	});
});

test("offers only the thinking levels each model really has", () => {
	const levels = Object.fromEntries(
		parseCatalog(response, BASE_URL).map((model) => [model.id, getSupportedThinkingLevels(model)]),
	);
	assert.deepEqual(levels, {
		"abliterated-model": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
		"abliterated-model-large": ["off", "high", "max"],
		"abliterated-model-large-v2": ["low", "high", "max"],
		"abliterated-model-large-flash": ["off", "low", "high", "max"],
	});
	const flash = parseCatalog(response, BASE_URL).find((model) => model.id === "abliterated-model-large-flash")!;
	assert.equal(clampThinkingLevel(flash, "minimal"), "low");
	assert.equal(clampThinkingLevel(flash, "medium"), "high");
});

test("models the guide does not cover keep every level", () => {
	const [model] = parseCatalog(
		{ data: [{ id: "new-model", context_length: 8192, output_modalities: ["text"], supported_features: ["reasoning"] }] },
		BASE_URL,
	);
	assert.deepEqual(getSupportedThinkingLevels(model), ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
});

test("skips entries that cannot serve chat", () => {
	const base = { context_length: 8192, output_modalities: ["text"] };
	const models = parseCatalog(
		{
			data: [
				{ ...base, id: "ok" },
				{ ...base, id: "locked", access: { available: false } },
				{ ...base, id: "image-only", output_modalities: ["image"] },
				{ ...base, id: "no-context", context_length: undefined },
				{ ...base, id: "" },
				null,
			],
		},
		BASE_URL,
	);
	assert.deepEqual(
		models.map((model) => model.id),
		["ok"],
	);
	assert.equal(models[0].reasoning, false);
	assert.equal(models[0].thinkingLevelMap, undefined);
	assert.deepEqual(models[0].input, ["text"]);
	assert.equal(models[0].maxTokens, 8192);
	assert.throws(() => parseCatalog({ error: "nope" }, BASE_URL));
});

function refreshContext(overrides: Partial<RefreshModelsContext> = {}) {
	const published: ModelsPublication[] = [];
	const context: RefreshModelsContext = {
		allowNetwork: true,
		signal: new AbortController().signal,
		credential: { type: "api_key", key: "test-key" },
		publish: async (publication) => {
			published.push(publication);
			publication.update?.();
			return true;
		},
		...overrides,
	};
	return { context, published };
}

test("starts empty, then fetches and saves the catalog", async (t) => {
	const requests: { url: string; auth: string | null }[] = [];
	t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
		requests.push({ url, auth: new Headers(init.headers).get("authorization") });
		return Response.json(response);
	});
	const provider = abliterationProvider();
	assert.deepEqual(provider.getModels(), []);

	const { context, published } = refreshContext();
	await provider.refreshModels!(context);

	assert.deepEqual(requests, [{ url: `${BASE_URL}/models`, auth: "Bearer test-key" }]);
	assert.deepEqual(provider.getModels(), parseCatalog(response, BASE_URL));
	assert.deepEqual(published.at(-1)?.persist?.models, provider.getModels());
});

test("restores the saved catalog without a request when offline or without a key", async (t) => {
	const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json(response));
	const saved = parseCatalog(response, BASE_URL).slice(0, 1);

	for (const overrides of [{ allowNetwork: false }, { credential: undefined }]) {
		const provider = abliterationProvider();
		await provider.refreshModels!(refreshContext({ ...overrides, stored: { models: saved } }).context);
		assert.deepEqual(provider.getModels(), saved);
	}
	assert.equal(fetchMock.mock.callCount(), 0);
});

test("a failed request reports the error and keeps the saved catalog", async (t) => {
	t.mock.method(globalThis, "fetch", async () => new Response("unauthorized", { status: 401 }));
	const saved = parseCatalog(response, BASE_URL).slice(0, 1);
	const provider = abliterationProvider();
	const { context, published } = refreshContext({ stored: { models: saved } });

	await assert.rejects(provider.refreshModels!(context), /HTTP 401/);
	assert.deepEqual(provider.getModels(), saved);
	assert.equal(published.some((publication) => publication.persist), false);
});
