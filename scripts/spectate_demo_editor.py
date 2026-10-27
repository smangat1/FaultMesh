"""Perform predetermined editor-like code changes against a FaultMesh project copy.

Reworked with a clean PREPARE / RUN split for testing FaultMesh live spectate
against either the deterministic VS Code playground or legacy example fixtures.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass
class EditorLogEntry:
    timestamp: str
    action: str
    path: str
    scenario: str
    details: str = ""

    def to_dict(self) -> dict[str, str]:
        result = {
            "timestamp": self.timestamp,
            "action": self.action,
            "path": self.path,
            "scenario": self.scenario,
        }
        if self.details:
            result["details"] = self.details
        return result


class EditorLogger:
    def __init__(self, log_path: Path) -> None:
        self.log_path = log_path
        self.entries: list[EditorLogEntry] = []
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, action: str, path: Path, scenario: str, details: str = "") -> None:
        posix_path = path.as_posix()
        entry = EditorLogEntry(
            timestamp=datetime.now(UTC).isoformat(),
            action=action,
            path=posix_path,
            scenario=scenario,
            details=details,
        )
        self.entries.append(entry)
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry.to_dict()) + "\n")
        print(json.dumps({"action": action, "path": posix_path}), flush=True)


def pause(seconds: float) -> None:
    time.sleep(seconds)


def _verify_safe_path(target: Path, root: Path) -> Path:
    resolved_target = target.resolve()
    resolved_root = root.resolve()
    if not resolved_target.is_relative_to(resolved_root):
        raise ValueError(
            f"Refusing to operate on path outside root: {resolved_target} not in {resolved_root}"
        )
    return resolved_target


@dataclass
class Scenario:
    name: str
    description: str
    expected_events: str
    executor: Callable[[Path, EditorLogger, float], bool]


# ---------------------------------------------------------------------------
# Scenario Implementations with Dynamic Target Resolution
# ---------------------------------------------------------------------------


def _scenario_modify_constant(root: Path, logger: EditorLogger, delay: float) -> bool:
    """Modify a constant or boundary condition in-place."""
    scenario_name = "modify_constant"
    pg_target = root / "src" / "playground" / "config.py"
    buggy_target = root / "src" / "buggy_python_project" / "bounds.py"

    if pg_target.exists():
        target = _verify_safe_path(pg_target, root)
        text = target.read_text(encoding="utf-8")
        if "TAX_RATE: float = 0.05" in text:
            target.write_text(
                text.replace("TAX_RATE: float = 0.05", "TAX_RATE: float = 0.07"), encoding="utf-8"
            )
            logger.log(
                "in_place_write",
                target,
                scenario_name,
                "Changed TAX_RATE from 0.05 to 0.07",
            )
            pause(delay)
            return True

    if buggy_target.exists():
        target = _verify_safe_path(buggy_target, root)
        text = target.read_text(encoding="utf-8")
        if "if value <= maximum:" in text:
            target.write_text(
                text.replace("if value <= maximum:", "if value < maximum:"), encoding="utf-8"
            )
            logger.log(
                "in_place_write",
                target,
                scenario_name,
                "Changed <= to < boundary check",
            )
            pause(delay)
            return True

    logger.log(
        "skip",
        root,
        scenario_name,
        "Target file or symbol missing; skipped destructive edit",
    )
    return False


def _scenario_atomic_save(root: Path, logger: EditorLogger, delay: float) -> bool:
    """Perform atomic save via temporary file and replace."""
    scenario_name = "atomic_save"
    pg_target = root / "src" / "playground" / "invoice.py"
    buggy_target = root / "src" / "buggy_python_project" / "bounds.py"

    if pg_target.exists():
        target = _verify_safe_path(pg_target, root)
        text = target.read_text(encoding="utf-8")
        replacement = text + "\n# Atomic-save demonstration note.\n"
        temp_file = _verify_safe_path(target.with_name(".invoice.py.faultmesh-tmp"), root)
        temp_file.write_text(replacement, encoding="utf-8")
        os.replace(temp_file, target)
        logger.log(
            "atomic_temp_rename",
            target,
            scenario_name,
            "Atomic write via .invoice.py.faultmesh-tmp",
        )
        pause(delay)
        return True

    if buggy_target.exists():
        target = _verify_safe_path(buggy_target, root)
        text = target.read_text(encoding="utf-8")
        marker = "# Seeded bug: equality must not be incremented."
        if marker in text:
            replacement = text.replace(marker, "# Atomic-save demonstration.")
        else:
            replacement = text + "\n# Atomic-save demonstration.\n"
        temp_file = _verify_safe_path(target.with_name(".bounds.py.faultmesh-tmp"), root)
        temp_file.write_text(replacement, encoding="utf-8")
        os.replace(temp_file, target)
        logger.log(
            "atomic_temp_rename",
            target,
            scenario_name,
            "Atomic write via .bounds.py.faultmesh-tmp",
        )
        pause(delay)
        return True

    logger.log("skip", root, scenario_name, "Target file missing; skipped atomic save")
    return False


def _scenario_add_caller(root: Path, logger: EditorLogger, delay: float) -> bool:
    """Add a cross-file caller or new function."""
    scenario_name = "add_caller"
    pg_target = root / "src" / "playground" / "invoice.py"
    buggy_target = root / "src" / "buggy_python_project" / "bounds.py"

    if pg_target.exists():
        target = _verify_safe_path(pg_target, root)
        text = target.read_text(encoding="utf-8")
        if (
            "from playground.formatting import format_currency" in text
            and "format_percentage" not in text
        ):
            updated = text.replace(
                "from playground.formatting import format_currency",
                "from playground.formatting import format_currency, format_percentage",
            )
            needle = '"subtotal": format_currency(subtotal),'
            addition = (
                '"tax_rate": format_percentage(0.05),\n'
                '        "subtotal": format_currency(subtotal),'
            )
            if needle in updated:
                updated = updated.replace(needle, addition)
            target.write_text(updated, encoding="utf-8")
            logger.log(
                "add_caller",
                target,
                scenario_name,
                "Added cross-file call to format_percentage",
            )
            pause(delay)
            return True

    if buggy_target.exists():
        target = _verify_safe_path(buggy_target, root)
        added = "\n\ndef live_demo_added(value: int) -> int:\n    return value * 2\n"
        text = target.read_text(encoding="utf-8")
        if "live_demo_added" not in text:
            target.write_text(text + added, encoding="utf-8")
            logger.log(
                "add_function",
                target,
                scenario_name,
                "Added helper function live_demo_added",
            )
            pause(delay)
            return True

    logger.log("skip", root, scenario_name, "Target file missing; skipped adding caller")
    return False


def _scenario_rename_function(root: Path, logger: EditorLogger, delay: float) -> bool:
    """Rename a function definition."""
    scenario_name = "rename_function"
    pg_target = root / "src" / "playground" / "formatting.py"
    buggy_target = root / "src" / "buggy_python_project" / "bounds.py"

    if pg_target.exists():
        target = _verify_safe_path(pg_target, root)
        text = target.read_text(encoding="utf-8")
        if "def format_percentage(rate: float) -> str:" in text:
            target.write_text(
                text.replace(
                    "def format_percentage(rate: float) -> str:",
                    "def format_percent(rate: float) -> str:",
                ),
                encoding="utf-8",
            )
            logger.log(
                "rename_function",
                target,
                scenario_name,
                "Renamed format_percentage -> format_percent",
            )
            pause(delay)
            return True

    if buggy_target.exists():
        target = _verify_safe_path(buggy_target, root)
        text = target.read_text(encoding="utf-8")
        if "def bounded_increment(value: int, maximum: int) -> int:" in text:
            target.write_text(
                text.replace(
                    "def bounded_increment(value: int, maximum: int) -> int:",
                    "def increment_bounded(value: int, maximum: int) -> int:",
                ),
                encoding="utf-8",
            )
            logger.log(
                "rename_function",
                target,
                scenario_name,
                "Renamed bounded_increment -> increment_bounded",
            )
            pause(delay)
            return True

    logger.log("skip", root, scenario_name, "Target function missing; skipped rename")
    return False


def _scenario_introduce_syntax_error(root: Path, logger: EditorLogger, delay: float) -> bool:
    """Introduce a syntax error to test last-good symbol retention."""
    scenario_name = "introduce_syntax_error"
    pg_target = root / "src" / "playground" / "pricing.py"
    buggy_target = root / "src" / "buggy_python_project" / "bounds.py"

    if pg_target.exists():
        target = _verify_safe_path(pg_target, root)
        text = target.read_text(encoding="utf-8")
        valid_sig = "def calculate_item_total(price: float, quantity: int) -> float:"
        broken_sig = "def calculate_item_total(price: float, quantity: int -> float:"
        if valid_sig in text:
            target.write_text(text.replace(valid_sig, broken_sig), encoding="utf-8")
            logger.log(
                "introduce_syntax_error",
                target,
                scenario_name,
                "Introduced missing colon syntax error",
            )
            pause(delay)
            return True

    if buggy_target.exists():
        target = _verify_safe_path(buggy_target, root)
        text = target.read_text(encoding="utf-8")
        candidates = [
            "def bounded_increment(value: int, maximum: int) -> int:",
            "def increment_bounded(value: int, maximum: int) -> int:",
        ]
        for sig in candidates:
            if sig in text:
                broken = sig.replace(") -> int:", " -> int:")
                target.write_text(text.replace(sig, broken), encoding="utf-8")
                logger.log(
                    "introduce_syntax_error",
                    target,
                    scenario_name,
                    "Introduced missing colon syntax error",
                )
                pause(delay)
                return True

    logger.log(
        "skip",
        root,
        scenario_name,
        "Target function missing; skipped syntax error introduction",
    )
    return False


def _scenario_fix_syntax_error(root: Path, logger: EditorLogger, delay: float) -> bool:
    """Restore valid syntax to test parse recovery."""
    scenario_name = "fix_syntax_error"
    pg_target = root / "src" / "playground" / "pricing.py"
    buggy_target = root / "src" / "buggy_python_project" / "bounds.py"

    if pg_target.exists():
        target = _verify_safe_path(pg_target, root)
        text = target.read_text(encoding="utf-8")
        valid_sig = "def calculate_item_total(price: float, quantity: int) -> float:"
        broken_sig = "def calculate_item_total(price: float, quantity: int -> float:"
        if broken_sig in text:
            target.write_text(text.replace(broken_sig, valid_sig), encoding="utf-8")
            logger.log(
                "fix_syntax_error",
                target,
                scenario_name,
                "Restored valid function syntax",
            )
            pause(delay)
            return True

    if buggy_target.exists():
        target = _verify_safe_path(buggy_target, root)
        text = target.read_text(encoding="utf-8")
        candidates = [
            (
                "def bounded_increment(value: int, maximum: int -> int:",
                "def bounded_increment(value: int, maximum: int) -> int:",
            ),
            (
                "def increment_bounded(value: int, maximum: int -> int:",
                "def increment_bounded(value: int, maximum: int) -> int:",
            ),
        ]
        for broken, fixed in candidates:
            if broken in text:
                target.write_text(text.replace(broken, fixed), encoding="utf-8")
                logger.log(
                    "fix_syntax_error",
                    target,
                    scenario_name,
                    "Restored valid function syntax",
                )
                pause(delay)
                return True

    logger.log("skip", root, scenario_name, "No broken syntax found to fix")
    return False


def _scenario_create_file(root: Path, logger: EditorLogger, delay: float) -> bool:
    """Create a new Python file on disk."""
    scenario_name = "create_file"
    pg_dir = root / "src" / "playground"
    buggy_dir = root / "src" / "buggy_python_project"

    if pg_dir.exists():
        target = _verify_safe_path(pg_dir / "discount.py", root)
        content = (
            '"""Seasonal discount calculation module."""\n\n'
            "from __future__ import annotations\n\n\n"
            "def seasonal_discount(subtotal: float) -> float:\n"
            '    """Return seasonal discount amount."""\n'
            "    return subtotal * 0.15 if subtotal > 150.0 else 0.0\n"
        )
        target.write_text(content, encoding="utf-8")
        logger.log("create_file", target, scenario_name, "Created seasonal discount module")
        pause(delay)
        return True

    if buggy_dir.exists():
        target = _verify_safe_path(buggy_dir / "live_created.py", root)
        content = "def created_live() -> str:\n    return 'stable'\n"
        target.write_text(content, encoding="utf-8")
        logger.log("create_file", target, scenario_name, "Created live_created.py module")
        pause(delay)
        return True

    logger.log(
        "skip",
        root,
        scenario_name,
        "Target package directory missing; skipped file creation",
    )
    return False


def _scenario_delete_function(root: Path, logger: EditorLogger, delay: float) -> bool:
    """Delete a function definition from a module."""
    scenario_name = "delete_function"
    pg_target = root / "src" / "playground" / "pricing.py"
    buggy_target = root / "src" / "buggy_python_project" / "bounds.py"

    if pg_target.exists():
        target = _verify_safe_path(pg_target, root)
        text = target.read_text(encoding="utf-8")
        fn_header = "def apply_discount(subtotal: float) -> float:"
        if fn_header in text:
            lines = text.splitlines(keepends=True)
            filtered = [
                line
                for line in lines
                if not line.startswith("def apply_discount")
                and not line.strip().startswith('"""Apply discount if subtotal')
                and not line.strip().startswith("if subtotal >= DISCOUNT_THRESHOLD:")
                and not line.strip().startswith(
                    "return round(subtotal * (1.0 - DISCOUNT_PERCENTAGE), 2)"
                )
                and not (line.strip() == "return subtotal" and "def calculate_tax" not in line)
            ]
            target.write_text("".join(filtered), encoding="utf-8")
            logger.log("delete_function", target, scenario_name, "Deleted apply_discount function")
            pause(delay)
            return True

    if buggy_target.exists():
        target = _verify_safe_path(buggy_target, root)
        text = target.read_text(encoding="utf-8")
        added = "\n\ndef live_demo_added(value: int) -> int:\n    return value * 2\n"
        if added in text:
            target.write_text(text.replace(added, ""), encoding="utf-8")
            logger.log("delete_function", target, scenario_name, "Removed live_demo_added function")
            pause(delay)
            return True

    logger.log("skip", root, scenario_name, "Target function missing; skipped deletion")
    return False


