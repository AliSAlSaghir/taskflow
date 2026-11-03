# TaskFlow API Reference

## Base URL

The API is versioned under `/api/v1`.

**Production:**

`https://taskflow-api-9g57.onrender.com/api/v1`

**Local development:**

`http://localhost:3000/api/v1`

All request and response bodies use JSON unless an endpoint explicitly uses `multipart/form-data` or returns a file.

## Authentication

TaskFlow uses JWT-based authentication with HttpOnly cookies.

After a successful login, the server sets two cookies:

| Cookie          | Purpose                            | Lifetime   |
| --------------- | ---------------------------------- | ---------- |
| `access_token`  | Authenticates API requests         | 15 minutes |
| `refresh_token` | Obtains a replacement access token | 7 days     |

The access cookie is scoped to `/`; the refresh cookie is scoped to `/api/v1/auth`.

Cookies are HttpOnly, use `SameSite=Lax`, and are Secure in production. Browser clients must send credentials with cross-origin requests when applicable.

### CSRF protection

Authenticated state-changing requests require a CSRF token in the `X-CSRF-Token` header.

Obtain a token using:

`GET /auth/csrf-token`

The response contains:

```json
{
  "data": {
    "csrfToken": "..."
  }
}
```

Send that token in the `X-CSRF-Token` header for protected requests.

### Authentication conventions

- Public endpoints: registration, login, and refresh.
- Authenticated endpoints: require a valid access token.
- Admin endpoints: require authentication and the `ADMIN` role.
- State-changing authenticated endpoints: require CSRF protection.
- Logout revokes the current session.
- Logout-all revokes all sessions belonging to the current user.
- Refresh rotates the refresh token. Invalid refresh tokens return `401` and clear the authentication cookies.

## Response conventions

### Successful responses

Most JSON responses use a `data` property:

```json
{
  "data": {}
}
```

List endpoints may return an array inside `data`:

```json
{
  "data": []
}
```

### Paginated responses

Paginated endpoints return:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

Pagination parameters:

| Parameter | Default | Constraints                |
| --------- | ------: | -------------------------- |
| `page`    |     `1` | Integer, minimum 1         |
| `limit`   |    `10` | Integer, between 1 and 100 |

### Error responses

Errors use an `error` object:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "A description of the error."
  }
}
```

Validation errors generally include a `details` array:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [
      {
        "field": "email",
        "message": "Enter a valid email address."
      }
    ]
  }
}
```

Common HTTP status codes:

| Status | Meaning                                             |
| ------ | --------------------------------------------------- |
| `400`  | Invalid input, malformed JSON, or failed validation |
| `401`  | Missing or invalid authentication                   |
| `403`  | Authenticated user is not authorized                |
| `404`  | Requested resource not found or not accessible      |
| `409`  | Conflict with the current resource state            |
| `502`  | External storage operation failed                   |
| `500`  | Unexpected server error                             |

Unhandled errors return `INTERNAL_SERVER_ERROR`. A `requestId` is included when available.

---

## 1. Health checks

These endpoints do not require authentication.

| Method | Endpoint        | Description                                            |
| ------ | --------------- | ------------------------------------------------------ |
| GET    | `/health`       | Checks whether the application is running              |
| GET    | `/health/ready` | Checks application readiness and database connectivity |

### `GET /health`

Successful response: `200 OK`

```json
{
  "status": "ok"
}
```

### `GET /health/ready`

Successful response: `200 OK`

```json
{
  "status": "ready",
  "database": "connected"
}
```

Database connectivity failure: `503 Service Unavailable`

```json
{
  "status": "not_ready"
}
```

---

## 2. Authentication

Base path: `/auth`

| Method | Endpoint      | Authentication  | Description                             |
| ------ | ------------- | --------------- | --------------------------------------- |
| POST   | `/register`   | Public          | Register a new account                  |
| POST   | `/login`      | Public          | Authenticate and create a session       |
| GET    | `/me`         | Required        | Get the current user                    |
| GET    | `/csrf-token` | Required        | Obtain the current session's CSRF token |
| POST   | `/refresh`    | Refresh cookie  | Rotate the refresh token                |
| POST   | `/logout`     | Required + CSRF | Revoke the current session              |
| POST   | `/logout-all` | Required + CSRF | Revoke all user sessions                |

