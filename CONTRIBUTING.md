# Contributing to Omni-Bot

Thank you for your interest in contributing to Omni-Bot! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)

## Code of Conduct

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

**Positive behaviors:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Accepting constructive criticism gracefully
- Focusing on what's best for the community
- Showing empathy towards others

**Unacceptable behaviors:**
- Harassment, trolling, or insulting comments
- Publishing others' private information
- Any conduct which could reasonably be considered inappropriate

## Getting Started

### Prerequisites

- Node.js >= 22.0.0
- Claude Code CLI installed and authenticated
- Git
- Familiarity with TypeScript, Express, and WebSockets

### Setup Development Environment

1. **Fork the repository** on GitHub

2. **Clone your fork:**
   ```bash
   git clone https://github.com/yourusername/omni-bot.git
   cd omni-bot
   ```

3. **Add upstream remote:**
   ```bash
   git remote add upstream https://github.com/originalowner/omni-bot.git
   ```

4. **Install dependencies:**
   ```bash
   npm install
   ```

5. **Create `.env` file:**
   ```bash
   cp .env.example .env
   # Edit .env with your local configuration
   ```

6. **Start development server:**
   ```bash
   npm run dev
   ```

## How to Contribute

### Types of Contributions

We welcome many types of contributions:

- **Bug fixes**: Fix identified issues
- **Features**: Implement new functionality
- **Documentation**: Improve or add documentation
- **Tests**: Add or improve test coverage
- **Refactoring**: Improve code quality
- **Performance**: Optimize existing code
- **Security**: Address security concerns

### Areas Needing Help

Check the GitHub Issues page for:
- Issues labeled `good first issue` (great for beginners)
- Issues labeled `help wanted` (community input needed)
- Issues labeled `bug` (confirmed bugs)
- Issues labeled `enhancement` (feature requests)

## Development Workflow

### Branch Strategy

- `main`: Production-ready code
- `develop`: Integration branch for features
- `feat/*`: New features
- `fix/*`: Bug fixes
- `docs/*`: Documentation updates
- `refactor/*`: Code refactoring
- `test/*`: Test additions/improvements

### Creating a Feature Branch

```bash
git checkout develop
git pull upstream develop
git checkout -b feat/your-feature-name
```

### Making Changes

1. **Write code** following our [coding standards](#coding-standards)
2. **Test your changes** locally
3. **Update documentation** if needed
4. **Write or update tests** for new features/fixes
5. **Run linting and formatting:**
   ```bash
   npm run lint:fix
   npm run format
   ```

### Committing Changes

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, no logic change)
- `refactor`: Code refactoring
- `test`: Adding/updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements

**Examples:**

```bash
feat(coordinator): add support for session forking

fix(websocket): handle disconnection gracefully

docs(api): add WebSocket event documentation

test(permissions): add tests for pattern matching
```

**Commit message guidelines:**
- Use imperative mood ("add" not "added")
- First line max 50 characters
- Body wraps at 72 characters
- Reference issues in footer: `Fixes #123`

## Coding Standards

### TypeScript

- **Strict mode**: All TypeScript strict checks enabled
- **Explicit types**: Add return types to public functions
- **No `any`**: Use `unknown` if type is truly unknown
- **Interfaces vs Types**: Interfaces for objects, types for unions

### Code Style

We use ESLint and Prettier:

```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
npm run format      # Format code
```