def _scenario_delete_file(root: Path, logger: EditorLogger, delay: float) -> bool:
    """Delete a temporary module from disk."""
    scenario_name = "delete_file"
    pg_target = root / "src" / "playground" / "discount.py"
    buggy_target = root / "src" / "buggy_python_project" / "live_created.py"

    if pg_target.exists():
        target = _verify_safe_path(pg_target, root)
        target.unlink()
        logger.log("delete_file", target, scenario_name, "Deleted seasonal discount module")
        pause(delay)
        return True

    if buggy_target.exists():
        target = _verify_safe_path(buggy_target, root)
        target.unlink()
        logger.log("delete_file", target, scenario_name, "Deleted live_created.py module")
        pause(delay)
        return True

    logger.log("skip", root, scenario_name, "Target file missing; skipped file deletion")
    return False


ALL_SCENARIOS: list[Scenario] = [
    Scenario(
        name="modify_constant",
        description="In-place constant modification in config.py (or bounds.py check)",
        expected_events="file_changed (modified), diff, source, structure_update",
        executor=_scenario_modify_constant,
    ),
    Scenario(
        name="atomic_save",
        description="Atomic temp-file save and replace in invoice.py",
        expected_events="file_changed (modified), diff, source, structure_update",
        executor=_scenario_atomic_save,
    ),
    Scenario(
        name="add_caller",
        description="Add cross-file call to format_percentage in invoice.py",
        expected_events="file_changed (modified), diff, source, structure_update",
        executor=_scenario_add_caller,
    ),
    Scenario(
        name="rename_function",
        description="Rename format_percentage to format_percent in formatting.py",
        expected_events=(
            "file_changed (modified), diff, source, structure_update "
            "(added_symbol_ids, removed_symbol_ids)"
        ),
        executor=_scenario_rename_function,
    ),
    Scenario(
        name="introduce_syntax_error",
        description="Introduce missing parameter colon syntax error in pricing.py",
        expected_events=(
            "file_changed (modified, parse_ok=false), diff, structure_update "
            "(parse_ok=false, kept_last_good_symbols=true)"
        ),
        executor=_scenario_introduce_syntax_error,
    ),
    Scenario(
        name="fix_syntax_error",
        description="Restore valid syntax in pricing.py to verify recovery",
        expected_events=(
            "file_changed (modified, parse_ok=true), diff, structure_update "
            "(parse_ok=true, kept_last_good_symbols=false)"
        ),
        executor=_scenario_fix_syntax_error,
    ),
    Scenario(
        name="create_file",
        description="Create new discount.py module on disk",
        expected_events="file_changed (created), diff, source, structure_update (added_symbol_ids)",
        executor=_scenario_create_file,
    ),
    Scenario(
        name="delete_function",
        description="Remove unused function definition from pricing.py",
        expected_events="file_changed (modified), diff, structure_update (removed_symbol_ids)",
        executor=_scenario_delete_function,
    ),
    Scenario(
        name="delete_file",
        description="Delete temporary discount.py module",
        expected_events="file_changed (deleted), diff",
        executor=_scenario_delete_file,
    ),
]

