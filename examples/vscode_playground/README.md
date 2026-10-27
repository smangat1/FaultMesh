# FaultMesh VS Code Playground

A small, deterministic, self-contained Python project designed for testing and exploring FaultMesh's live spectate observer, AST indexing, and real-time diff tracking.

## Overview

The playground consists of 4 cleanly typed modules under `src/playground/` with real cross-file imports and calls:

```
examples/vscode_playground/
├── pyproject.toml
├── README.md
├── src/
│   └── playground/
│       ├── __init__.py      # Package metadata (__version__ = "0.1.0")
│       ├── config.py        # Constants (TAX_RATE, DEFAULT_CURRENCY, DISCOUNT_*) and get_tax_rate()
│       ├── formatting.py    # format_currency(), format_percentage() (imports config)
│       ├── pricing.py       # calculate_item_total(), calculate_subtotal(), apply_discount(),
│       │                    # calculate_tax(), calculate_total() (imports config)
│       └── invoice.py       # generate_invoice(), summarize_line_items() (imports formatting, pricing)
└── tests/
    └── test_pricing.py      # Deterministic pytest assertions (5 tests)
```

- **Zero dependencies**: Standard library only.
- **Deterministic**: No AI, no randomness, no background threads, no network calls.
- **Cross-file architecture**: `invoice.py` coordinates calls into `pricing.py` and `formatting.py`, which both depend on `config.py`.

---

## How to Open and Run

### 1. Open in VS Code
Open the playground folder in VS Code to edit files by hand:

```console
code examples/vscode_playground
```

### 2. Observe in FaultMesh

#### Option A: Desktop App
1. Launch the FaultMesh desktop app (`npm run electron` or packaged build).
2. Click **Choose project folder...** in the Live Spectate banner.
3. Select `examples/vscode_playground` (or a throwaway copy).
4. Click **Start watching**.

#### Option B: Terminal CLI Observer
In a dedicated terminal, run the spectate CLI directly:

```console
faultmesh spectate examples/vscode_playground
```

The CLI outputs streaming JSON newline records (`spectate-1.0` protocol) for every stable edit.

#### Option C: Automated Scripted Editor
To simulate an agent or developer performing predetermined real edits on disk:

```console
python scripts/spectate_demo_editor.py
```
*(By default, this prepares a throwaway copy in a temporary directory, prints the copy path, and prompts before executing.)*

---

## Manual Edit Scenarios

The following 6 scenarios demonstrate the spectrum of live observation events. Each scenario specifies the edit, the expected `spectate-1.0` records, and the expected user-facing behavior in the application.

> [!NOTE]
> **Ground Truth & Protocol Scope**:
> Today on `main`, FaultMesh uses the `spectate-1.0` schema (`docs/live-spectate.md`). It streams file changes, unified diff hunks, source snapshots, and symbol deltas. Dynamic map canvas rewiring via `relationship_update` is part of protocol 1.1 and belongs to PR #8. Expected UI updates are honestly labeled below as **Today on main** versus **Once PR #8 lands**.

---

### Scenario 1: Change a Constant (`modify_constant`)

* **File:** `src/playground/config.py`
* **Edit:** Change line 6:
  ```python
  # Before:
  TAX_RATE: float = 0.05

  # After:
  TAX_RATE: float = 0.07
  ```
* **Expected `spectate-1.0` records:**
  - `file_changed`: `path="src/playground/config.py"`, `kind="modified"`, `parse_ok=true`, `changed_line_ranges=[{"start_line": 6, "end_line": 6}]`, `affected_file_ids=["file:src/playground/config.py"]`.
  - `diff`: Unified hunk showing `-TAX_RATE: float = 0.05` and `+TAX_RATE: float = 0.07`.
  - `source`: Complete stable text of `config.py`.
  - `structure_update`: `parse_ok=true`, `kept_last_good_symbols=false`, `added_symbol_ids=[]`, `removed_symbol_ids=[]`.
* **What changes in the app:**
  - **Today on main:** Live Spectate banner shows `src/playground/config.py` modified with changed line range (line 6). Clicking the notification opens the Diff view displaying the tax rate edit and updated source code.
  - **Once PR #8 lands:** Affected node indicator spotlights `config.py` on the live graph canvas.

---

### Scenario 2: Rename a Function (`rename_function`)

* **File:** `src/playground/formatting.py`
* **Edit:** Rename `format_percentage` to `format_percent`:
  ```python
  # Before:
  def format_percentage(rate: float) -> str:

  # After:
  def format_percent(rate: float) -> str:
  ```
* **Expected `spectate-1.0` records:**
  - `file_changed`: `kind="modified"`, `parse_ok=true`, `affected_symbol_ids=["symbol:src/playground/formatting.py:format_percentage"]`.
  - `diff`: Hunk replacing the function signature.
  - `structure_update`:
    - `added_symbol_ids`: `["symbol:src/playground/formatting.py:format_percent"]`
    - `removed_symbol_ids`: `["symbol:src/playground/formatting.py:format_percentage"]`
    - `kept_last_good_symbols`: `false`
