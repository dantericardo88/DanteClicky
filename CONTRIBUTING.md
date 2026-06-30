# Contributing to DanteClicky

Thank you for your interest in contributing to DanteClicky! We welcome contributions, feedback, and discussions.

## Code of Conduct

This project adheres to the [Contributor Covenant](https://www.contributor-covenant.org/):

- Be respectful and inclusive
- Welcome diverse perspectives
- Give credit appropriately
- Report unacceptable behavior to richard.porras@realempanada.com

## Ways to Contribute

### 1. Report Bugs

- Check existing issues first
- Include: steps to reproduce, expected behavior, actual behavior
- Specify: Windows version, DanteClicky version, relevant logs

### 2. Suggest Features

- Start with a discussion or issue
- Describe the use case and expected behavior
- Explain why it's valuable

### 3. Submit Code

**Setup:**

```bash
# Clone the repository
git clone https://github.com/your-username/dante-clicky.git
cd dante-clicky

# Install dependencies
npm install

# Build Tauri project
cd dante-clicky-windows
cargo build
```

**Workflow:**

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes and test locally
4. Commit with clear messages: `git commit -m "feat: describe your change"`
5. Push to your fork: `git push origin feature/your-feature`
6. Open a Pull Request with:
   - Clear description of changes
   - Reference to related issue(s)
   - Test results (if applicable)

**Commit Message Format:**

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`

Scopes: `voice`, `screen`, `memory`, `computer-use`, `ui`, `security`, `core`

Example:
```
feat(memory): add consolidated facts limit of 50

- Implements Jaccard word-overlap dedup with >0.65 threshold
- Adds atomic eviction when fact count exceeds 50
- Includes unit tests for dedup and eviction logic
```

### 4. Improve Documentation

- Fix typos or clarify explanations
- Add examples or tutorials
- Contribute to the wiki

## Development Guidelines

### Architecture

- **Frontend**: Tauri 2.0 with React/TypeScript
- **Backend**: Rust (Tauri commands, native APIs)
- **Database**: SQLite with SQLCipher encryption
- **LLM Integration**: Vercel AI SDK (Claude, GPT, Grok)

### Testing

```bash
# Run tests
npm test

# Run Rust tests
cargo test

# Check types
npm run typecheck

# Lint code
npm run lint
```

### Security

- Never commit credentials or secrets
- Use environment variables for sensitive config
- Test encryption functionality in local builds only
- Report security issues privately (see SECURITY.md)

## Review Process

Pull Requests will be reviewed for:

- Code quality and consistency
- Test coverage
- Security implications
- Performance impact
- Documentation updates

Maintainers will provide constructive feedback. Be patient — reviews may take a few days.

## License

By contributing, you agree that your contributions are licensed under the MIT License (see LICENSE file).

## Questions?

- Open an issue for discussions
- Check existing documentation
- Email richard.porras@realempanada.com for private questions

Thank you for making DanteClicky better! 🚀
