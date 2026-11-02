# pi-abliteration-provider

A [pi](https://pi.dev) provider for [abliteration.ai](https://abliteration.ai).

- Loads models from the API's model list (`GET /v1/models`): names, context sizes, image input, reasoning support and pricing. pi saves the list for offline use, `pi -p` and RPC mode.
- Sends requests through pi's built-in OpenAI Chat Completions support.
- Maps pi thinking levels to `reasoning_effort`, offering only the levels each model really has (see [Thinking levels](#thinking-levels)). `off` sends `"none"`, because the models reason by default otherwise.

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

Each model's output limit is the maximum the API reports, which is close to its whole context window. pi lowers it to the room left after the prompt. Reasoning counts toward the same limit. To set a lower limit, add `modelOverrides` to `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "abliteration": {
      "modelOverrides": { "abliterated-model-large": { "maxTokens": 65536 } }
    }
  }
}
```

pi re-reads the file when `/model` opens or pi restarts.

## Thinking levels

The API accepts every pi level name, but most models run some of them as another level. The provider offers only the distinct ones, following abliteration.ai's [thinking guide](https://docs.abliteration.ai/capabilities/thinking.md). If you ask for a level a model doesn't have, pi moves it up to the next one it does have.

| Model | Levels in pi |
|---|---|
| `abliterated-model` | off, minimal, low, medium, high, xhigh, max |
| `abliterated-model-large-flash` | off, low, high, max |
| `abliterated-model-large` | off, high, max |
| `abliterated-model-large-v2` | low, high, max (it cannot turn reasoning off) |

The model list does not report levels, so this table lives in `catalog.ts`. Models it doesn't name get every level.

## API behavior this relies on

Checked against the live API on 2026-11-01:

| Behavior | Setting |
|---|---|
| Accepts the `developer` role | `supportsDeveloperRole: true` |
| Accepts `max_completion_tokens` | `maxTokensField: "max_completion_tokens"` |
| Streams usage with `stream_options.include_usage` | `supportsUsageInStreaming: true` |
| Reasoning is set with `reasoning_effort`; `"none"` turns it off | `thinkingFormat: "openai"`, per-model `thinkingLevelMap` |
| Streams reasoning in `delta.reasoning` and tool calls in the standard format | no setting needed |

## Develop

```bash
npm install
npm run check   # typecheck + tests
pi -e . --model abliteration/abliterated-model-large-flash
```

The tests use a saved model list response (`test/models-response.json`) and make no network requests.
