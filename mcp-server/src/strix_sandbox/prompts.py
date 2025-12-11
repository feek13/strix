"""Prompt modules bridge for strix-sandbox-mcp.

This module provides access to specialized security knowledge modules
(Jinja templates) from the original strix project via a symlink.
"""

from pathlib import Path


# Points to the symlinked prompts directory
PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"


def get_available_prompt_modules() -> dict[str, list[str]]:
    """
    Get all available prompt modules, grouped by category.

    Returns:
        dict: {category: [module_names]}

    Example:
        {
            "vulnerabilities": ["sql_injection", "xss", "csrf", ...],
            "frameworks": ["fastapi", "nextjs"],
            "technologies": ["firebase_firestore", "supabase"],
            "protocols": ["graphql"],
            "coordination": ["root_agent"],
        }
    """
    if not PROMPTS_DIR.exists():
        return {}

    available_modules: dict[str, list[str]] = {}

    for category_dir in PROMPTS_DIR.iterdir():
        if category_dir.is_dir() and not category_dir.name.startswith("__"):
            modules = []
            for file_path in category_dir.glob("*.jinja"):
                modules.append(file_path.stem)
            if modules:
                available_modules[category_dir.name] = sorted(modules)

    return available_modules


def get_all_module_names() -> set[str]:
    """Get a set of all module names across all categories."""
    all_modules: set[str] = set()
    for modules in get_available_prompt_modules().values():
        all_modules.update(modules)
    return all_modules


def validate_module_names(module_names: list[str]) -> dict[str, list[str]]:
    """
    Validate that module names exist.

    Args:
        module_names: List of module names to validate

    Returns:
        dict: {"valid": [...], "invalid": [...]}
    """
    available = get_all_module_names()
    valid = [m for m in module_names if m in available]
    invalid = [m for m in module_names if m not in available]
    return {"valid": valid, "invalid": invalid}


def load_prompt_module(module_name: str) -> str | None:
    """
    Load a single prompt module's content.

    Args:
        module_name: Module name (e.g., "sql_injection")

    Returns:
        Module content string, or None if not found
    """
    if not PROMPTS_DIR.exists():
        return None

    available = get_available_prompt_modules()

    # Find module in its category
    for category, modules in available.items():
        if module_name in modules:
            module_path = PROMPTS_DIR / category / f"{module_name}.jinja"
            if module_path.exists():
                return module_path.read_text()

    return None


def load_prompt_modules(module_names: list[str]) -> dict[str, str]:
    """
    Batch load multiple prompt modules.

    Args:
        module_names: List of module names

    Returns:
        dict: {module_name: content}
    """
    loaded: dict[str, str] = {}
    for name in module_names:
        content = load_prompt_module(name)
        if content:
            loaded[name] = content
    return loaded


def generate_modules_description() -> str:
    """Generate a description of available modules for LLM prompts."""
    available = get_available_prompt_modules()
    if not available:
        return "No prompt modules available"

    all_names = sorted(get_all_module_names())
    modules_str = ", ".join(all_names)

    return (
        f"Available prompt modules (max 5): {modules_str}. "
        f"Example: sql_injection, xss for security testing."
    )
