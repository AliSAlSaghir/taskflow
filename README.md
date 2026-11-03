# TaskFlow

A project and task management REST API built with TypeScript, Node.js, Express, and PostgreSQL.

TaskFlow provides project organization, team collaboration, task assignment, authentication, session management, and file attachments. It focuses on secure access control, data integrity, and maintainable backend architecture.

**Live API:** [https://taskflow-api-9g57.onrender.com](https://taskflow-api-9g57.onrender.com)

**Repository:** [https://github.com/AliSAlSaghir/taskflow](https://github.com/AliSAlSaghir/taskflow)

## Features

### Authentication and accounts

- User registration and login.
- Password hashing with Argon2.
- JWT access tokens stored in HTTP-only cookies.
- Refresh-token rotation and reuse detection.
- Session expiration and revocation.
- Logout from the current session or all sessions.
- Profile management and profile pictures.
- Account deactivation.

### Projects and collaboration

- Create, update, and archive projects.
- Project ownership and membership management.
- Owner-controlled project operations.
- Members can view project tasks and update tasks assigned to them.
- Administrative project inspection.

### Task management

- Create, update, and archive tasks.
- Assign tasks to project members.
- Task statuses and priorities.
- Due dates.
- Search, filtering, and pagination.
- Project-specific labels.
- Task comments.

### File management

- Upload, list, download, and delete task attachments.
- Support for JPEG, PNG, WebP, PDF, and plain-text attachments.
- Profile-picture processing, resizing, and WebP conversion.
- Private object storage using Backblaze B2.

### Security

- CSRF protection for state-changing requests.
- Trusted-origin validation.
- HTTP security headers with Helmet.
- Rate limiting for authentication endpoints.
- Request validation with Zod.
- Session and account-status verification.
- Refresh-token reuse detection.

## Technology Stack

| Category                    | Technologies                     |
| --------------------------- | -------------------------------- |
| Runtime                     | Node.js 24                       |
| Language                    | TypeScript                       |
| Backend                     | Express 5                        |
| Database                    | PostgreSQL 17                    |
| ORM                         | Prisma 7                         |
| Validation                  | Zod                              |
| Authentication              | jose, Argon2                     |
| File uploads and processing | Multer, Sharp                    |
| Object storage              | Backblaze B2 (S3-compatible API) |
| Testing                     | Vitest, Supertest, Newman        |
| Containerization            | Docker, Docker Compose           |
| Package manager             | pnpm                             |
| CI/CD                       | GitHub Actions                   |
| Deployment                  | Render                           |

## Project Structure

The application follows a modular structure, separating application concerns, infrastructure, configuration, and feature modules.

```text
src/
├── app/                  # Express application, middleware, error handling
├── config/               # Environment configuration and validation
├── infrastructure/
│   ├── database/         # Prisma database client
│   └── storage.ts        # Object storage integration
├── modules/
│   ├── admin/
│   ├── attachments/
│   ├── auth/
│   ├── comments/
│   ├── labels/
│   ├── profile/
│   ├── projects/
│   └── tasks/
├── types/                # Shared TypeScript declarations
└── server.ts             # HTTP server and lifecycle management
```

The database uses UUID identifiers, relational constraints, indexes, and explicit deletion restrictions to preserve historical records.

## Getting Started

### Prerequisites

- Node.js 24
- pnpm 12.14.0
- Docker and Docker Compose
- Git

### 1. Clone the repository

```bash
git clone https://github.com/AliSAlSaghir/taskflow.git
cd taskflow
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

Create a local environment file:

```bash
cp .env.example .env
```

Update the values in `.env`.

| Variable              | Description                                         |
| --------------------- | --------------------------------------------------- |
| `PORT`                | API server port (default: `3000`)                   |
| `POSTGRES_PASSWORD`   | Local PostgreSQL password                           |
| `DATABASE_URL`        | Development database connection string              |
| `DATABASE_URL_TEST`   | Test database connection string                     |
| `ACCESS_TOKEN_SECRET` | Secret used for signing and verifying access tokens |
| `ALLOW_DEMO_SEED`     | Enables or disables demo seeding                    |
| `FRONTEND_ORIGIN`     | Trusted frontend origin; required in production     |
| `B2_KEY_ID`           | Backblaze B2 application key ID                     |
| `B2_APPLICATION_KEY`  | Backblaze B2 application key                        |
| `B2_BUCKET_NAME`      | Backblaze B2 bucket name                            |
| `B2_REGION`           | Backblaze B2 bucket region                          |
| `B2_ENDPOINT`         | Backblaze B2 S3-compatible endpoint                 |

Generate a suitable access-token secret:

```bash
openssl rand -base64 32
```

The generated value should be at least 43 characters long.

Backblaze B2 credentials are required for production storage functionality. Configure them locally if you want to test file uploads.

### 4. Start PostgreSQL

```bash
pnpm db:up
```

Docker Compose starts PostgreSQL 17 and persists its data in a named volume.

### 5. Apply database migrations

Apply migrations to the development database:

```bash
pnpm exec prisma migrate dev
```

Generate the Prisma Client:

```bash
pnpm exec prisma generate
```

### 6. Configure the test database

Create a separate PostgreSQL database for testing:

```bash
docker compose exec db createdb -U taskflow taskflow_test
```

Apply migrations to the test database by temporarily pointing `DATABASE_URL` to it:

```bash
DATABASE_URL="postgresql://taskflow:YOUR_PASSWORD@localhost:5432/taskflow_test?schema=public" pnpm exec prisma migrate deploy
```

Make sure `DATABASE_URL_TEST` in `.env` points to this same test database. The application uses this variable when running in test mode.

### 7. Start the development server

```bash
pnpm dev
```

The API runs at:

```text
http://localhost:3000
```

Health endpoints:

| Endpoint            | Description                        |
| ------------------- | ---------------------------------- |
| `GET /health`       | Application health                 |
| `GET /health/ready` | Application and database readiness |

## Available Scripts

| Command           | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `pnpm dev`        | Start the development server with automatic restarts     |
| `pnpm dev:test`   | Start the server in test mode                            |
| `pnpm build`      | Generate Prisma Client and compile TypeScript            |
| `pnpm start`      | Apply pending migrations and start the production server |
| `pnpm typecheck`  | Run TypeScript type checking                             |
| `pnpm test`       | Run the automated test suite                             |
| `pnpm test:watch` | Run tests in watch mode                                  |
| `pnpm test:api`   | Run API smoke tests using Newman                         |
| `pnpm db:up`      | Start the PostgreSQL container                           |
| `pnpm db:down`    | Stop the PostgreSQL container                            |
| `pnpm db:logs`    | Follow PostgreSQL logs                                   |

## Testing

TaskFlow uses multiple levels of automated testing:

- **Unit and integration tests:** Vitest and Supertest.
- **API smoke tests:** Postman collection executed through Newman.
- **Type checking:** TypeScript.
- **Build verification:** TypeScript compilation and Prisma Client generation.

Run the main verification commands:

```bash
pnpm typecheck
pnpm build
pnpm test
```

Run API smoke tests against a running application:

```bash
pnpm test:api
```

## Continuous Integration

GitHub Actions runs automated checks on pushes and pull requests.

The CI workflows include:

- Dependency installation using the pnpm lockfile.
- Prisma Client generation.
- Database migrations against PostgreSQL.
- Type checking and application build.
- Automated test suite.
- API smoke tests against a running application.

A separate scheduled workflow checks the deployed production API's health and database readiness every six hours.

## Deployment

The API is deployed on Render:

[https://taskflow-api-9g57.onrender.com](https://taskflow-api-9g57.onrender.com)

Production deployment requires:

- A PostgreSQL database.
- The required environment variables.
- Backblaze B2 object-storage credentials.
- A correctly configured frontend origin.

The production start command applies pending Prisma migrations before starting the compiled application.