### `POST /register`

Request body:

```json
{
  "email": "user@example.com",
  "password": "your-secure-password",
  "displayName": "Example User"
}
```

Validation:

- `email`: valid email, maximum 254 characters.
- `password`: 12–128 characters.
- `displayName`: 2–80 characters.
- Email is trimmed and converted to lowercase.

Success: `201 Created`.

Possible errors:

- `400 VALIDATION_ERROR`
- `409 EMAIL_ALREADY_REGISTERED`

Registration does not automatically create an authenticated session.

### `POST /login`

Request body:

```json
{
  "email": "user@example.com",
  "password": "your-secure-password"
}
```

Validation:

- `email`: valid email, maximum 254 characters.
- `password`: required, maximum 128 characters.

Success: `200 OK`, with the authenticated user in `data` and authentication cookies set.

Possible errors:

- `400 VALIDATION_ERROR`
- `401 INVALID_CREDENTIALS`

### `GET /me`

Returns the current user's account and profile information.

Success: `200 OK`.

### `GET /csrf-token`

Returns the CSRF token for the current authenticated session.

Success: `200 OK`.

### `POST /refresh`

Uses the refresh cookie to rotate the refresh token and issue a new access token.

Success: `200 OK`.

```json
{
  "data": {
    "refreshed": true
  }
}
```

Invalid or missing refresh token: `401 INVALID_REFRESH_TOKEN`. Both authentication cookies are cleared.

### `POST /logout`

Requires authentication and CSRF protection.

Revokes the current session and clears the authentication cookies.

Success: `200 OK`.

```json
{
  "data": {
    "loggedOut": true
  }
}
```

### `POST /logout-all`

Requires authentication and CSRF protection.

Revokes all sessions belonging to the current user and clears the current authentication cookies.

Success: `200 OK`.

```json
{
  "data": {
    "loggedOut": true,
    "allSessionsRevoked": true
  }
}
```

---

## 3. Profile

Base path: `/profile`

All endpoints require authentication.

| Method | Endpoint           | CSRF         | Description                               |
| ------ | ------------------ | ------------ | ----------------------------------------- |
| PATCH  | `/`                | Required     | Update profile information                |
| PUT    | `/picture`         | Required     | Upload or replace profile picture         |
| GET    | `/:userId/picture` | Not required | Retrieve a user's profile picture         |
| DELETE | `/picture`         | Required     | Delete the current user's profile picture |

### `PATCH /profile`

Request body:

```json
{
  "displayName": "New Display Name",
  "bio": "A short introduction."
}
```

Both fields are optional, but at least one must be provided.

Validation:

- `displayName`: 2–80 characters.
- `bio`: maximum 500 characters; may be `null` to clear it.

Success: `200 OK`.

### `PUT /profile/picture`

Content type: `multipart/form-data`

| Field  | Type | Description     |
| ------ | ---- | --------------- |
| `file` | File | Profile picture |

Requirements:

- Maximum upload size: 2 MB.
- Accepted formats: JPEG, PNG, and WebP.
- The server validates the actual image format and processes the image before storage.

Success: `200 OK`.

Possible errors:

- `400 VALIDATION_ERROR`
- `404 NOT_FOUND`
- `404 PROFILE_PICTURE_NOT_FOUND`
- `502 PROFILE_STORAGE_ERROR`

### `GET /profile/:userId/picture`

Returns the image bytes directly, rather than a JSON response.

The response includes the image's `Content-Type`, `Content-Length`, and `Cache-Control: private, no-store` headers.

Possible errors:

- `400 VALIDATION_ERROR`
- `404 PROFILE_PICTURE_NOT_FOUND`

### `DELETE /profile/picture`

Deletes the current user's profile picture.

Success: `200 OK`.

---

## 4. Projects

Base path: `/projects`

All endpoints require authentication. Project permissions depend on ownership and membership.

| Method | Endpoint                | CSRF         | Description                 |
| ------ | ----------------------- | ------------ | --------------------------- |
| POST   | `/`                     | Required     | Create a project            |
| GET    | `/`                     | Not required | List the user's projects    |
| GET    | `/:projectId`           | Not required | Get project details         |
| PATCH  | `/:projectId`           | Required     | Update a project            |
| DELETE | `/:projectId`           | Required     | Archive a project           |
| POST   | `/:projectId/unarchive` | Required     | Restore an archived project |

