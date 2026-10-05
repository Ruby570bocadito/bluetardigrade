# Native provider streaming in the AI analyst

The AI analyst now streams the provider's answer as it is generated.
The hub requests the completion with `stream: true` against the
OpenAI-compatible endpoint it is already configured with and forwards
every real content delta to the console as an `analyst:delta` socket
event the moment it arrives, so the panel renders the analysis while
the model writes it; no pacing, no artificial token replay and no
change to the `analyst:step/delta/done/error` socket contract (the
complete text still travels in `analyst:done` for history and repeat).
Providers that ignore `stream: true` keep working: a JSON answer is
forwarded as a single delta, exactly like before, which keeps local
servers (Ollama, LM Studio, vLLM) valid without extra configuration.
Three guards bound the request so a stuck provider can never hang the
hub: 60 s to the first byte, 30 s of quiet between chunks and 120 s
for the whole answer; a stream cut mid-way keeps the partial text on
screen next to a clear error and never invents a closing step.
