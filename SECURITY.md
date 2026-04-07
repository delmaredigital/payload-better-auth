# Security Policy

## Reporting a Vulnerability

`@delmaredigital/payload-better-auth` integrates Better Auth with Payload CMS, so security issues may have significant impact on consuming applications. If you discover a vulnerability, please report it privately so we can address it before public disclosure.

**Preferred:** Use [GitHub's private vulnerability reporting](https://github.com/delmaredigital/payload-better-auth/security/advisories/new). This creates a private draft advisory that only maintainers can see.

**Alternative:** Email [security@delmaredigital.com](mailto:security@delmaredigital.com).

Please include:

- A description of the issue and its potential impact
- Steps to reproduce
- Affected versions (if known)
- Any suggested fix or mitigation

**Please do not open a public GitHub issue for security vulnerabilities.**

## Scope

In scope:

- Authentication, authorization, and session management bugs
- Privilege escalation or access control bypasses
- Insecure defaults that put consumers at risk
- Token, cookie, or credential handling issues
- API endpoints exposed by this plugin

Out of scope (please report upstream):

- Issues in [Better Auth](https://github.com/better-auth/better-auth) itself
- Issues in [Payload CMS](https://github.com/payloadcms/payload) itself
- Vulnerabilities in transitive dependencies (use `npm audit` and report to the dependency maintainer)

## Response Expectations

- We aim to acknowledge reports within 3 business days.
- We will keep you updated as we investigate and develop a fix.
- Once a fix is available, we publish a [GitHub Security Advisory](https://github.com/delmaredigital/payload-better-auth/security/advisories) and may request a CVE.

## Supported Versions

This project is pre-1.0. Security fixes are released against the latest published version only. If you are on an older release, please upgrade.

## Disclosure

We follow coordinated disclosure. Once a fix is published, we publish a security advisory crediting the reporter (with their permission). Past advisories are visible in the [Security tab](https://github.com/delmaredigital/payload-better-auth/security/advisories).