* **What changes in the app:**
  - **Today on main:** Spectate banner indicates modification to `formatting.py`. Diff viewer shows the renamed definition.
  - **Once PR #8 lands:** The `formatting.py` cluster on the live graph canvas removes the `format_percentage` node and renders the new `format_percent` node without repositioning unrelated clusters.

---

### Scenario 3: Add a Caller in Another File (`add_caller`)

* **File:** `src/playground/invoice.py`
* **Edit:** Import `format_percentage` from `playground.formatting` and call it inside `generate_invoice`:
  ```python
  # In imports:
  from playground.formatting import format_currency, format_percentage

  # In generate_invoice return dictionary:
  "tax_rate": format_percentage(0.05),
  ```
* **Expected `spectate-1.0` records:**
  - `file_changed`: `kind="modified"`, `parse_ok=true`, line ranges spanning import and function body.
  - `diff`: Hunks showing the added import line and dictionary entry.
  - `structure_update`: `modified_symbol_ids=["symbol:src/playground/invoice.py:generate_invoice"]`.
* **What changes in the app:**
  - **Today on main:** Diff panel shows the newly added import and call line.
  - **Once PR #8 lands:** A live call edge is drawn from `invoice.py::generate_invoice` to `formatting.py::format_percentage` via protocol 1.1 `relationship_update`.

---

### Scenario 4: Introduce and Fix a Syntax Error (`syntax_error` & `fix_syntax_error`)

* **File:** `src/playground/pricing.py`
* **Step A (Introduce error):** Omit the closing parameter parenthesis or colon:
  ```python
  # Corrupt line 8:
  def calculate_item_total(price: float, quantity: int -> float:
  ```
  - **Expected `spectate-1.0` records:**
    - `file_changed`: `kind="modified"`, `parse_ok=false`, `parse_error="invalid syntax at line 8"`.
    - `diff`: Hunk with the corrupted signature.
    - `structure_update`: `parse_ok=false`, `kept_last_good_symbols=true`, `parse_error="invalid syntax at line 8"`, `added_symbol_ids=[]`, `removed_symbol_ids=[]`.
  - **What changes in the app:**
    - **Today on main:** An amber/red parse-error banner appears with the exact message `invalid syntax at line 8`. Because `kept_last_good_symbols=true`, the existing symbol tree and map do **not** collapse.
    - **Once PR #8 lands:** An error badge decorates the `pricing.py` node on the graph canvas.

* **Step B (Fix error):** Restore valid syntax:
  ```python
  # Restored:
  def calculate_item_total(price: float, quantity: int) -> float:
  ```
  - **Expected `spectate-1.0` records:**
    - `file_changed`: `kind="modified"`, `parse_ok=true`, `parse_error=null`.
    - `structure_update`: `parse_ok=true`, `kept_last_good_symbols=false`, `parse_error=null`.
  - **What changes in the app:**
    - **Today on main:** Parse-error alert banner dismisses cleanly; healthy diff and source viewer reflect the fix.
    - **Once PR #8 lands:** Graph error badges dismiss.

---

### Scenario 5: Delete a Function (`delete_function`)

* **File:** `src/playground/pricing.py`
* **Edit:** Delete the `apply_discount` function definition (lines 20-25):
  ```python
  # Delete lines 20-25:
  def apply_discount(subtotal: float) -> float:
      ...
  ```
* **Expected `spectate-1.0` records:**
  - `file_changed`: `kind="modified"`, `parse_ok=true`.
  - `diff`: Deletion hunk removing the lines.
  - `structure_update`: `removed_symbol_ids=["symbol:src/playground/pricing.py:apply_discount"]`.
* **What changes in the app:**
  - **Today on main:** Diff panel shows red deletion hunk; source viewer displays the updated module without `apply_discount`.
  - **Once PR #8 lands:** Node `symbol:src/playground/pricing.py:apply_discount` is pruned from the `pricing.py` cluster on the graph canvas.

---

### Scenario 6: Atomic Temp-File Save (`atomic_save`)

* **File:** `src/playground/invoice.py`
* **Edit:** Simulate modern editor atomic saves (e.g., VS Code / Vim write-to-temp-then-rename):
  Write updated text to `.invoice.py.faultmesh-tmp`, then execute `os.replace(".invoice.py.faultmesh-tmp", "invoice.py")`.
* **Expected `spectate-1.0` records:**
  - Single stable `file_changed` (`kind="modified"`); the dot-prefixed temporary file is ignored by `IGNORED_PARTS` or coalesced into the final stable file stat.
  - No partial, truncated, or flickering intermediate event is ever emitted.
* **What changes in the app:**
  - **Today on main:** The desktop app receives a single clean update event without flicker.
  - **Once PR #8 lands:** Graph updates smoothly in a single render tick.