# Map aliases from legacy script
SCENARIO_ALIASES: dict[str, str] = {
    "in_place_write": "modify_constant",
    "atomic_temp_rename": "atomic_save",
    "add_function": "add_caller",
}


def _find_repo_root() -> Path:
    current = Path(__file__).resolve().parent
    for candidate in [current, *current.parents]:
        if (candidate / "pyproject.toml").exists() or (candidate / ".git").exists():
            return candidate
    return Path.cwd()


def _resolve_default_playground(repo_root: Path) -> Path:
    playground = repo_root / "examples" / "vscode_playground"
    if playground.exists():
        return playground
    legacy = repo_root / "examples" / "buggy_python_project"
    if legacy.exists():
        return legacy
    return repo_root


def _print_banner(copy_path: Path, scenarios: list[Scenario], is_copy: bool) -> None:
    print("=" * 72)
    print("FaultMesh Spectate Playground Editor")
    print("=" * 72)
    if is_copy:
        print(f"Project copy prepared at (throwaway):\n  {copy_path}")
    else:
        print(f"Direct in-place target (caution):\n  {copy_path}")
    print("\nPlanned scenarios:")
    for idx, sc in enumerate(scenarios, start=1):
        print(f"  {idx}. {sc.name:<24} - {sc.description}")
    print("=" * 72)


