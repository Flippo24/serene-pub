# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development

- `npm run dev` - Start development server on localhost:5173
- `npm run dev:host` - Start development server with host access
- `npm run build` - Build for production (includes SSR build and customization)
- `npm start` - Start production server from build
- `npm run preview` - Preview production build

### Code Quality

- `npm run check` - Run Svelte type checking
- `npm run check:watch` - Run type checking in watch mode
- `npm run format` - Format code with Prettier
- `npm run lint` - Check code formatting (use this for validation)

### Database Management

- `npm run db:generate` - Generate Drizzle migrations
- `npm run db:migrate` - Run database migrations
- `npm run db:studio` - Open Drizzle Studio for database inspection

### Distribution

- `npm run bundle` - Create distribution bundle
- `npm run dist` - Full build and bundle process

## Architecture Overview

### Tech Stack

- **Frontend**: SvelteKit 2.x with Svelte 5, TypeScript
- **Styling**: TailwindCSS 4.x with Skeleton UI components
- **Database**: Drizzle ORM with PostgreSQL (PGLite for embedded use)
- **Real-time**: WebSockets via sveltekit-io for live updates
- **Build**: Vite with Node.js adapter

### Project Structure

**Key Directories:**

- `src/lib/client/` - Client-side components and utilities
- `src/lib/server/` - Server-side logic (database, sockets, AI adapters)
- `src/lib/shared/` - Shared constants and utilities
- `src/routes/` - SvelteKit routes and API endpoints

**Core Components:**

- `src/lib/client/components/` - Reusable Svelte components organized by feature
- `src/lib/client/connectionForms/` - AI connection configuration forms
- `src/lib/server/connectionAdapters/` - AI model integration adapters
- `src/lib/server/sockets/` - WebSocket event handlers
- `src/lib/server/utils/promptBuilder/` - Advanced prompt compilation system

### Database Schema

The application uses a comprehensive schema defined in `$lib/server/db/schema.ts`:

**Core Entities:**

- `users` - User accounts with active configuration references
- `connections` - AI model connections (OpenAI, Ollama, LM Studio, etc.)
- `characters` - AI-controlled characters with rich metadata
- `personas` - User-controlled characters/identities
- `chats` - Conversations (1:1 or group) with message history
- `lorebooks` - Advanced worldbuilding and context management

**Configuration Tables:**

- `samplingConfigs` - AI generation parameters (temperature, top-p, etc.)
- `contextConfigs` - Handlebars templates for prompt formatting
- `promptConfigs` - System prompts and instructions

### Real-time Architecture

WebSocket-based real-time updates using sveltekit-io:

- All CRUD operations emit to user rooms for live UI updates
- Socket handlers in `src/lib/server/sockets/` manage events
- Client connects to single user room for security

### AI Integration System

Modular adapter pattern for AI model support:

- `BaseConnectionAdapter` - Abstract base for all AI connections
- Individual adapters for OpenAI, Ollama, LM Studio, Llama.cpp
- `PromptBuilder` - Advanced prompt compilation with Handlebars templating
- Token counting and context management per connection type

### Prompt Builder System

Sophisticated prompt compilation system with:

- Handlebars-based templating with custom helpers
- Modular content inclusion strategies
- Lorebook integration with keyword matching (vectorization planned)
- Token-aware context truncation
- Multiple output formats (chat completion vs. text completion)

## Important Development Notes

### Database Migrations

Always run `npm run db:generate` after schema changes, then `npm run db:migrate` to apply.

### WebSocket Events

When adding new socket events, register them in `src/lib/server/sockets/index.ts` following the existing pattern.

### AI Adapter Development

New AI connection types should extend `BaseConnectionAdapter` and implement required methods. Add connection defaults and sampling key mappings.

### Lorebook System

The advanced lorebook system supports:

- World lore (global context)
- Character lore (character-specific context)
- History entries (timeline-based context)
- Binding system for dynamic character references

### Component Architecture

Components are organized by feature area. Form components follow consistent patterns for WebSocket-based CRUD operations with optimistic updates.

## Testing

No specific test framework is currently configured. Manual testing through the dev server is the primary approach.
