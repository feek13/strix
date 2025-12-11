# Contributing to Strix

Thank you for your interest in contributing to Strix! This document provides guidelines for contributing to the project.

## Code of Conduct

Be respectful and constructive in all interactions. Focus on the code and ideas, not individuals.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/strix.git
   cd strix
   ```
3. Set up development environment:
   ```bash
   cd mcp-server
   pip install -e ".[dev]"
   ```

## Development Workflow

### Branches

- `main` - Stable release branch
- Feature branches - `feature/description`
- Bug fix branches - `fix/description`

### Making Changes

1. Create a new branch:
   ```bash
   git checkout -b feature/my-feature
   ```

2. Make your changes following the code style guidelines

3. Run tests:
   ```bash
   # MCP Server tests
   cd mcp-server
   pytest tests/ -m unit -v

   # Linting
   ruff check src/
   ruff format --check src/
   mypy src/
   ```

4. Commit with clear messages:
   ```bash
   git commit -m "feat: add new browser tool for form filling"
   ```

### Commit Message Format

Use conventional commits:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

## Pull Requests

1. Update documentation if needed
2. Add tests for new functionality
3. Ensure all tests pass
4. Update CHANGELOG.md for significant changes
5. Create PR with clear description

### PR Checklist

- [ ] Tests pass locally
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (for user-facing changes)
- [ ] No security vulnerabilities introduced

## Code Style

### Python (MCP Server)

- Python 3.11+
- Line length: 100 characters
- Use type hints on all functions
- Follow ruff/mypy configurations in `pyproject.toml`

### Skills (Markdown)

- SKILL.md files must have YAML frontmatter
- Include clear descriptions and examples
- Document all MCP tool dependencies

## Project Structure

### MCP Server (`mcp-server/`)

```
src/strix_sandbox/
├── server.py          # Main FastMCP server
├── tools/             # Tool implementations
│   ├── browser.py
│   ├── proxy.py
│   ├── terminal.py
│   ├── findings.py
│   └── ...
└── __init__.py
```

Adding a new tool:
1. Create implementation in `tools/`
2. Register in `server.py`
3. Add tests in `tests/`
4. Update API_REFERENCE.md

### Plugin (`plugin/`)

```
plugin/
├── skills/           # Skill definitions
│   └── skill-name/
│       └── SKILL.md
├── commands/         # Slash commands
└── agents/           # Agent definitions
```

Adding a new skill:
1. Create `skills/skill-name/SKILL.md`
2. Add YAML frontmatter with metadata
3. Document MCP tool usage
4. Update plugin.json skills list

## Testing

### MCP Server

```bash
# Unit tests
pytest tests/ -m unit -v

# Integration tests
pytest tests/ -m integration -v

# With coverage
pytest tests/ -m unit --cov=src/strix_sandbox
```

### Plugin Structure Validation

```bash
# Validate plugin.json
python -c "import json; json.load(open('plugin/.claude-plugin/plugin.json'))"

# Check skill structure
for skill in plugin/skills/*/; do
  test -f "$skill/SKILL.md" && echo "OK: $skill"
done
```

## Reporting Issues

### Bug Reports

Include:
- Steps to reproduce
- Expected vs actual behavior
- Python version and OS
- Relevant logs/errors

### Feature Requests

Include:
- Use case description
- Proposed solution
- Alternative approaches considered

## Security

If you discover a security vulnerability:
1. **Do not** open a public issue
2. Email security@strix.dev with details
3. Allow time for fix before disclosure

## Questions?

- Open a GitHub Discussion
- Check existing issues and discussions

Thank you for contributing!
