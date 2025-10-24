# Repository Guidelines

## Project Structure & Module Organization
- `api/` runs the Node backend (entry `server/index.js`), with services and routes under `api/src`.
- `client/` houses the Vite React UI; static assets live in `client/public`.
- `packages/` provides shared workspaces: `data-provider`, `api`, `data-schemas`, and `client` utilities.
- `e2e/` contains Playwright specs and configs; `config/` and `scripts/` store operational tooling.
- Persistent uploads live in `uploads/`; seed and example data sits in `data/` and `data-node/`.

## Build, Test, and Development Commands
- `npm run backend:dev` starts the API with Nodemon and reloads on code changes.
- `npm run frontend:dev` launches the Vite dev server (defaults to http://localhost:3080).
- `npm run frontend` builds shared packages, then the production client bundle in `client/dist`.
- `npm run backend` serves the production backend; pair it with a fresh frontend build for staging smoke tests.
- `npm run e2e` runs Playwright against local configs; `npm run e2e:report` opens the latest HTML report.
- After dependency bumps, run `npm run update:local` to sync lockfiles and generated assets.

## Coding Style & Naming Conventions
- JavaScript/TypeScript use Prettier defaults (2-space indent, trailing commas where valid); run `npm run lint` or `npm run lint:fix` for ESLint compliance.
- React components/hooks follow PascalCase; utility functions stay camelCase; environment flags use `SCREAMING_SNAKE_CASE`.
- Import shared schemas and clients from `packages/*` aliases instead of deep relative paths, keeping types centralized in `packages/data-schemas`.

## Testing Guidelines
- Client unit tests rely on Jest + Testing Library; colocate specs as `Component.test.tsx` or under `__tests__` folders.
- Backend CI specs execute via `npm run test:api`; ensure new handlers include happy-path and error coverage.
- End-to-end flows live in `e2e/tests`; update snapshots with `npm run e2e:update` when UI changes are intentional and document deltas in the PR.
- Check the Playwright HTML report before merging and mark flaky tests with `test.fixme` plus an issue link.

## Commit & Pull Request Guidelines
- Adopt Conventional Commits (`fix(openai): ensure attachments are sent`) to match the existing history.
- Keep each commit scoped narrowly; use the body for migrations, config changes, or manual follow-up steps.
- Pull requests need a concise summary, linked issues, and screenshots or API traces for UI or contract updates.
- Confirm lint, unit, and Playwright suites pass locally before requesting review; tag owners for `api`, `client`, or `packages` areas as appropriate.

## Configuration & Secrets
- Copy `.env.example` and `librechat.example.yaml` before first run; never commit environment secrets or API keys.
- Use the scripts in `config/` (`npm run create-user`, `npm run reset-password`, etc.) instead of manual database edits, and note new scripts in `README.md`.
