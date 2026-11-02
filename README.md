# pi-abliteration-provider

A [pi](https://pi.dev) provider for [abliteration.ai](https://abliteration.ai).

- Registers the `abliteration` provider, using pi's built-in OpenAI Chat Completions support.
- Fetches the live model list from `GET /v1/models`, including names, context sizes, image input, reasoning support and pricing. The list is saved and checked again at most every 6 hours. A built-in list covers the first run and offline use.
- Maps pi thinking levels to `reasoning_effort`. `off` sends `"none"`, because the models reason by default otherwise.

## Install

```bash
pi install /path/to/pi-abliteration-provider
```

## Authenticate

Either:

```text
/login abliteration
```

or set the key in the environment:

```bash
export ABLITERATION_API_KEY=ak_...
```

A key saved with `/login` takes priority over the environment variable.

## Use

```bash
pi --model abliteration/abliterated-model-large-flash
pi --model abliteration/abliterated-model:high
```

| Model | Context | Images | Price (in / out per 1M tokens) |
|---|---|---|---|
| `abliterated-model` | 262K | yes | $1 / $3 |
| `abliterated-model-large` | 1M | no | $3 / $5 |
| `abliterated-model-large-v2` | 1M | no | $3 / $5 |
| `abliterated-model-large-flash` | 1M | yes | $1 / $2 |

Prices are from the catalog as of 2026-11-01; pi uses whatever the API reports.

The default output limit is capped at 65,536 tokens. The API allows almost the full context window, which lets a single runaway reply use all of it. Raise it with a `modelOverrides` entry in `~/.pi/agent/models.json` if needed:

```json
{
  "providers": {
    "abliteration": {
      "modelOverrides": { "abliterated-model-large": { "maxTokens": 200000 } }
    }
  }
}
```

## API behavior this relies on

Checked against the live API on 2026-11-01:

| Behavior | Setting |
|---|---|
| Accepts the `developer` role | `supportsDeveloperRole: true` |
| Accepts `max_completion_tokens` | `maxTokensField: "max_completion_tokens"` |
| Streams usage with `stream_options.include_usage` | `supportsUsageInStreaming: true` |
| `reasoning_effort` accepts `none`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max` | `thinkingFormat: "openai"`, `thinkingLevelMap: { off: "none", xhigh: "xhigh", max: "max" }` |
| Streams reasoning in `delta.reasoning` | read by pi by default |
| Standard streamed tool calls | no setting needed |

## Develop

```bash
npm install
npm run check   # typecheck + tests
pi -e . --model abliteration/abliterated-model-large-flash
```

The tests use a saved `/v1/models` response (`test/models-response.json`) and make no network requests.
