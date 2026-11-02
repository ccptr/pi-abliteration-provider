import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { refreshModels } from "../index.ts";
import {
	BASE_URL,
	COMPAT,
	DEFAULT_MAX_TOKENS,
	FALLBACK_MODELS,
	parseCatalog,
	parseModel,
	restoreModels,
	toStoredModels,
} from "../models.ts";

// Real GET /v1/models response, captured 2026-11-01.
const response = JSON.parse(readFileSync(new URL("./models-response.json", import.meta.url), "utf8"));

test("maps the live catalog", () => {
	const models = parseCatalog(response);
	assert.deepEqual(
		models.map((model) => model.id),
		["abliterated-model", "abliterated-model-large", "abliterated-model-large-v2", "abliterated-model-large-flash"],
	);
	const flash = models.find((model) => model.id === "abliterated-model-large-flash")!;
	assert.equal(flash.name, "Abliterated Large Flash");
	assert.deepEqual(flash.input, ["text", "image"]);
	assert.equal(flash.contextWindow, 1048576);
	assert.equal(flash.maxTokens, DEFAULT_MAX_TOKENS);
	assert.deepEqual(flash.cost, { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 });
	assert.equal(flash.reasoning, true);
	assert.deepEqual(flash.thinkingLevelMap, { off: "none", xhigh: "xhigh", max: "max" });
	assert.deepEqual(flash.compat, COMPAT);
});

test("the fallback list matches the live catalog", () => {
	assert.deepEqual(parseCatalog(response), FALLBACK_MODELS);
});

test("skips unavailable, non-text and malformed entries", () => {
	assert.equal(parseModel({ id: "x", access: { available: false } }), undefined);
	assert.equal(parseModel({ id: "x", output_modalities: ["image"] }), undefined);
	assert.equal(parseModel({ id: 3 } as never), undefined);
	assert.throws(() => parseCatalog({ error: "nope" }));
});

test("fills gaps with safe defaults", () => {
	const model = parseModel({ id: "new-model", supported_features: ["tools"], context_length: 32768 })!;
	assert.equal(model.name, "new-model");
	assert.deepEqual(model.input, ["text"]);
	assert.equal(model.reasoning, false);
	assert.equal(model.thinkingLevelMap, undefined);
	assert.equal(model.maxTokens, 32768);
	assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("stored models round-trip", () => {
	assert.deepEqual(restoreModels(toStoredModels(FALLBACK_MODELS, BASE_URL)), FALLBACK_MODELS);
	assert.equal(restoreModels([{ provider: "openai", id: "gpt" }]), undefined);
	assert.equal(restoreModels([]), undefined);
});

function context(overrides: Record<string, unknown> = {}) {
	const published: unknown[] = [];
	return {
		published,
		ctx: {
			allowNetwork: true,
			signal: new AbortController().signal,
			publish: async (publication: unknown) => {
				published.push(publication);
				return true;
			},
			credential: { type: "api_key", key: "test-key" },
			...overrides,
		} as never,
	};
}

test("refresh fetches, persists and returns the catalog", async (t) => {
	const calls: { url: string; auth: string | null }[] = [];
	t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
		calls.push({ url, auth: new Headers(init.headers).get("authorization") });
		return new Response(JSON.stringify(response), { status: 200 });
	});
	const { ctx, published } = context();
	const models = await refreshModels(ctx);
	assert.deepEqual(calls, [{ url: `${BASE_URL}/models`, auth: "Bearer test-key" }]);
	assert.equal(models.length, 4);
	assert.equal(published.length, 1);
	const persisted = (published[0] as { persist: { models: unknown[]; checkedAt: number } }).persist;
	assert.deepEqual(restoreModels(persisted.models), models);
});

test("refresh reuses a fresh stored catalog without a request", async (t) => {
	const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("{}"));
	const stored = { models: toStoredModels(FALLBACK_MODELS.slice(0, 1), BASE_URL), checkedAt: Date.now() };
	const models = await refreshModels(context({ stored }).ctx);
	assert.equal(fetchMock.mock.callCount(), 0);
	assert.deepEqual(models, FALLBACK_MODELS.slice(0, 1));
});

test("refresh keeps the previous list when offline, keyless or failing", async (t) => {
	const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("unauthorized", { status: 401 }));
	const previous = process.env.ABLITERATION_API_KEY;
	delete process.env.ABLITERATION_API_KEY;
	try {
		assert.deepEqual(await refreshModels(context({ allowNetwork: false }).ctx), FALLBACK_MODELS);
		assert.deepEqual(await refreshModels(context({ credential: undefined }).ctx), FALLBACK_MODELS);
		assert.equal(fetchMock.mock.callCount(), 0);
		const { ctx, published } = context();
		assert.deepEqual(await refreshModels(ctx), FALLBACK_MODELS);
		assert.equal(fetchMock.mock.callCount(), 1);
		assert.equal(published.length, 0);
	} finally {
		if (previous !== undefined) process.env.ABLITERATION_API_KEY = previous;
	}
});
