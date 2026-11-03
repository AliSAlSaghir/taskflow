# TaskFlow — Architecture

This document describes the architecture and key design decisions behind TaskFlow's backend.

It covers the database model, application structure, authentication, authorization, and data-management workflows.

## 1. System Overview

TaskFlow is a modular REST API built with Node.js, TypeScript, Express, and PostgreSQL.

The application separates HTTP handling, business logic, database access, and external infrastructure integrations into distinct responsibilities.

The main architectural areas are:

- **Application layer:** Express configuration, middleware, request handling, and error handling.
- **Feature modules:** Business logic organized around application domains.
- **Infrastructure:** Database and object-storage integrations.
- **Configuration:** Environment-variable validation and application settings.

## 2. Database Design

TaskFlow uses PostgreSQL with Prisma ORM. All primary entity identifiers use UUIDs.

The schema is organized around users, profiles, authentication sessions, projects, memberships, tasks, labels, comments, and attachments.

### 2.1 Entity Relationships

The main relationships are:

| Relationship                | Cardinality  | Description                                                                   |
| --------------------------- | ------------ | ----------------------------------------------------------------------------- |
| User – Profile              | One-to-one   | Each user has at most one profile.                                            |
| User – AuthSession          | One-to-many  | A user can have multiple authentication sessions.                             |
| AuthSession – RefreshToken  | One-to-many  | A session can have multiple refresh tokens over its lifetime.                 |
| User – Project              | One-to-many  | A user can own multiple projects.                                             |
| User – ProjectMembership    | One-to-many  | A user can participate in multiple projects.                                  |
| Project – ProjectMembership | One-to-many  | A project can have multiple members.                                          |
| Project – Task              | One-to-many  | A project contains multiple tasks.                                            |
| Project – Label             | One-to-many  | A project can define multiple labels.                                         |
| Task – Label                | Many-to-many | Tasks can have multiple labels, and labels can be assigned to multiple tasks. |
| Task – TaskComment          | One-to-many  | A task can have multiple comments.                                            |
| Task – Attachment           | One-to-many  | A task can have multiple attachments.                                         |
| User – TaskComment          | One-to-many  | A user can author multiple comments.                                          |
| User – Attachment           | One-to-many  | A user can upload multiple attachments.                                       |

### 2.2 Project Membership and Task Assignment

`ProjectMembership` represents the relationship between users and projects.

It is an explicit join model rather than an implicit many-to-many relationship. This allows the application to store additional membership information and enforce project-specific assignment rules.

A task's optional `assigneeId` references a project membership using a composite foreign key:

- `Task.projectId`
- `Task.assigneeId`

These reference:

- `ProjectMembership.projectId`
- `ProjectMembership.userId`

This ensures that an assigned user must belong to the same project as the task.

The database also enforces uniqueness on `(projectId, userId)` in `ProjectMembership`.

### 2.3 Task Labels

Tasks and labels have a many-to-many relationship implemented through the `TaskLabel` join table.

The join table contains:

- `projectId`
- `taskId`
- `labelId`

Composite foreign keys ensure that the task and label belong to the same project.

The primary key is `(taskId, labelId)`, preventing duplicate label assignments to a task.

Deleting a label automatically removes its task-label associations through the configured cascade relationship. The task and label records themselves remain subject to their respective deletion rules.

### 2.4 Authentication Data

Authentication is represented through three models:

**User**

- Stores account information, password hash, role, and account status.
- Passwords are hashed using Argon2.

**AuthSession**

- Represents an authenticated session.
- Stores creation, expiration, revocation, and last-used timestamps.
- A user can have multiple sessions.

**RefreshToken**

- Stores a SHA-256 hash of the refresh token rather than the original token.
- Tracks expiration and revocation.
- `replacedBy` records the replacement token identifier during rotation.

This structure supports session management, token rotation, and revocation.

### 2.5 Historical Data and Deletion Policies

TaskFlow uses explicit deletion restrictions to avoid accidentally removing related historical records.

Important lifecycle fields include:

| Entity       | Field        | Purpose                                                |
| ------------ | ------------ | ------------------------------------------------------ |
| User         | `status`     | Supports account deactivation.                         |
| Project      | `archivedAt` | Supports project archiving.                            |
| Task         | `archivedAt` | Supports task archiving.                               |
| TaskComment  | `deletedAt`  | Supports comment deletion while preserving the record. |
| AuthSession  | `revokedAt`  | Tracks session revocation.                             |
| RefreshToken | `revokedAt`  | Tracks refresh-token revocation.                       |

Most foreign-key relationships use `onDelete: Restrict`, preventing deletion while dependent records exist.

This favors preserving historical records over cascading deletion through the application.

## 3. Application Structure

The source code is organized by feature module.

```text
src/
├── app/
│   ├── middleware/
│   ├── app.ts
│   ├── error-handler.ts
│   ├── logger.ts
│   └── not-found.ts
├── config/
│   └── env.ts
├── infrastructure/
│   ├── database/
│   │   └── prisma.ts
│   └── storage.ts
├── modules/
│   ├── admin/
│   ├── attachments/
│   ├── auth/
│   ├── comments/
│   ├── labels/
│   ├── profile/
│   ├── projects/
│   └── tasks/
├── types/
└── server.ts
```

