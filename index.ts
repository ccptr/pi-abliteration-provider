/**
 * abliteration.ai provider for pi.
 *
 * Requests go through pi's built-in OpenAI Chat Completions implementation; this
 * extension supplies the endpoint, the verified compat flags and a live model catalog.
 *
 * Auth: `/login abliteration`, or set ABLITERATION_API_KEY.
 */

import { execSync } from "node:child_process";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import {
	API_KEY_ENV,
	BASE_URL,
	FALLBACK_MODELS,
	PROVIDER_ID,
	parseCatalog,
	restoreModels,
	toStoredModels,
} from "./models.ts";

type RefreshContext = Parameters<NonNullable<ProviderConfig["refreshModels"]>>[0];

/** How long a fetched catalog is reused before pi's next refresh asks the API again. */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export default function abliterationProvider(pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		name: "abliteration.ai",
		baseUrl: BASE_URL,
		apiKey: `$${API_KEY_ENV}`,
		api: "openai-completions",
		models: FALLBACK_MODELS,
		refreshModels,
	});
}

export async function refreshModels(context: RefreshContext) {
	const previous = restoreModels(context.stored?.models) ?? FALLBACK_MODELS;
	if (!context.allowNetwork || context.signal.aborted) return previous;

	const checkedAt = context.stored?.checkedAt;
	const fresh = checkedAt !== undefined && Date.now() - checkedAt < REFRESH_INTERVAL_MS;
	if (fresh && !context.force && context.stored?.models.length) return previous;

	const apiKey = resolveApiKey(context);
	if (!apiKey) return previous;

	const baseUrl = (context.baseUrl ?? BASE_URL).replace(/\/+$/, "");
	let models;
	try {
		models = await fetchCatalog(baseUrl, apiKey, context.signal);
	} catch {
		// Offline, rate limited or a bad key: keep the last known list. A bad key still
		// surfaces on the next chat request, with the API's own error message.
		return previous;
	}
	if (models.length === 0 || context.signal.aborted) return previous;

	await context.publish({ persist: { models: toStoredModels(models, baseUrl), checkedAt: Date.now() } });
	return models;
}

async function fetchCatalog(baseUrl: string, apiKey: string, signal: AbortSignal) {
	const response = await fetch(`${baseUrl}/models`, {
		headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
		signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
	});
	if (!response.ok) throw new Error(`abliteration.ai /models returned ${response.status}`);
	return parseCatalog(await response.json());
}

/**
 * The key for catalog requests: a `/login` credential first, then the environment.
 * Stored keys may use the same `$VAR` and `!command` forms pi accepts in auth.json.
 */
function resolveApiKey(context: RefreshContext): string | undefined {
	const credential = context.credential;
	const stored = credential?.type === "api_key" ? credential.key?.trim() : undefined;
	if (stored) {
		if (stored.startsWith("!")) {
			try {
				return execSync(stored.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim() || undefined;
			} catch {
				return undefined;
			}
		}
		const envRef = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(stored);
		if (envRef) return process.env[envRef[1]]?.trim() || undefined;
		return stored;
	}
	return process.env[API_KEY_ENV]?.trim() || undefined;
}
