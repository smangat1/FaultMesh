# Contributing

Use Python 3.11 or newer, create a virtual environment, and install `.[dev]`. Changes should include
tests, preserve the closed declarative property language, and keep model claims separate from
executable evidence. Run `pytest`, `ruff check .`, and `mypy` before opening a pull request.
The complete local workflow, including optional real-model and Docker isolation checks, is in
[docs/testing.md](docs/testing.md).

Security-sensitive changes to sandboxing require an integration test and explicit documentation of
the trust boundary. Do not include model weights, proprietary benchmark data, secrets, or reports
from third-party repositories without permission.

