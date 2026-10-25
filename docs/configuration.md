# Configuration

FaultMesh reads `.faultmesh.toml` from the repository root. CLI flags override file values.

```toml
[faultmesh]
model = "llama-server" # llama-server, llama-cli, or heuristic
llama_endpoint = "http://127.0.0.1:8080/v1/chat/completions"
llama_model = "local-model"
llama_cli = "llama-completion"
model_path = "/models/code-model.gguf"
max_context_characters = 12000
max_examples = 200
confirmation_runs = 3
timeout_seconds = 30
docker_image = "faultmesh-sandbox:0.1.0"
artifact_directory = ".faultmesh"
```

Build the sandbox image once with
`docker build --network=default -f Dockerfile.sandbox -t faultmesh-sandbox:0.1.0 .`. The heuristic
backend exists for deterministic tests and limited docstring-derived checks. It does
not substitute for model-quality evaluation. Docker images must be pulled or built in advance
because verification containers run with networking disabled.

`llama-completion` is the default executable for the `llama-cli` backend because it is llama.cpp's
single-shot completion binary. Recent `llama-cli` releases provide an interactive chat interface and
are not interchangeable with a batch subprocess adapter. Override `llama_cli` for older llama.cpp
distributions that use a different executable name. FaultMesh also passes `--single-turn` so a
chat-templated model cannot leave the batch subprocess waiting for another interactive turn.

