# CLAUDEX.md - Development Guide

## Build Commands
- `pnpm i` - Install dependencies
- `pnpm run dev` - Run development server
- `pnpm run build` - Build for production
- `pnpm run format` - Format code with Prettier
- `pnpm run format:check` - Check formatting without modifying files
- `NODE_ENV=development pnpm run dev --verbose --debug` - Run with additional debug logs

## Code Style

### Formatting
- Use Prettier with settings: semi: false, tabWidth: 2, printWidth: 80, singleQuote: true
- Use ES modules (import/export)
- Use React functional components with hooks

### Naming Conventions
- camelCase for variables, functions, and methods
- PascalCase for React components, classes, and types
- Use descriptive names that clearly indicate purpose

### TypeScript
- TypeScript is used but with `strict: false` in tsconfig
- Use explicit type annotations for function parameters and return types
- Use interfaces and types for complex structures

### Component Structure
- Use React hooks for state and side effects
- Prefer functional components over class components
- Use memo for performance optimization when appropriate