### `POST /projects`

Request body:

```json
{
  "name": "Website Redesign",
  "description": "A project to redesign the company website."
}
```

Validation:

- `name`: required, 1–120 characters.
- `description`: optional, maximum 2,000 characters; may be `null`.

Success: `201 Created`.

### `GET /projects`

Query parameters:

| Parameter  | Default | Description                       |
| ---------- | ------- | --------------------------------- |
| `page`     | `1`     | Page number                       |
| `limit`    | `10`    | Results per page, maximum 100     |
| `archived` | `false` | Whether to list archived projects |

Only projects accessible to the current user are included.

### `GET /projects/:projectId`

Returns project details for an accessible project.

### `PATCH /projects/:projectId`

Request body may contain either or both fields:

```json
{
  "name": "Updated Project Name",
  "description": "Updated description."
}
```

At least one field must be provided.

### `DELETE /projects/:projectId`

Archives the project instead of permanently deleting it.

### `POST /projects/:projectId/unarchive`

Restores an archived project.

---

## 5. Project members

Base path: `/projects/:projectId/members`

| Method | Endpoint                                     | CSRF         | Description           |
| ------ | -------------------------------------------- | ------------ | --------------------- |
| POST   | `/projects/:projectId/members`               | Required     | Add a member by email |
| GET    | `/projects/:projectId/members`               | Not required | List project members  |
| DELETE | `/projects/:projectId/members/:membershipId` | Required     | Remove a member       |

### `POST /projects/:projectId/members`

Request body:

```json
{
  "email": "member@example.com"
}
```

The email must be valid and is normalized to lowercase.

Success: `201 Created`.

Possible errors:

- `404 NOT_FOUND` when the project or eligible user cannot be found.
- `409 MEMBERSHIP_ALREADY_EXISTS` when the user is already a member.

### `GET /projects/:projectId/members`

Supports `page` and `limit` pagination.

### `DELETE /projects/:projectId/members/:membershipId`

Removes the specified membership.

Success: `204 No Content`.

Possible errors:

- `404 NOT_FOUND`
- `409 MEMBER_HAS_ASSIGNED_TASKS` if the member still has assigned tasks.

Reassign or unassign those tasks before removing the member.

---

## 6. Tasks

Base path: `/projects/:projectId/tasks`

| Method | Endpoint                                     | CSRF         | Description              |
| ------ | -------------------------------------------- | ------------ | ------------------------ |
| POST   | `/projects/:projectId/tasks`                 | Required     | Create a task            |
| GET    | `/projects/:projectId/tasks`                 | Not required | List project tasks       |
| GET    | `/projects/:projectId/tasks/:taskId`         | Not required | Get task details         |
| PATCH  | `/projects/:projectId/tasks/:taskId`         | Required     | Update a task            |
| DELETE | `/projects/:projectId/tasks/:taskId`         | Required     | Archive a task           |
| POST   | `/projects/:projectId/tasks/:taskId/restore` | Required     | Restore an archived task |

### `POST /projects/:projectId/tasks`

Request body:

```json
{
  "title": "Implement authentication",
  "description": "Implement registration and login.",
  "priority": "HIGH",
  "assigneeId": "00000000-0000-4000-8000-000000000001",
  "dueDate": "2026-12-15"
}
```

Validation:

| Field         | Constraints                                      |
| ------------- | ------------------------------------------------ |
| `title`       | Required, 1–200 characters                       |
| `description` | Optional, maximum 2,000 characters; nullable     |
| `priority`    | `LOW`, `MEDIUM`, or `HIGH`; defaults to `MEDIUM` |
| `assigneeId`  | Optional UUID; nullable                          |
| `dueDate`     | Optional `YYYY-MM-DD` date; nullable             |

The assignee must be an eligible member of the project.

Success: `201 Created`.

### `GET /projects/:projectId/tasks`

Query parameters:

| Parameter    | Default     | Description                                    |
| ------------ | ----------- | ---------------------------------------------- |
| `page`       | `1`         | Page number                                    |
| `limit`      | `10`        | Results per page, maximum 100                  |
| `status`     | —           | `PENDING`, `IN_PROGRESS`, or `COMPLETED`       |
| `priority`   | —           | `LOW`, `MEDIUM`, or `HIGH`                     |
| `assigneeId` | —           | Filter by assignee UUID                        |
| `search`     | —           | Search task text; 1–200 characters             |
| `labelId`    | —           | Filter by label UUID                           |
| `sortBy`     | `createdAt` | `createdAt`, `dueDate`, `priority`, or `title` |
| `sortOrder`  | `desc`      | `asc` or `desc`                                |

