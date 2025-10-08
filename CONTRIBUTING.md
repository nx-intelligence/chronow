# Contributing to Chronow

Thank you for your interest in contributing to Chronow! This document provides guidelines for contributing to the project.

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/nx-intelligence/chronow.git
   cd chronow
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment**:
   - Copy `env.example` to `.env`
   - Set up a local Redis instance (e.g., via Docker)
   - Set up MongoDB for Chronos-DB

4. **Build the project**:
   ```bash
   npm run build
   ```

## Running Examples

```bash
# Install ts-node for running TypeScript examples
npm install -g ts-node

# Run basic usage example
ts-node examples/basic-usage.ts

# Run retry/DLQ example
ts-node examples/retry-and-dlq.ts
```

## Code Style

- Use TypeScript for all source code
- Follow the existing code style
- Run `npm run lint` before committing
- Ensure all types are properly defined

## Testing

(To be added in future versions)

```bash
npm test
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run linter: `npm run lint`
5. Build: `npm run build`
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to your fork (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## Pull Request Guidelines

- Provide a clear description of the changes
- Link any related issues
- Ensure all checks pass
- Update documentation if needed
- Add examples for new features

## Feature Requests and Bug Reports

Please use GitHub Issues to:
- Report bugs
- Request new features
- Ask questions

### Bug Report Template

```
**Description**
A clear description of the bug.

**Steps to Reproduce**
1. Initialize Chronow with...
2. Call method...
3. See error...

**Expected Behavior**
What you expected to happen.

**Actual Behavior**
What actually happened.

**Environment**
- Chronow version:
- Node.js version:
- Redis version:
- OS:
```

### Feature Request Template

```
**Feature Description**
A clear description of the feature.

**Use Case**
Why this feature would be useful.

**Proposed API**
Example of how the API might look.
```

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other contributors

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Feel free to open an issue or reach out to the maintainers.

