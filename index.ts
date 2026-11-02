/**
 * abliteration.ai provider for pi.
 *
 * Models come from the API's model list and are saved by pi between runs. Requests use
 * pi's OpenAI Chat Completions implementation. Auth: `/login abliteration` or ABLITERATION_API_KEY.
 */

import { envApiKeyAuth, isModelType, type Provider, type RefreshModelsContext } from "@earendil-works/pi-ai";
// pi maps only a few pi-ai entry points for extensions; this is the one that exports API implementations.
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AbliterationModel, PROVIDER_ID, parseCatalog } from "./catalog.ts";

export const BASE_URL = "https://api.abliteration.ai/v1";
const REQUEST_TIMEOUT_MS = 15_000;

export default function (pi: ExtensionAPI) {
	pi.registerProvider(abliterationProvider());
}

export function abliterationProvider(): Provider<"openai-completions"> {
	const streams = openAICompletionsApi();
	let models: AbliterationModel[] = [];

	return {
		id: PROVIDER_ID,
		name: "abliteration.ai",
		baseUrl: BASE_URL,
		auth: { apiKey: envApiKeyAuth("abliteration.ai API key", ["ABLITERATION_API_KEY"]) },
		getModels: () => models,

		async refreshModels(context: RefreshModelsContext) {
			const stored = (context.stored?.models ?? []).filter(
				(model): model is AbliterationModel => model.provider === PROVIDER_ID && isModelType(model, "chat"),
			);
			if (stored.length > 0 && !(await context.publish({ update: () => (models = stored) }))) return;

			const apiKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
			if (!context.allowNetwork || !apiKey || context.signal.aborted) return;

			const baseUrl = (context.baseUrl ?? BASE_URL).replace(/\/+$/, "");
			const fetched = await fetchModels(baseUrl, apiKey, context.signal);
			if (context.signal.aborted) return;
			await context.publish({
				persist: { models: fetched, checkedAt: Date.now() },
				update: () => (models = fetched),
			});
		},

		stream: (model, context, options) => streams.stream(model, context, options),
		streamSimple: (model, context, options) => streams.streamSimple(model, context, options),
	};
}

async function fetchModels(baseUrl: string, apiKey: string, signal: AbortSignal) {
	const response = await fetch(`${baseUrl}/models`, {
		headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
		signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
	});
	if (!response.ok) throw new Error(`abliteration.ai model list request failed: HTTP ${response.status}`);
	return parseCatalog(await response.json(), baseUrl);
}