def _print_exit_summary(copy_path: Path, log_path: Path, scenarios: list[Scenario]) -> None:
    print("\n" + "=" * 72)
    print("Execution complete!")
    print(f"  Target project path: {copy_path}")
    print(f"  JSONL audit log:     {log_path}")
    print("\nExpected spectate-1.0 event sequence across executed scenarios:")
    for idx, sc in enumerate(scenarios, start=1):
        print(f"  {idx}. {sc.name:<22} -> {sc.expected_events}")
    print("=" * 72)


def main() -> None:
    repo_root = _find_repo_root()
    default_target = _resolve_default_playground(repo_root)

    parser = argparse.ArgumentParser(
        description="Perform predetermined editor-like changes against a FaultMesh copy."
    )
    parser.add_argument(
        "root",
        nargs="?",
        type=Path,
        default=None,
        help="Target project directory to copy and edit (default: examples/vscode_playground)",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Run scenarios immediately without prompting for Enter",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Edit target directly on disk without copying to a temp directory (destructive)",
    )
    parser.add_argument(
        "--scenario",
        type=str,
        default=None,
        help="Run a single scenario by name (use --list to see all available names)",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all available scenario names and descriptions, then exit",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.60,
        help="Delay in seconds between edits (default: 0.60s, above 250ms debounce)",
    )
    parser.add_argument(
        "--log",
        type=Path,
        default=None,
        help="Custom path for the JSONL audit log",
    )

    args = parser.parse_args()

    if args.list:
        print("Available FaultMesh spectate scenarios:")
        for sc in ALL_SCENARIOS:
            print(f"  {sc.name:<24} {sc.description}")
        sys.exit(0)

    # Determine scenario(s) to execute
    if args.scenario:
        resolved_name = SCENARIO_ALIASES.get(args.scenario, args.scenario)
        matched = [sc for sc in ALL_SCENARIOS if sc.name == resolved_name]
        if not matched:
            print(
                f"Error: Unknown scenario '{args.scenario}'. Use --list to see valid names.",
                file=sys.stderr,
            )
            sys.exit(1)
        scenarios_to_run = matched
    else:
        scenarios_to_run = ALL_SCENARIOS

    # Determine target source root
    source_root = (args.root or default_target).resolve()
    if not source_root.exists() or not source_root.is_dir():
        print(
            f"Error: Target root does not exist or is not a directory: {source_root}",
            file=sys.stderr,
        )
        sys.exit(1)

    # PREPARE PHASE
    if args.in_place:
        target_root = source_root
        is_copy = False
    else:
        temp_dir = tempfile.mkdtemp(prefix="faultmesh-playground-")
        # Copy source root into temp dir
        shutil.copytree(
            source_root,
            temp_dir,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns(".git", "__pycache__", ".venv", ".faultmesh", "*.pyc"),
        )
        target_root = Path(temp_dir).resolve()
        is_copy = True

    log_path = (args.log or (target_root / ".faultmesh-editor-log.jsonl")).resolve()
    logger = EditorLogger(log_path)

    _print_banner(target_root, scenarios_to_run, is_copy)

    # Interactive wait before execution
    if not args.yes:
        try:
            input("\nPress [Enter] to begin running planned scenario(s) (Ctrl+C to abort)... ")
        except (KeyboardInterrupt, EOFError):
            print("\nAborted before running any scenario.")
            sys.exit(130)

    # RUN PHASE
    for sc in scenarios_to_run:
        sc.executor(target_root, logger, args.delay)

    _print_exit_summary(target_root, log_path, scenarios_to_run)


if __name__ == "__main__":
    main()