**Settings:**
- 2 spaces for indentation
- Single quotes
- Semicolons required
- Trailing commas (ES5)
- 120 character line length

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `session-manager.ts`)
- **Classes**: `PascalCase` (e.g., `Coordinator`)
- **Functions/Variables**: `camelCase` (e.g., `sendMessage`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_SESSIONS`)
- **Private members**: Prefix with `_` or use TypeScript `private`

### Comments

- Use JSDoc for public APIs
- Explain "why", not "what"
- Keep comments up-to-date with code
- Remove commented-out code before committing

**Example:**

```typescript
/**
 * Generates a session title from the user's first message.
 * Uses Claude Haiku for speed and cost efficiency.
 *
 * @param message - The user's first message
 * @returns A concise session title (max 50 characters)
 */
export async function generateSessionTitle(message: string): Promise<string> {
  // Implementation...
}
```

### File Organization

```typescript
// 1. Imports (external, then internal)
import { Router } from 'express';
import { db } from '../persistence/database.js';

// 2. Types/Interfaces
export interface Session {
  id: string;
  name: string;
}

// 3. Constants
const MAX_RETRIES = 3;

// 4. Implementation
export function createSession() {
  // ...
}
```

## Testing

### Running Tests

```bash
npm run test         # Run once
npm run test:watch   # Watch mode
```

### Writing Tests

We use Vitest for testing:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { generateSessionTitle } from '../title-generator';

describe('generateSessionTitle', () => {
  it('should generate a concise title', async () => {
    const message = 'Create a React component for user authentication';
    const title = await generateSessionTitle(message);

    expect(title).toBeTruthy();
    expect(title.length).toBeLessThan(50);
  });

  it('should handle empty messages', async () => {
    await expect(generateSessionTitle('')).rejects.toThrow();
  });
});
```

### Test Coverage

- Aim for >80% code coverage
- Test happy paths and error cases
- Mock external dependencies (database, API calls)
- Test edge cases and boundary conditions

### Integration Tests

For API endpoints:

```typescript
import request from 'supertest';
import { app } from '../server/app';

describe('POST /api/sessions', () => {
  it('should create a new session', async () => {
    const response = await request(app)
      .post('/api/sessions')
      .send({
        name: 'Test Session',
        workingDirectory: '/tmp/test'
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeTruthy();
  });
});
```

## Documentation

### When to Update Documentation

Update documentation when:
- Adding new features
- Changing existing behavior
- Adding new API endpoints
- Modifying configuration options
- Fixing bugs that affect documented behavior

### Documentation Files

- `README.md`: Overview and quick start
- `docs/ARCHITECTURE.md`: System design
- `docs/INSTALLATION.md`: Setup instructions
- `docs/USAGE.md`: User guide
- `docs/API.md`: API reference
- `docs/DEVELOPMENT.md`: Developer guide
- `CLAUDE.md`: Project-specific Claude Code instructions

### Documentation Style

- Use clear, concise language
- Include code examples
- Add diagrams where helpful
- Keep formatting consistent
- Test all code examples

## Pull Request Process

### Before Submitting

Checklist:
- [ ] Code follows style guidelines
- [ ] All tests pass: `npm run test`
- [ ] Linting passes: `npm run lint`
- [ ] Code is formatted: `npm run format`
- [ ] Documentation updated (if applicable)
- [ ] Commit messages follow convention
- [ ] Branch is up-to-date with `develop`
- [ ] No merge conflicts

### Submitting a Pull Request

1. **Push your branch:**
   ```bash
   git push origin feat/your-feature-name
   ```

2. **Create PR on GitHub:**
   - Target: `develop` branch
   - Title: Clear, descriptive title
   - Description: Explain what and why

3. **PR Description Template:**
   ```markdown
   ## Description
   Brief description of changes

   ## Motivation
   Why is this change needed?

   ## Changes Made
   - Change 1
   - Change 2

   ## Testing
   How was this tested?

   ## Screenshots (if applicable)
   Add screenshots for UI changes

   ## Checklist
   - [ ] Tests pass
   - [ ] Documentation updated
   - [ ] Linting passes
   ```

### Review Process

1. **Automated checks** run (lint, format, tests)
2. **Maintainer reviews** code
3. **Address feedback** if requested
4. **Approval** from maintainer
5. **Merge** to `develop`

### After Merge

- Delete your feature branch
- Pull latest `develop`
- Start next contribution

## Issue Guidelines

### Reporting Bugs

Use the bug report template:

```markdown
## Bug Description
Clear description of the bug

## Steps to Reproduce
1. Step 1
2. Step 2
3. ...

## Expected Behavior
What should happen?

## Actual Behavior
What actually happens?

## Environment
- OS: macOS 14.0
- Node.js: v22.0.0
- Omni-Bot: v0.1.0

## Additional Context
Any other relevant information
```

### Feature Requests

Use the feature request template:

```markdown
## Feature Description
Clear description of the feature

## Motivation
Why is this feature needed?

## Proposed Solution
How should it work?

## Alternatives Considered
Other approaches you've thought of

## Additional Context
Any other relevant information
```

### Asking Questions

- Check existing issues first
- Use GitHub Discussions for general questions
- Be clear and specific
- Provide context

## Security Issues

**Do not** open public issues for security vulnerabilities.

Instead:
1. Email security concerns to: [security email]
2. Include detailed description
3. Allow time for fix before public disclosure

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see [LICENSE](LICENSE)).

## Recognition

Contributors will be recognized in:
- Release notes
- CHANGELOG.md
- GitHub contributors page

## Getting Help

- Check the [docs/](docs/) directory
- Read existing issues and PRs
- Ask in GitHub Discussions
- Reach out to maintainers

## Thank You!

Your contributions make Omni-Bot better for everyone. We appreciate your time and effort! 🎉
