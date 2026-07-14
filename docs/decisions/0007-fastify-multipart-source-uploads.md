# ADR 0007 — Parse source uploads with @fastify/multipart

**Status:** accepted · 2026-07-14

## Context

M2 requires bounded server-side file acquisition before conversion and review. Fastify does not parse multipart uploads itself, and hand-written multipart parsing would add a security-sensitive protocol implementation.

## Decision

1. Use `@fastify/multipart` for source upload endpoints.
2. Configure explicit per-file and file-count limits at registration and consume uploads in memory only when the converter's tighter size limit permits it.
3. Keep format validation and conversion outside the multipart adapter so converters remain independently testable.

## Rationale

`@fastify/multipart` is the maintained Fastify ecosystem adapter, exposes streaming and limit failures, and avoids another web-protocol implementation. Its major version is compatible with Fastify 5 and has no known GitHub advisories at selection time.

## Consequences

File upload routes depend on the adapter's multipart behavior. In-memory acquisition remains restricted to small formats such as JSON; future PDF conversion may stream to operation-scoped temporary files behind the same route boundary.
