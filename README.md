# pi-abliteration-provider

A [pi](https://pi.dev) provider for [abliteration.ai](https://abliteration.ai).

- Loads models from the API's model list (`GET /v1/models`): names, context sizes, image input, reasoning support and pricing. pi saves the list for offline use, `pi -p` and RPC mode.
- Sends requests through pi's built-in OpenAI Chat Completions support.
- Maps pi thinking levels to `reasoning_effort`. `off` sends `"none"`, because the models reason by default otherwise.

## Install

```bash
pi install /path/to/pi-abliteration-provider
```

## Authenticate

```text
/login abliteration
```

or set `ABLITERATION_API_KEY` before starting pi. A key saved with `/login` takes priority.

pi loads the model list after `/login`, when interactive pi starts, and when `/model` opens. Until it has loaded once, the provider has no models, so start interactive pi once before using `pi -p`.

## Use

```bash
pi --model abliteration/abliterated-model-large-flash
pi --model abliteration/abliterated-model:high
```

`pi --list-models abliteration` shows the models available to your key.

The default output limit is 65,536 tokens, because the API allows almost the whole context window per reply. Change it per model with `modelOverrides` in `~/.pi/agent/models.json`:

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
| Streams reasoning in `delta.reasoning` and tool calls in the standard format | no setting needed |

## Develop

```bash
npm install
npm run check   # typecheck + tests
pi -e . --model abliteration/abliterated-model-large-flash
```

The tests use a saved model list response (`test/models-response.json`) and make no network requests.