### `PATCH /projects/:projectId/tasks/:taskId`

All fields are optional, but at least one must be provided.

Supported fields:

- `title`
- `description`
- `status`
- `priority`
- `assigneeId`
- `dueDate`

The field constraints and enum values are the same as task creation.

Task updates are subject to project permissions. Members may update tasks assigned to them; project owners can manage project tasks.

### `DELETE /projects/:projectId/tasks/:taskId`

Archives the task instead of permanently deleting it.

### `POST /projects/:projectId/tasks/:taskId/restore`

Restores an archived task.

---

## 7. Labels

Base path: `/projects/:projectId/labels`

| Method | Endpoint                               | CSRF         | Description         |
| ------ | -------------------------------------- | ------------ | ------------------- |
| POST   | `/projects/:projectId/labels`          | Required     | Create a label      |
| GET    | `/projects/:projectId/labels`          | Not required | List project labels |
| DELETE | `/projects/:projectId/labels/:labelId` | Required     | Delete a label      |

### `POST /projects/:projectId/labels`

Request body:

```json
{
  "name": "Backend"
}
```

Validation:

- `name`: required, 1–50 characters.

Success: `201 Created`.

Possible errors:

- `404 NOT_FOUND`
- `409 DUPLICATE_LABEL`
- `409 PROJECT_ARCHIVED`

### `GET /projects/:projectId/labels`

Returns the labels belonging to the project.

### `DELETE /projects/:projectId/labels/:labelId`

Deletes the label. Its task associations are removed automatically.

Success: `204 No Content`.

---

## 8. Task labels

These endpoints manage the many-to-many relationship between tasks and labels.

| Method | Endpoint                                             | CSRF     | Description                |
| ------ | ---------------------------------------------------- | -------- | -------------------------- |
| PUT    | `/projects/:projectId/tasks/:taskId/labels/:labelId` | Required | Assign a label to a task   |
| DELETE | `/projects/:projectId/tasks/:taskId/labels/:labelId` | Required | Remove a label from a task |

Both endpoints require valid UUIDs for all path parameters.

Success: `204 No Content`.

Possible errors include:

- `400 VALIDATION_ERROR`
- `404 NOT_FOUND`
- `409 PROJECT_ARCHIVED`

Removing a label association that does not exist returns `404 NOT_FOUND`.

---

## 9. Comments

Base path: `/projects/:projectId/tasks/:taskId/comments`

| Method | Endpoint                                                 | CSRF         | Description      |
| ------ | -------------------------------------------------------- | ------------ | ---------------- |
| POST   | `/projects/:projectId/tasks/:taskId/comments`            | Required     | Create a comment |
| GET    | `/projects/:projectId/tasks/:taskId/comments`            | Not required | List comments    |
| PATCH  | `/projects/:projectId/tasks/:taskId/comments/:commentId` | Required     | Edit a comment   |
| DELETE | `/projects/:projectId/tasks/:taskId/comments/:commentId` | Required     | Delete a comment |

### `POST /projects/:projectId/tasks/:taskId/comments`

Request body:

```json
{
  "body": "The implementation is ready for review."
}
```

Validation:

- `body`: required, 1–5,000 characters.

Success: `201 Created`.

### `GET /projects/:projectId/tasks/:taskId/comments`

Supports `page` and `limit` pagination.

Comments are ordered by creation time in ascending order.

### `PATCH /projects/:projectId/tasks/:taskId/comments/:commentId`

Request body:

```json
{
  "body": "Updated comment text."
}
```

Only the original comment author may edit it.

Success: `200 OK`.

### `DELETE /projects/:projectId/tasks/:taskId/comments/:commentId`

Soft-deletes the comment rather than permanently removing its record.

Only the original author may delete it.

Success: `200 OK`.