### 3.1 Feature Modules

Each feature module groups the files responsible for its functionality.

The modules generally separate responsibilities into:

- **Routes:** Define endpoints and middleware requirements.
- **Controllers:** Handle HTTP requests and responses.
- **Services:** Implement business logic and coordinate database or infrastructure operations.
- **Schemas:** Validate incoming data using Zod.
- **Errors:** Define domain-specific errors where needed.

Not every module requires every file type.

### 3.2 Infrastructure

Infrastructure contains integrations that are shared across feature modules.

- `infrastructure/database/prisma.ts` provides the database client.
- `infrastructure/storage.ts` provides the object-storage integration with Backblaze B2.

Feature services use these integrations instead of implementing database connections or storage operations independently.

## 4. Request Lifecycle

A typical API request follows this flow:

1. The request enters the Express application.
2. Global middleware handles request identification, security, parsing, and trusted-origin validation.
3. The router matches the requested endpoint.
4. Route middleware performs authentication, authorization, rate limiting, or CSRF validation as required.
5. The controller validates request input and coordinates the HTTP response.
6. The service performs the business operation.
7. The service interacts with Prisma or external infrastructure.
8. The controller returns the response.
9. Errors are passed to the centralized error handler when necessary.

The application uses centralized error handling to produce consistent API error responses without exposing internal error details to clients.

## 5. Authentication and Session Management

TaskFlow uses cookie-based authentication.

### 5.1 Access Tokens

- JWT access tokens are signed using HS256.
- Tokens have a short lifetime of 15 minutes.
- Tokens include issuer, audience, subject, and session identifier claims.
- Access tokens are stored in HTTP-only cookies.

### 5.2 Refresh Tokens

- Refresh tokens are generated using cryptographically secure random bytes.
- Only their SHA-256 hashes are stored in the database.
- Refresh tokens are rotated when used.
- Reuse of a revoked refresh token triggers session revocation.

### 5.3 Session Validation

Authentication middleware verifies the access token and checks the associated user and session in the database.

This allows revoked sessions and disabled accounts to lose access immediately, without waiting for the access token to expire.

### 5.4 CSRF Protection

State-changing requests require CSRF protection.

The application uses a session-bound HMAC-based CSRF token, submitted through the `X-CSRF-Token` header.

Trusted-origin validation provides an additional protection layer for unsafe HTTP methods.

## 6. Authorization Model

TaskFlow uses role-based and resource-based authorization.

### Project owners

- Create and manage their projects.
- Manage project membership.
- Manage project tasks and labels.
- Manage task attachments.
- Access project comments.

### Project members

- Access projects they belong to while their accounts are active.
- View project tasks and comments.
- Update tasks assigned to them, subject to task-specific permissions.
- Create comments on active tasks.

### Comment permissions

- Project owners and active members can view comments.
- Only the original author can edit or delete their comments.
- Comment deletion is implemented as soft deletion.
- Creating, editing, and deleting comments is prohibited when the project or task is archived.
- Existing comments remain readable after archiving.

### Administrators

- List and search users and projects.
- Inspect individual user and project details.
- Inspect both active and archived projects.
- Inspect project memberships, tasks (including archived tasks), labels, comments (including deleted comments), and attachment metadata.
- Deactivate and reactivate user accounts.

Deactivating a user also revokes their active authentication sessions and refresh tokens within a database transaction.

Administrative access is explicitly authorized and separate from ordinary project ownership and membership permissions.

Authorization is enforced through route middleware and service-level resource checks rather than relying solely on client-provided identifiers.

## 7. File Storage

TaskFlow uses Backblaze B2 through its S3-compatible API.

Files are stored externally, while PostgreSQL stores their metadata and storage keys.

### Task attachments

The application validates uploaded file size, declared content type, and file signatures before storing attachments.

Attachment metadata includes:

- Original filename.
- Content type.
- File size.
- Storage key.
- Task and uploader references.

### Profile pictures

Profile pictures are processed with Sharp:

1. Validate the image format.
2. Check image dimensions and pixel count.
3. Reject animated images.
4. Apply orientation correction.
5. Resize to fit within 1024 × 1024.
6. Convert to WebP.
7. Upload the processed image to object storage.

The database stores the resulting storage key in the user's profile.

## 8. Data Integrity and Design Decisions

Several database and application-level decisions help maintain consistency:

- UUIDs provide identifiers for database entities.
- Foreign keys enforce relationships.
- Composite foreign keys enforce project-specific task assignments and label associations.
- Unique constraints prevent duplicate memberships and label assignments.
- Indexes support common lookup and filtering operations.
- Restrictive deletion policies protect dependent historical records.
- Archiving and account deactivation preserve records instead of deleting them.

These decisions help keep business rules enforced consistently across API operations.