Possible errors:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 COMMENT_RESOURCE_ARCHIVED`

Comments remain readable on archived projects and tasks, but cannot be created, edited, or deleted there.

---

## 10. Attachments

Base path: `/projects/:projectId/tasks/:taskId/attachments`

| Method | Endpoint                                                       | CSRF         | Description            |
| ------ | -------------------------------------------------------------- | ------------ | ---------------------- |
| POST   | `/projects/:projectId/tasks/:taskId/attachments`               | Required     | Upload an attachment   |
| GET    | `/projects/:projectId/tasks/:taskId/attachments`               | Not required | List attachments       |
| GET    | `/projects/:projectId/tasks/:taskId/attachments/:attachmentId` | Not required | Download an attachment |
| DELETE | `/projects/:projectId/tasks/:taskId/attachments/:attachmentId` | Required     | Delete an attachment   |

### `POST /projects/:projectId/tasks/:taskId/attachments`

Content type: `multipart/form-data`

| Field  | Type | Description          |
| ------ | ---- | -------------------- |
| `file` | File | Attachment to upload |

Maximum upload size: 5 MB.

The server validates the file type and file signature before storing it.

Success: `201 Created`.

Possible errors:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 ATTACHMENT_RESOURCE_ARCHIVED`
- `502 ATTACHMENT_STORAGE_ERROR`

### `GET /projects/:projectId/tasks/:taskId/attachments`

Returns attachment metadata for the task.

### `GET /projects/:projectId/tasks/:taskId/attachments/:attachmentId`

Returns the attachment bytes directly.

The response includes `Content-Type`, `Content-Disposition`, and `Content-Length` headers.

### `DELETE /projects/:projectId/tasks/:taskId/attachments/:attachmentId`

Deletes the attachment.

Success: `200 OK`.

Attachment upload and deletion are restricted to the project owner. Existing attachments remain accessible for archived tasks and projects.

---

## 11. Administration

Base path: `/admin`

All endpoints require authentication and the `ADMIN` role. State-changing endpoints also require CSRF protection.

| Method | Endpoint                          | CSRF         | Description       |
| ------ | --------------------------------- | ------------ | ----------------- |
| GET    | `/admin/users`                    | Not required | List users        |
| GET    | `/admin/users/:userId`            | Not required | Inspect a user    |
| GET    | `/admin/projects`                 | Not required | List projects     |
| GET    | `/admin/projects/:projectId`      | Not required | Inspect a project |
| PATCH  | `/admin/users/:userId/deactivate` | Required     | Deactivate a user |
| PATCH  | `/admin/users/:userId/reactivate` | Required     | Reactivate a user |

### `GET /admin/users`

Query parameters:

| Parameter | Default | Description                                            |
| --------- | ------- | ------------------------------------------------------ |
| `page`    | `1`     | Page number                                            |
| `limit`   | `10`    | Results per page, maximum 100                          |
| `search`  | —       | Search users by email or other supported search fields |

### `GET /admin/users/:userId`

Returns the selected user's administrative details.

### `GET /admin/projects`

Query parameters:

| Parameter  | Default | Description                                    |
| ---------- | ------- | ---------------------------------------------- |
| `page`     | `1`     | Page number                                    |
| `limit`    | `10`    | Results per page, maximum 100                  |
| `search`   | —       | Project-name search, 1–120 characters          |
| `archived` | —       | `true` or `false`; omit to include both states |

### `GET /admin/projects/:projectId`

Returns administrative project details, including memberships, tasks, labels, comments, and attachment metadata. Archived projects and tasks can also be inspected.

Deleted comments are represented with a placeholder body and an `isDeleted` indicator.

### `PATCH /admin/users/:userId/deactivate`

Deactivates the selected account and revokes its active authentication sessions and refresh tokens.

An administrator cannot deactivate their own account.

Possible errors:

- `400 CANNOT_DEACTIVATE_SELF`
- `404 NOT_FOUND`

### `PATCH /admin/users/:userId/reactivate`

Reactivates a previously disabled account.

---

## 12. Notes and limitations

- IDs are UUIDs.
- Task due dates are date-only values in `YYYY-MM-DD` format.
- Project and task deletion use archival rather than permanent deletion.
- Comments use soft deletion.
- Authentication cookies are managed by the server.
- State-changing authenticated requests require both the appropriate authentication cookie and CSRF token.
- The API uses rate limiting for registration, login, and refresh.
- External object storage is used for attachments and profile pictures.
